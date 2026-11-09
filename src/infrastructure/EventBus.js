// Patrón Observer: los servicios publican eventos de dominio y otros módulos
// (notificaciones, auditoría, reembolsos) reaccionan sin acoplarse entre sí.
export class EventBus {
  #handlers = new Map();
  #clock;
  #onError;

  constructor(clock, onError = (error) => console.error(error)) {
    this.#clock = clock;
    this.#onError = onError;
  }

  subscribe(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.#handlers.get(type)?.delete(handler);
  }

  async publish(type, payload = {}) {
    const event = { type, payload, at: this.#clock.now() };
    const handlers = [...(this.#handlers.get(type) ?? []), ...(this.#handlers.get('*') ?? [])];
    for (const handler of handlers) {
      // Un observador que falla no debe tumbar el flujo de la reserva.
      try { await handler(event); } catch (error) { this.#onError(error, event); }
    }
    return event;
  }
}
