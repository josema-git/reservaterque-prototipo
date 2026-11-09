import { Payment, PaymentStatus } from '../domain/Payment.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { newId } from '../shared/ids.js';
import { MINUTE } from '../shared/time.js';

const FINAL_STATUS = Object.freeze({ APPROVED: PaymentStatus.APPROVED, DECLINED: PaymentStatus.DECLINED, ERROR: PaymentStatus.DECLINED, VOIDED: PaymentStatus.DECLINED });

export class PaymentService {
  #payments; #processedEvents; #bookingService; #gateway; #verifier; #clock; #bus; #mutex; #config;

  constructor({ paymentRepository, processedEventRepository, bookingService, gateway, webhookVerifier, clock, eventBus, mutex, config }) {
    this.#payments = paymentRepository;
    this.#processedEvents = processedEventRepository;
    this.#bookingService = bookingService;
    this.#gateway = gateway;
    this.#verifier = webhookVerifier;
    this.#clock = clock;
    this.#bus = eventBus;
    this.#mutex = mutex;
    this.#config = config;

    gateway.onWebhook((event) => this.handleWebhook(event));
    // Los reembolsos reaccionan a eventos de cancelación (Observer), así el
    // servicio de reservas no depende del de pagos.
    eventBus.subscribe('booking.cancelled_by_owner', (e) => this.#refundBooking(e.payload.booking, e.payload.refundAmount, 'Cancelación del dueño'));
    eventBus.subscribe('booking.cancelled_by_caregiver', (e) => this.#refundBooking(e.payload.booking, e.payload.refundAmount, 'Cancelación del cuidador'));
  }

  async startPayment({ bookingId, ownerId, method }) {
    return this.#mutex.run(`booking-payment:${bookingId}`, async () => {
      const booking = await this.#bookingService.findById(bookingId);
      if (!booking || booking.ownerId !== ownerId) throw new NotFoundError('la reserva');
      // Idempotencia del lado del cliente: un doble clic no genera dos cobros.
      if (booking.paymentId) {
        const existing = await this.#payments.findById(booking.paymentId);
        if (existing && !existing.isFinal()) return existing;
      }
      if (!booking.isHoldActive(this.#clock.now())) throw new ValidationError('El tiempo para pagar venció. Vuelve a elegir un horario.');

      const tx = await this.#gateway.createTransaction({ reference: booking.id, amount: booking.price, method });
      const now = this.#clock.now();
      const payment = Payment.create({ id: newId('pay'), bookingId, transactionId: tx.transactionId, method, amount: booking.price, now });
      await this.#payments.save(payment);
      await this.#bookingService.attachPayment(bookingId, payment.id, now + this.#config.verificationMinutes * MINUTE);
      await this.#bus.publish('payment.started', { payment: payment.toJSON() });
      return payment;
    });
  }

  // Punto de entrada de las notificaciones de la pasarela (webhook).
  async handleWebhook(event) {
    if (!(await this.#verifier.verify(event))) {
      await this.#bus.publish('webhook.invalid_signature', { eventId: event?.eventId ?? 'desconocido' });
      return { accepted: false, reason: 'invalid_signature' };
    }
    return this.#mutex.run(`webhook:${event.eventId}`, async () => {
      // Primera capa de idempotencia: el identificador del evento.
      if (await this.#processedEvents.findById(event.eventId)) {
        await this.#bus.publish('webhook.duplicate_ignored', { eventId: event.eventId, transactionId: event.data.transactionId });
        return { accepted: true, duplicate: true };
      }
      const result = await this.#applyTransactionStatus(event.data.transactionId, event.data.status, 'webhook');
      // Se marca como procesado solo después de aplicarlo: si algo falla, el
      // reintento de la pasarela o la conciliación lo recuperan.
      await this.#processedEvents.save({ id: event.eventId, transactionId: event.data.transactionId, processedAt: this.#clock.now() });
      return { accepted: true, duplicate: false, ...result };
    });
  }

  // Conciliación: consulta a la pasarela los pagos que siguen pendientes
  // (por ejemplo, porque el webhook nunca llegó) y aplica su resultado.
  async reconcile() {
    const pending = await this.#payments.findAll((p) => p.status === PaymentStatus.PENDING);
    let resolved = 0;
    for (const payment of pending) {
      const tx = await this.#gateway.getTransaction(payment.transactionId);
      if (tx.status === 'PENDING') continue;
      const { outcome } = await this.#applyTransactionStatus(payment.transactionId, tx.status, 'conciliación');
      if (outcome !== 'already_processed') resolved += 1;
    }
    await this.#bus.publish('payment.reconciled', { checked: pending.length, resolved });
    return { checked: pending.length, resolved };
  }

  async listAll() { return (await this.#payments.findAll()).sort((a, b) => b.createdAt - a.createdAt); }

  async findById(id) { return this.#payments.findById(id); }

  async #applyTransactionStatus(transactionId, gatewayStatus, source) {
    const [found] = await this.#payments.findAll((p) => p.transactionId === transactionId);
    if (!found) {
      await this.#bus.publish('payment.unknown_transaction', { transactionId });
      return { outcome: 'unknown_transaction' };
    }
    const status = FINAL_STATUS[gatewayStatus];
    if (!status) return { outcome: 'still_pending' };

    return this.#mutex.run(`payment:${found.id}`, async () => {
      const payment = await this.#payments.findById(found.id);
      // Segunda capa de idempotencia: un pago con resultado final no se vuelve a aplicar.
      if (payment.isFinal()) return { outcome: 'already_processed' };
      payment.resolve(status, this.#clock.now(), source);
      await this.#payments.save(payment);

      if (status === PaymentStatus.APPROVED) {
        await this.#bus.publish('payment.approved', { payment: payment.toJSON(), source });
        const result = await this.#bookingService.applyApprovedPayment(payment.bookingId);
        if (result.outcome === 'late_refund') await this.#refund(payment, payment.amount, 'Pago tardío sobre un horario ya tomado');
        return { outcome: result.outcome };
      }
      await this.#bus.publish('payment.declined', { payment: payment.toJSON(), source });
      const result = await this.#bookingService.applyRejectedPayment(payment.bookingId);
      return { outcome: result.outcome };
    });
  }

  async #refundBooking(bookingJson, amount, reason) {
    if (!bookingJson.paymentId || amount <= 0) return;
    const payment = await this.#payments.findById(bookingJson.paymentId);
    if (payment?.status === PaymentStatus.APPROVED) await this.#refund(payment, amount, reason);
  }

  async #refund(payment, amount, reason) {
    const { refundId } = await this.#gateway.refund(payment.transactionId, amount);
    payment.registerRefund(amount);
    await this.#payments.save(payment);
    await this.#bus.publish('payment.refunded', { payment: payment.toJSON(), amount, reason, refundId });
  }
}
