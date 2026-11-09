import { ValidationError } from './errors.js';

export const PaymentStatus = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
});

export const PAYMENT_METHODS = Object.freeze({ PSE: 'PSE', NEQUI: 'Nequi', CARD: 'Tarjeta' });

export class Payment {
  constructor(props) {
    Object.assign(this, { refundedAmount: 0, resolvedAt: null, resolvedBy: null, ...props });
  }

  static create({ id, bookingId, transactionId, method, amount, now }) {
    if (!PAYMENT_METHODS[method]) throw new ValidationError('Elige un medio de pago válido.');
    return new Payment({ id, bookingId, transactionId, method, amount, status: PaymentStatus.PENDING, createdAt: now });
  }

  isFinal() { return this.status !== PaymentStatus.PENDING; }

  resolve(status, at, source) {
    this.status = status;
    this.resolvedAt = at;
    this.resolvedBy = source;
  }

  registerRefund(amount) {
    if (amount <= 0) return;
    if (this.refundedAmount + amount > this.amount) throw new ValidationError('El reembolso supera el valor pagado.');
    this.refundedAmount += amount;
  }

  toJSON() { return { ...this }; }

  static fromJSON(json) { return new Payment(json); }
}
