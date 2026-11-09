import { createContainer } from '../src/app/container.js';
import { MemoryStorage } from '../src/infrastructure/persistence/storage.js';
import { FixedClock } from '../src/infrastructure/SimulatedClock.js';
import { Caregiver } from '../src/domain/Caregiver.js';
import { Slot } from '../src/domain/Slot.js';
import { HOUR, MINUTE, toEpoch } from '../src/shared/time.js';

export { HOUR, MINUTE };

export async function setup({ policy = 'moderada', hoursAhead = 72 } = {}) {
  const now = toEpoch('2026-11-09', '08:00');
  const clock = new FixedClock(now);
  const storage = new MemoryStorage();
  const app = createContainer({ storage, clock, onError: (e) => { throw e; } });
  await app.repos.caregivers.save(new Caregiver({ id: 'cg_1', name: 'Cuidadora', zone: 'Laureles', services: ['paseo', 'guarderia'], policy }));
  await app.repos.caregivers.save(new Caregiver({ id: 'cg_2', name: 'Cuidador', zone: 'Belén', services: ['paseo'] }));

  const startMs = now + hoursAhead * HOUR;
  const d = new Date(startMs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = `${String(d.getHours()).padStart(2, '0')}:00`;
  const end = `${String(d.getHours() + 1).padStart(2, '0')}:00`;
  const slot = new Slot({ id: 'slot_a', caregiverId: 'cg_1', date, start, end, service: 'paseo' });
  const other = new Slot({ id: 'slot_b', caregiverId: 'cg_1', date, start: '20:00', end: '21:00', service: 'paseo' });
  const rival = new Slot({ id: 'slot_c', caregiverId: 'cg_2', date, start, end, service: 'paseo' });
  for (const s of [slot, other, rival]) await app.repos.slots.save(s);
  return { app, clock, storage, slot };
}

// Recorre el flujo completo hasta tener un pago pendiente en la pasarela.
export async function holdAndPay(app, { ownerId = 'own_1', slotId = 'slot_a', method = 'NEQUI' } = {}) {
  const booking = await app.bookingService.requestBooking({ ownerId, petName: 'Toby', slotId });
  const payment = await app.paymentService.startPayment({ bookingId: booking.id, ownerId, method });
  return { booking, payment };
}
