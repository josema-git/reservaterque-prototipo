import { newId } from '../shared/ids.js';

// Bitácora de todos los eventos de dominio: da la trazabilidad que hoy se
// pierde en las conversaciones de mensajería.
export class AuditLog {
  #repository;
  static LIMIT = 400;

  constructor({ auditRepository, eventBus }) {
    this.#repository = auditRepository;
    eventBus.subscribe('*', (event) => this.#record(event));
  }

  async #record({ type, payload, at }) {
    const ref = payload.booking?.id ?? payload.payment?.bookingId ?? payload.eventId ?? payload.slot?.id ?? payload.slotId ?? payload.caregiverId ?? '';
    await this.#repository.save({ id: newId('log'), type, at, ref });
    const all = await this.#repository.findAll();
    if (all.length > AuditLog.LIMIT) {
      const oldest = all.sort((a, b) => a.at - b.at).slice(0, all.length - AuditLog.LIMIT);
      for (const row of oldest) await this.#repository.delete(row.id);
    }
  }

  async recent(limit = 60) {
    return (await this.#repository.findAll()).sort((a, b) => b.at - a.at).slice(0, limit);
  }

  async countByType(type) {
    return (await this.#repository.findAll((e) => e.type === type)).length;
  }
}
