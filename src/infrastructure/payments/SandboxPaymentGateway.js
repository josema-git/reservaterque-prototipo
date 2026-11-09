import { PaymentGateway } from '../../application/ports/PaymentGateway.js';
import { newId } from '../../shared/ids.js';

// Adaptador que imita el ambiente de pruebas de una pasarela colombiana.
// Permite aprobar o rechazar transacciones, reenviar una notificación
// (duplicado) y simular una caída de comunicación en la que los webhooks
// no llegan, para probar la conciliación.
export class SandboxPaymentGateway extends PaymentGateway {
  #transactions;
  #clock;
  #signer;
  #storage;
  #webhookHandler = null;
  static OUTAGE_KEY = 'reservaterque:gatewayOutage';

  constructor({ repository, clock, signer, storage }) {
    super();
    this.#transactions = repository;
    this.#clock = clock;
    this.#signer = signer;
    this.#storage = storage;
  }

  onWebhook(handler) { this.#webhookHandler = handler; }

  get outage() { return this.#storage.getItem(SandboxPaymentGateway.OUTAGE_KEY) === '1'; }

  setOutage(value) {
    if (value) this.#storage.setItem(SandboxPaymentGateway.OUTAGE_KEY, '1');
    else this.#storage.removeItem(SandboxPaymentGateway.OUTAGE_KEY);
  }

  async createTransaction({ reference, amount, method }) {
    const tx = { id: newId('tx'), reference, amount, method, status: 'PENDING', createdAt: this.#clock.now(), deliveries: [], refunds: [] };
    await this.#transactions.save(tx);
    return { transactionId: tx.id, status: tx.status };
  }

  async getTransaction(transactionId) {
    const tx = await this.#require(transactionId);
    return { id: tx.id, status: tx.status, amount: tx.amount, reference: tx.reference };
  }

  async refund(transactionId, amount) {
    const tx = await this.#require(transactionId);
    const refund = { id: newId('rf'), amount, at: this.#clock.now() };
    tx.refunds.push(refund);
    await this.#transactions.save(tx);
    return { refundId: refund.id };
  }

  async listTransactions() {
    return (await this.#transactions.findAll()).sort((a, b) => b.createdAt - a.createdAt);
  }

  // --- Controles del ambiente de pruebas ---

  async simulateResult(transactionId, status) {
    const tx = await this.#require(transactionId);
    if (tx.status !== 'PENDING') throw new Error('La transacción ya tiene un resultado.');
    tx.status = status;
    tx.finalizedAt = this.#clock.now();
    await this.#transactions.save(tx);
    return this.#deliver(tx, newId('evt'));
  }

  // Reenvía exactamente la misma notificación, como hacen las pasarelas
  // cuando no reciben confirmación a tiempo.
  async redeliver(transactionId) {
    const tx = await this.#require(transactionId);
    const last = tx.deliveries.at(-1);
    if (!last) throw new Error('Esta transacción todavía no ha enviado notificaciones.');
    return this.#deliver(tx, last.eventId, last.sentAt);
  }

  async #deliver(tx, eventId, sentAt = this.#clock.now()) {
    const event = { eventId, type: 'transaction.updated', sentAt, data: { transactionId: tx.id, reference: tx.reference, status: tx.status, amount: tx.amount } };
    event.signature = await this.#signer.sign(event);
    const delivered = !this.outage && Boolean(this.#webhookHandler);
    tx.deliveries.push({ eventId, sentAt, attemptAt: this.#clock.now(), delivered });
    await this.#transactions.save(tx);
    if (!delivered) return { delivered: false, event };
    const result = await this.#webhookHandler(event);
    return { delivered: true, event, result };
  }

  async #require(transactionId) {
    const tx = await this.#transactions.findById(transactionId);
    if (!tx) throw new Error(`Transacción ${transactionId} no existe en la pasarela.`);
    return tx;
  }
}
