import { Slot, SlotState } from '../domain/Slot.js';
import { getService } from '../domain/ServiceCatalog.js';
import { CancellationPolicyFactory } from '../domain/CancellationPolicy.js';
import { DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import { newId } from '../shared/ids.js';
import { dateKey } from '../shared/time.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilityService {
  #slots; #caregivers; #clock; #bus; #mutex;

  constructor({ slotRepository, caregiverRepository, clock, eventBus, mutex }) {
    this.#slots = slotRepository;
    this.#caregivers = caregiverRepository;
    this.#clock = clock;
    this.#bus = eventBus;
    this.#mutex = mutex;
  }

  async publishSlot(caregiverId, { date, start, end, service }) {
    const caregiver = await this.#requireCaregiver(caregiverId);
    const catalog = getService(service);
    if (!caregiver.offers(service)) throw new ValidationError(`Tu perfil no tiene habilitado el servicio de ${catalog.label.toLowerCase()}.`);
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) throw new ValidationError('Usa horas en formato HH:MM.');
    if (date < dateKey(this.#clock.now())) throw new ValidationError('No puedes publicar disponibilidad en fechas pasadas.');
    if (!catalog.overnight && end <= start) throw new ValidationError('La hora de fin debe ser posterior a la de inicio.');

    const slot = new Slot({ id: newId('slot'), caregiverId, date, start, end, service });
    if (slot.startsAt() <= this.#clock.now()) throw new ValidationError('Ese horario ya empezó. Elige una hora futura.');

    const sameDay = await this.#slots.findAll((s) => s.caregiverId === caregiverId && s.date === date);
    if (sameDay.some((s) => s.overlaps(slot))) throw new ValidationError('Ese horario se cruza con otro que ya publicaste ese día.');

    await this.#slots.save(slot);
    await this.#bus.publish('slot.published', { slot: slot.toJSON() });
    return slot;
  }

  async removeSlot(caregiverId, slotId) {
    await this.#mutex.run(`slot:${slotId}`, async () => {
      const slot = await this.#slots.findById(slotId);
      if (!slot || slot.caregiverId !== caregiverId) throw new NotFoundError('el horario');
      if (slot.state === SlotState.BOOKED) {
        throw new DomainError('Este horario tiene una reserva confirmada. Si no puedes atenderla, cancela la reserva: el dueño recibe reembolso total y se le sugieren otros cuidadores.', 'SLOT_BOOKED');
      }
      if (!slot.isAvailableAt(this.#clock.now())) {
        throw new DomainError('Un dueño está pagando este horario en este momento. Podrás quitarlo cuando termine el bloqueo.', 'SLOT_HELD');
      }
      await this.#slots.delete(slotId);
    });
    await this.#bus.publish('slot.removed', { slotId, caregiverId });
  }

  async changePolicy(caregiverId, policyId) {
    CancellationPolicyFactory.get(policyId);
    const caregiver = await this.#requireCaregiver(caregiverId);
    caregiver.changePolicy(policyId);
    await this.#caregivers.save(caregiver);
    await this.#bus.publish('caregiver.policy_changed', { caregiverId, policyId });
  }

  async search({ date, service, zone = '' }) {
    const now = this.#clock.now();
    const caregivers = new Map((await this.#caregivers.findAll()).map((c) => [c.id, c]));
    const slots = await this.#slots.findAll((s) =>
      s.date === date && s.service === service && s.isAvailableAt(now) && s.startsAt() > now,
    );
    return slots
      .map((slot) => ({ slot, caregiver: caregivers.get(slot.caregiverId) }))
      .filter(({ caregiver }) => caregiver && (!zone || caregiver.zone === zone))
      .sort((a, b) => a.slot.startsAt() - b.slot.startsAt());
  }

  async slotsOf(caregiverId) {
    const today = dateKey(this.#clock.now());
    return (await this.#slots.findAll((s) => s.caregiverId === caregiverId && s.date >= today))
      .sort((a, b) => a.startsAt() - b.startsAt());
  }

  async #requireCaregiver(id) {
    const caregiver = await this.#caregivers.findById(id);
    if (!caregiver) throw new NotFoundError('el cuidador');
    return caregiver;
  }
}
