// Puerto (interfaz) de la pasarela de pagos. La aplicación solo conoce estos
// métodos; Wompi, PayU o el simulador del prototipo son adaptadores.
export class PaymentGateway {
  /** @returns {Promise<{transactionId: string, status: string}>} */
  async createTransaction({ reference, amount, method }) { throw new Error('No implementado'); }

  /** @returns {Promise<{id: string, status: string, amount: number, reference: string}>} */
  async getTransaction(transactionId) { throw new Error('No implementado'); }

  /** @returns {Promise<{refundId: string}>} */
  async refund(transactionId, amount) { throw new Error('No implementado'); }

  /** Registra la función que recibe las notificaciones (webhooks). */
  onWebhook(handler) { throw new Error('No implementado'); }
}
