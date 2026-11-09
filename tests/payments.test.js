import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, holdAndPay } from './helpers.js';
import { BookingStatus } from '../src/domain/BookingStatus.js';

test('un webhook duplicado se ignora y no repite notificaciones', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const second = await app.gateway.redeliver(payment.transactionId);
  assert.equal(second.result.duplicate, true);
  const confirmations = (await app.notificationService.inbox('owner', 'own_1')).filter((n) => n.title === 'Reserva confirmada');
  assert.equal(confirmations.length, 1);
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.CONFIRMED);
  assert.equal(await app.auditLog.countByType('webhook.duplicate_ignored'), 1);
});

test('un webhook con firma alterada se rechaza', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  const forged = { eventId: 'evt_falso', type: 'transaction.updated', sentAt: 1, data: { transactionId: payment.transactionId, status: 'APPROVED', amount: 1 }, signature: 'abc' };
  const result = await app.paymentService.handleWebhook(forged);
  assert.equal(result.accepted, false);
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.HELD);
});

test('caída de comunicación: la conciliación recupera el pago aprobado', async () => {
  const { app } = await setup();
  const { booking, payment } = await holdAndPay(app);
  app.gateway.setOutage(true);
  const delivery = await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  assert.equal(delivery.delivered, false);
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.HELD);

  const { resolved } = await app.paymentService.reconcile();
  assert.equal(resolved, 1);
  assert.equal((await app.bookingService.findById(booking.id)).status, BookingStatus.CONFIRMED);

  // Si después llega el webhook atrasado, no cambia nada.
  app.gateway.setOutage(false);
  const late = await app.gateway.redeliver(payment.transactionId);
  assert.equal(late.result.outcome, 'already_processed');
});

test('doble clic en pagar no crea dos cobros', async () => {
  const { app } = await setup();
  const booking = await app.bookingService.requestBooking({ ownerId: 'own_1', petName: 'Toby', slotId: 'slot_a' });
  const [a, b] = await Promise.all([
    app.paymentService.startPayment({ bookingId: booking.id, ownerId: 'own_1', method: 'PSE' }),
    app.paymentService.startPayment({ bookingId: booking.id, ownerId: 'own_1', method: 'PSE' }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await app.gateway.listTransactions()).length, 1);
});

test('confirmación en menos de 5 minutos después de aprobado el pago', async () => {
  const { app } = await setup();
  const { payment } = await holdAndPay(app);
  await app.gateway.simulateResult(payment.transactionId, 'APPROVED');
  const summary = await app.reportService.summary();
  assert.ok(summary.maxApprovalToConfirmMs <= 5 * 60 * 1000);
  assert.ok(summary.notifications.ratio >= 0.98);
});
