import { sha256Hex } from '../shared/hash.js';

// Verifica la firma de integridad de cada notificación, al estilo del
// checksum de eventos de Wompi: concatenar campos + secreto y aplicar SHA-256.
export class WebhookVerifier {
  #secret;
  constructor(secret) { this.#secret = secret; }

  static payloadFor(event) {
    const { transactionId, status, amount } = event.data;
    return `${event.eventId}|${transactionId}|${status}|${amount}|${event.sentAt}`;
  }

  async sign(event) { return sha256Hex(`${WebhookVerifier.payloadFor(event)}|${this.#secret}`); }

  async verify(event) {
    if (!event?.signature || !event?.data) return false;
    return (await this.sign(event)) === event.signature;
  }
}
