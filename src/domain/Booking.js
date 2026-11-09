import { BookingStatus, canTransition } from './BookingStatus.js';
import { InvalidTransitionError } from './errors.js';
import { toEpoch, MINUTE } from '../shared/time.js';

export class Booking {
  constructor(props) {
    Object.assign(this, { paymentId: null, confirmedAt: null, refundAmount: 0, history: [], ...props });
    this.history = [...this.history];
  }

  static create({ id, ownerId, petName, slot, price, policy, now, holdMinutes }) {
    const booking = new Booking({
      id, ownerId, petName: petName.trim(), price, policy,
      caregiverId: slot.caregiverId, slotId: slot.id, service: slot.service,
      date: slot.date, start: slot.start, end: slot.end,
      status: BookingStatus.HELD,
      createdAt: now,
      holdExpiresAt: now + holdMinutes * MINUTE,
    });
    booking.history.push({ status: BookingStatus.HELD, at: now, note: `Horario apartado por ${holdMinutes} minutos` });
    return booking;
  }

  startsAt() { return toEpoch(this.date, this.start); }

  isHoldActive(now) { return this.status === BookingStatus.HELD && now < this.holdExpiresAt; }

  transitionTo(status, at, note = '') {
    if (!canTransition(this.status, status)) throw new InvalidTransitionError(this.status, status);
    this.status = status;
    if (status === BookingStatus.CONFIRMED) this.confirmedAt = at;
    this.history.push({ status, at, note });
  }

  note(at, note) { this.history.push({ status: this.status, at, note }); }

  attachPayment(paymentId, holdUntil) {
    this.paymentId = paymentId;
    this.holdExpiresAt = Math.max(this.holdExpiresAt, holdUntil);
  }

  moveTo(slot, at) {
    const from = `${this.date} ${this.start}`;
    Object.assign(this, { slotId: slot.id, date: slot.date, start: slot.start, end: slot.end });
    this.note(at, `Reprogramada de ${from} a ${slot.date} ${slot.start}`);
  }

  toJSON() { return { ...this, history: [...this.history] }; }

  static fromJSON(json) { return new Booking(json); }
}
