import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, holdAndPay, MINUTE, HOUR } from './helpers.js';
import { BookingStatus } from '../src/domain/BookingStatus.js';
import { SlotState } from '../src/domain/Slot.js';

test('200 dueños intentan apartar el mismo horario al mismo tiempo: solo uno lo logra', async () => {
  const { app } = await setup();
  const attempts = Array.from({ length: 200 }, (_, i) =>
    app.bookingService.requestBooking({ ownerId: `own_${i}`, petName: `Mascota ${i}`, slotId: 'slot_a' }));
  const results = await Promise.allSettled(attempts);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(rejected.length, 199);
  assert.ok(rejected.every((r) => r.reason.code === 'SLOT_UNAVAILABLE'));
});

test('flujo feliz: bloqueo, pago aprobado y confirmación automática', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const saved = await app.bookingService.findById(booking.id);
  const slot = await app.repos.slots.findById('slot_a');
  assert.equal(saved.status, BookingStatus.CONFIRMED);
  assert.equal(slot.state, SlotState.BOOKED);
  const inbox = await app.notificationService.inbox('caregiver', 'cg_1');
  assert.equal(inbox[0].title, 'Nueva reserva pagada');
});

test('un pago rechazado libera el horario', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'DECLINED');
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.PAYMENT_REJECTED);
  assert.equal((await app.repos.slots.findById('slot_a')).state, SlotState.FREE);
});

test('sin pago, el bloqueo vence a los 10 minutos y el horario se libera', async () => {
  const { app, clock } = await setup();
  const booking = await app.bookingService.requestBooking({ ownerId: 'own_1', petName: 'Toby', slotId: 'slot_a' });
  clock.advance(10 * MINUTE);
  assert.equal(await app.bookingService.expireHolds(), 1);
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.EXPIRED);
  assert.equal((await app.repos.slots.findById('slot_a')).state, SlotState.FREE);
});

test('con un pago en verificación, el bloqueo se extiende hasta 30 minutos', async () => {
  const { app, clock } = await setup();
  const { booking } = await holdAndPay(app);
  clock.advance(15 * MINUTE);
  await app.bookingService.expireHolds();
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.HELD);
  await assert.rejects(app.bookingService.requestBooking({ ownerId: 'own_2', petName: 'Luna', slotId: 'slot_a' }), { code: 'SLOT_UNAVAILABLE' });
});

test('pago aprobado tarde con el horario libre: se confirma', async () => {
  const { app, clock } = await setup();
  const { booking, payment } = await holdAndPay(app);
  clock.advance(31 * MINUTE);
  await app.bookingService.expireHolds();
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const saved = await app.bookingService.findById(booking.id);
  assert.equal(saved.status, BookingStatus.CONFIRMED);
});

test('pago aprobado tarde con el horario ya tomado: reembolso total automático', async () => {
  const { app, clock } = await setup();
  const first = await holdAndPay(app, { ownerId: 'own_1' });
  clock.advance(31 * MINUTE);
  await app.bookingService.expireHolds();
  const second = await holdAndPay(app, { ownerId: 'own_2' });
  await app.gateway.simulateResult(second.payment.transactionId, 'APPROVED');
  await app.gateway.simulateResult(first.payment.transactionId, 'APPROVED');

  const late = await app.bookingService.findById(first.booking.id);
  const payment = await app.paymentService.findById(first.payment.id);
  assert.equal(late.status, BookingStatus.REFUNDED_LATE_PAYMENT);
  assert.equal(payment.refundedAmount, payment.amount);
  assert.equal((await app.bookingService.findById(second.booking.id)).status, BookingStatus.CONFIRMED);
});

test('el cuidador no puede borrar un horario con reserva confirmada', async () => {
  const { app } = await setup();
  const { payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  await assert.rejects(app.availabilityService.removeSlot('cg_1', 'slot_a'), { code: 'SLOT_BOOKED' });
});

test('cancelación del cuidador: reembolso total y alternativas para el dueño', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const { alternatives } = await app.bookingService.cancelByCaregiver(booking.id, 'cg_1', 'Viaje imprevisto');
  assert.equal(alternatives.length, 1);
  assert.equal((await app.paymentService.findById(payment.id)).refundedAmount, payment.amount);
  assert.equal(await app.repos.slots.findById('slot_a'), null);
});

test('política moderada: cancelar 30 horas antes devuelve el 50 %', async () => {
  const { app } = await setup({ hoursAhead: 30 });
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const { refundAmount } = await app.bookingService.cancelByOwner(booking.id, 'own_1');
  assert.equal(refundAmount, Math.round(booking.price / 2));
  assert.equal((await app.paymentService.findById(payment.id)).refundedAmount, refundAmount);
});

test('la política queda congelada en la reserva aunque el cuidador la cambie después', async () => {
  const { app } = await setup({ hoursAhead: 30, policy: 'moderada' });
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  await app.availabilityService.changePolicy('cg_1', 'estricta');
  const { refundAmount } = await app.bookingService.cancelByOwner(booking.id, 'own_1');
  assert.equal(refundAmount, Math.round(booking.price / 2));
});

test('reprogramar respeta el límite de horas de la política', async () => {
  const { app, clock } = await setup({ hoursAhead: 72 });
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const moved = await app.bookingService.reschedule(booking.id, 'own_1', 'slot_b');
  assert.equal(moved.slotId, 'slot_b');
  assert.equal((await app.repos.slots.findById('slot_a')).state, SlotState.FREE);
  clock.advance(62 * HOUR); // quedan 22 h para el servicio
  await assert.rejects(app.bookingService.reschedule(booking.id, 'own_1', 'slot_a'), /permite reprogramar/);
});
