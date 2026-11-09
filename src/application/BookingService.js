import { Booking } from '../domain/Booking.js';
import { BookingStatus } from '../domain/BookingStatus.js';
import { SlotState } from '../domain/Slot.js';
import { CancellationPolicyFactory } from '../domain/CancellationPolicy.js';
import { NotFoundError, SlotUnavailableError, ValidationError } from '../domain/errors.js';
import { newId } from '../shared/ids.js';
import { HOUR } from '../shared/time.js';

const S = BookingStatus;

// Casos de uso del ciclo de vida de la reserva. Toda operación que cambia un
// horario se ejecuta dentro del candado de ese horario (KeyedMutex) y los
// eventos se publican después de liberarlo.
export class BookingService {
  #slots; #bookings; #caregivers; #clock; #bus; #mutex; #config;

  constructor({ slotRepository, bookingRepository, caregiverRepository, clock, eventBus, mutex, config }) {
    this.#slots = slotRepository;
    this.#bookings = bookingRepository;
    this.#caregivers = caregiverRepository;
    this.#clock = clock;
    this.#bus = eventBus;
    this.#mutex = mutex;
    this.#config = config;
  }

  async requestBooking({ ownerId, petName, slotId }) {
    if (!petName?.trim()) throw new ValidationError('Escribe el nombre de tu mascota.');
    const events = [];
    const booking = await this.#mutex.run(`slot:${slotId}`, async () => {
      const now = this.#clock.now();
      const slot = await this.#requireSlot(slotId);
      if (slot.startsAt() <= now) throw new ValidationError('Ese horario ya empezó.');
      if (!slot.isAvailableAt(now)) throw new SlotUnavailableError();
      if (slot.state === SlotState.HELD) events.push(...await this.#expireInside(slot.bookingId, slot, now));

      const caregiver = await this.#caregivers.findById(slot.caregiverId);
      const created = Booking.create({
        id: newId('rsv'), ownerId, petName, slot,
        price: caregiver.priceFor(slot.service), policy: caregiver.policy,
        now, holdMinutes: this.#config.holdMinutes,
      });
      slot.hold(created.id, created.holdExpiresAt);
      await this.#bookings.save(created);
      await this.#slots.save(slot);
      events.push(['booking.held', { booking: created.toJSON() }]);
      return created;
    });
    await this.#publishAll(events);
    return booking;
  }

  // Llamado por el servicio de pagos al crear la transacción: mientras la
  // pasarela verifica el pago (PSE puede tardar), el bloqueo se extiende.
  async attachPayment(bookingId, paymentId, holdUntil) {
    return this.#withBookingLock(bookingId, async (booking, slot, now) => {
      if (!booking.isHoldActive(now)) throw new ValidationError('El tiempo para pagar venció. Vuelve a elegir un horario.');
      booking.attachPayment(paymentId, holdUntil);
      slot?.extendHold(booking.id, booking.holdExpiresAt);
      await this.#bookings.save(booking);
      if (slot) await this.#slots.save(slot);
      return booking;
    });
  }

  async applyApprovedPayment(bookingId) {
    const events = [];
    const result = await this.#withBookingLock(bookingId, async (booking, slot, now) => {
      if (booking.status === S.CONFIRMED) return { outcome: 'already_confirmed', booking };

      if (booking.status === S.HELD && slot?.bookingId === booking.id) {
        booking.transitionTo(S.CONFIRMED, now, 'Pago aprobado por la pasarela');
        slot.book(booking.id);
        await this.#persist(booking, slot);
        events.push(['booking.confirmed', { booking: booking.toJSON(), late: false }]);
        return { outcome: 'confirmed', booking };
      }

      if (booking.status === S.HELD || booking.status === S.EXPIRED) {
        if (booking.status === S.HELD) booking.transitionTo(S.EXPIRED, now, 'El horario fue tomado antes de aprobarse el pago');
        // Regla del pago tardío: si el horario sigue libre se confirma; si
        // ya lo tomó otra persona, se reembolsa el 100 % automáticamente.
        if (slot && slot.isAvailableAt(now)) {
          if (slot.state === SlotState.HELD) events.push(...await this.#expireInside(slot.bookingId, slot, now));
          booking.transitionTo(S.CONFIRMED, now, 'Pago aprobado después del vencimiento; el horario seguía libre');
          slot.book(booking.id);
          await this.#persist(booking, slot);
          events.push(['booking.confirmed', { booking: booking.toJSON(), late: true }]);
          return { outcome: 'late_confirmed', booking };
        }
        booking.transitionTo(S.REFUNDED_LATE_PAYMENT, now, 'Pago aprobado tarde y el horario ya estaba tomado: reembolso total');
        booking.refundAmount = booking.price;
        await this.#bookings.save(booking);
        events.push(['booking.late_payment_refunded', { booking: booking.toJSON() }]);
        return { outcome: 'late_refund', booking };
      }

      return { outcome: 'ignored', booking };
    });
    await this.#publishAll(events);
    return result;
  }

  async applyRejectedPayment(bookingId) {
    const events = [];
    const result = await this.#withBookingLock(bookingId, async (booking, slot, now) => {
      if (booking.status !== S.HELD) return { outcome: 'ignored', booking };
      booking.transitionTo(S.PAYMENT_REJECTED, now, 'La pasarela rechazó el pago; el horario se liberó');
      if (slot?.release(booking.id)) await this.#slots.save(slot);
      await this.#bookings.save(booking);
      events.push(['booking.payment_rejected', { booking: booking.toJSON() }]);
      return { outcome: 'rejected', booking };
    });
    await this.#publishAll(events);
    return result;
  }

  async expireHolds() {
    const now = this.#clock.now();
    const stale = await this.#bookings.findAll((b) => b.status === S.HELD && b.holdExpiresAt <= now);
    const events = [];
    for (const { id, slotId } of stale) {
      await this.#mutex.run(`slot:${slotId}`, async () => {
        const slot = await this.#slots.findById(slotId);
        events.push(...await this.#expireInside(id, slot, this.#clock.now()));
      });
    }
    await this.#publishAll(events);
    return events.length;
  }

  async refundPreview(bookingId) {
    const booking = await this.#requireBooking(bookingId);
    const policy = CancellationPolicyFactory.get(booking.policy);
    const hoursBefore = (booking.startsAt() - this.#clock.now()) / HOUR;
    const ratio = hoursBefore > 0 ? policy.refundRatio(hoursBefore) : 0;
    return { policy, hoursBefore, ratio, amount: Math.round(booking.price * ratio), canReschedule: policy.canReschedule(hoursBefore) };
  }

  async cancelByOwner(bookingId, ownerId) {
    const events = [];
    const result = await this.#withBookingLock(bookingId, async (booking, slot, now) => {
      if (booking.ownerId !== ownerId) throw new NotFoundError('la reserva');
      if (booking.status !== S.CONFIRMED) throw new ValidationError('Solo se pueden cancelar reservas confirmadas.');
      const hoursBefore = (booking.startsAt() - now) / HOUR;
      if (hoursBefore <= 0) throw new ValidationError('El servicio ya empezó. Para casos especiales escribe a soporte.');
      const policy = CancellationPolicyFactory.get(booking.policy);
      const ratio = policy.refundRatio(hoursBefore);
      booking.refundAmount = Math.round(booking.price * ratio);
      booking.transitionTo(S.CANCELLED_BY_OWNER, now, `Cancelación con política ${policy.label}: reembolso del ${ratio * 100} %`);
      slot?.release(booking.id);
      await this.#persist(booking, slot);
      events.push(['booking.cancelled_by_owner', { booking: booking.toJSON(), refundAmount: booking.refundAmount }]);
      return { booking, refundAmount: booking.refundAmount };
    });
    await this.#publishAll(events);
    return result;
  }

  // Si el cuidador ya no puede atender una reserva confirmada, el dueño
  // recibe reembolso total y se le muestran cuidadores alternativos.
  async cancelByCaregiver(bookingId, caregiverId, reason = '') {
    const events = [];
    const result = await this.#withBookingLock(bookingId, async (booking, slot, now) => {
      if (booking.caregiverId !== caregiverId) throw new NotFoundError('la reserva');
      if (booking.status !== S.CONFIRMED) throw new ValidationError('Solo se pueden cancelar reservas confirmadas.');
      booking.refundAmount = booking.price;
      booking.transitionTo(S.CANCELLED_BY_CAREGIVER, now, `El cuidador canceló${reason ? `: ${reason}` : ''}. Reembolso total`);
      await this.#bookings.save(booking);
      if (slot) await this.#slots.delete(slot.id);
      const alternatives = await this.#slots.findAll((s) =>
        s.date === booking.date && s.service === booking.service && s.caregiverId !== caregiverId && s.isAvailableAt(now));
      events.push(['booking.cancelled_by_caregiver', { booking: booking.toJSON(), refundAmount: booking.price, alternatives: alternatives.length }]);
      return { booking, alternatives };
    });
    await this.#publishAll(events);
    return result;
  }

  async reschedule(bookingId, ownerId, newSlotId) {
    const current = await this.#requireBooking(bookingId);
    const events = [];
    const result = await this.#mutex.runAll([`slot:${current.slotId}`, `slot:${newSlotId}`], async () => {
      const now = this.#clock.now();
      const booking = await this.#requireBooking(bookingId);
      if (booking.ownerId !== ownerId) throw new NotFoundError('la reserva');
      if (booking.status !== S.CONFIRMED) throw new ValidationError('Solo se pueden reprogramar reservas confirmadas.');
      const policy = CancellationPolicyFactory.get(booking.policy);
      if (!policy.canReschedule((booking.startsAt() - now) / HOUR)) {
        throw new ValidationError(`La política ${policy.label} permite reprogramar hasta ${policy.rescheduleLimitHours} horas antes del servicio.`);
      }
      const target = await this.#requireSlot(newSlotId);
      if (target.caregiverId !== booking.caregiverId || target.service !== booking.service) {
        throw new ValidationError('Solo puedes reprogramar con el mismo cuidador y el mismo servicio.');
      }
      if (!target.isAvailableAt(now) || target.startsAt() <= now) throw new SlotUnavailableError();
      if (target.state === SlotState.HELD) events.push(...await this.#expireInside(target.bookingId, target, now));

      const oldSlot = await this.#slots.findById(booking.slotId);
      oldSlot?.release(booking.id);
      target.book(booking.id);
      booking.moveTo(target, now);
      if (oldSlot) await this.#slots.save(oldSlot);
      await this.#persist(booking, target);
      events.push(['booking.rescheduled', { booking: booking.toJSON() }]);
      return booking;
    });
    await this.#publishAll(events);
    return result;
  }

  async listByOwner(ownerId) {
    return (await this.#bookings.findAll((b) => b.ownerId === ownerId)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async listByCaregiver(caregiverId) {
    return (await this.#bookings.findAll((b) => b.caregiverId === caregiverId)).sort((a, b) => a.startsAt() - b.startsAt());
  }

  async listAll() { return (await this.#bookings.findAll()).sort((a, b) => b.createdAt - a.createdAt); }

  async findById(id) { return this.#bookings.findById(id); }

  // --- utilidades internas ---

  async #expireInside(bookingId, slot, now) {
    const booking = await this.#bookings.findById(bookingId);
    if (!booking || booking.status !== S.HELD || booking.holdExpiresAt > now) return [];
    booking.transitionTo(S.EXPIRED, now, 'El bloqueo venció sin un pago aprobado');
    await this.#bookings.save(booking);
    if (slot?.release(booking.id)) await this.#slots.save(slot);
    return [['booking.expired', { booking: booking.toJSON() }]];
  }

  async #withBookingLock(bookingId, task) {
    const { slotId } = await this.#requireBooking(bookingId);
    return this.#mutex.run(`slot:${slotId}`, async () => {
      const booking = await this.#requireBooking(bookingId);
      const slot = await this.#slots.findById(booking.slotId);
      return task(booking, slot, this.#clock.now());
    });
  }

  async #persist(booking, slot) {
    await this.#bookings.save(booking);
    if (slot) await this.#slots.save(slot);
  }

  async #publishAll(events) {
    for (const [type, payload] of events) await this.#bus.publish(type, payload);
  }

  async #requireSlot(id) {
    const slot = await this.#slots.findById(id);
    if (!slot) throw new NotFoundError('el horario');
    return slot;
  }

  async #requireBooking(id) {
    const booking = await this.#bookings.findById(id);
    if (!booking) throw new NotFoundError('la reserva');
    return booking;
  }
}
