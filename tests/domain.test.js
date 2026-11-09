import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Slot } from '../src/domain/Slot.js';
import { canTransition, BookingStatus as S } from '../src/domain/BookingStatus.js';
import { CancellationPolicyFactory } from '../src/domain/CancellationPolicy.js';

test('detecta cruces de horario, incluidos los de alojamiento nocturno', () => {
  const night = new Slot({ id: 'n', date: '2026-11-10', start: '18:00', end: '08:00' });
  const walk = new Slot({ id: 'w', date: '2026-11-10', start: '19:00', end: '20:00' });
  const morning = new Slot({ id: 'm', date: '2026-11-10', start: '07:00', end: '08:00' });
  assert.equal(night.overlaps(walk), true);
  assert.equal(night.overlaps(morning), false);
});

test('la máquina de estados impide confirmar una reserva cancelada', () => {
  assert.equal(canTransition(S.HELD, S.CONFIRMED), true);
  assert.equal(canTransition(S.CANCELLED_BY_OWNER, S.CONFIRMED), false);
  assert.equal(canTransition(S.PAYMENT_REJECTED, S.CONFIRMED), false);
});

test('las tres políticas calculan el reembolso según las horas de anticipación', () => {
  const flexible = CancellationPolicyFactory.get('flexible');
  const strict = CancellationPolicyFactory.get('estricta');
  assert.equal(flexible.refundRatio(25), 1);
  assert.equal(flexible.refundRatio(3), 0.5);
  assert.equal(strict.refundRatio(60), 0.5);
  assert.equal(strict.refundRatio(10), 0);
});
