// Máquina de estados de la reserva. Cualquier transición que no esté en la
// tabla se rechaza, lo que evita estados inconsistentes (por ejemplo,
// confirmar una reserva cancelada).
export const BookingStatus = Object.freeze({
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  EXPIRED: 'EXPIRED',
  REFUNDED_LATE_PAYMENT: 'REFUNDED_LATE_PAYMENT',
  CANCELLED_BY_OWNER: 'CANCELLED_BY_OWNER',
  CANCELLED_BY_CAREGIVER: 'CANCELLED_BY_CAREGIVER',
  COMPLETED: 'COMPLETED',
});

const S = BookingStatus;

const TRANSITIONS = Object.freeze({
  [S.HELD]: [S.CONFIRMED, S.PAYMENT_REJECTED, S.EXPIRED],
  [S.EXPIRED]: [S.CONFIRMED, S.REFUNDED_LATE_PAYMENT],
  [S.CONFIRMED]: [S.CANCELLED_BY_OWNER, S.CANCELLED_BY_CAREGIVER, S.COMPLETED],
  [S.PAYMENT_REJECTED]: [],
  [S.REFUNDED_LATE_PAYMENT]: [],
  [S.CANCELLED_BY_OWNER]: [],
  [S.CANCELLED_BY_CAREGIVER]: [],
  [S.COMPLETED]: [],
});

export const STATUS_LABELS = Object.freeze({
  [S.HELD]: 'Esperando pago',
  [S.CONFIRMED]: 'Confirmada',
  [S.PAYMENT_REJECTED]: 'Pago rechazado',
  [S.EXPIRED]: 'Bloqueo vencido',
  [S.REFUNDED_LATE_PAYMENT]: 'Reembolsada (pago tardío)',
  [S.CANCELLED_BY_OWNER]: 'Cancelada por el dueño',
  [S.CANCELLED_BY_CAREGIVER]: 'Cancelada por el cuidador',
  [S.COMPLETED]: 'Completada',
});

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
