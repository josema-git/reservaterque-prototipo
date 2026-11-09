import { toMinutes, toEpoch } from '../shared/time.js';

export const SlotState = Object.freeze({ FREE: 'FREE', HELD: 'HELD', BOOKED: 'BOOKED' });

// Espacio de disponibilidad publicado por un cuidador.
export class Slot {
  constructor({ id, caregiverId, date, start, end, service, state = SlotState.FREE, bookingId = null, holdUntil = null }) {
    Object.assign(this, { id, caregiverId, date, start, end, service, state, bookingId, holdUntil });
  }

  startsAt() { return toEpoch(this.date, this.start); }

  range() {
    const s = toMinutes(this.start);
    let e = toMinutes(this.end);
    if (e <= s) e += 1440;
    return [s, e];
  }

  overlaps(other) {
    if (this.date !== other.date) return false;
    const [a1, a2] = this.range();
    const [b1, b2] = other.range();
    return a1 < b2 && b1 < a2;
  }

  // Un bloqueo vencido no cuenta: el espacio vuelve a estar disponible.
  isAvailableAt(now) {
    return this.state === SlotState.FREE || (this.state === SlotState.HELD && this.holdUntil <= now);
  }

  hold(bookingId, until) {
    this.state = SlotState.HELD;
    this.bookingId = bookingId;
    this.holdUntil = until;
  }

  extendHold(bookingId, until) {
    if (this.bookingId !== bookingId) return false;
    this.holdUntil = Math.max(this.holdUntil ?? 0, until);
    return true;
  }

  book(bookingId) {
    this.state = SlotState.BOOKED;
    this.bookingId = bookingId;
    this.holdUntil = null;
  }

  // Solo libera el espacio si sigue en manos de esa reserva; así una reserva
  // vencida nunca libera un horario que ya apartó otra persona.
  release(bookingId) {
    if (this.bookingId !== bookingId) return false;
    this.state = SlotState.FREE;
    this.bookingId = null;
    this.holdUntil = null;
    return true;
  }

  toJSON() { return { ...this }; }

  static fromJSON(json) { return new Slot(json); }
}
