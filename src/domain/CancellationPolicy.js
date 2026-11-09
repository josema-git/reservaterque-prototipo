// Patrón Strategy: cada cuidador elige una política y la reserva guarda una
// copia de su identificador al crearse, para que un cambio posterior no
// altere las condiciones que el dueño aceptó al pagar.
class CancellationPolicy {
  constructor({ id, label, fullRefundHours, halfRefundHours, rescheduleLimitHours }) {
    Object.assign(this, { id, label, fullRefundHours, halfRefundHours, rescheduleLimitHours });
    Object.freeze(this);
  }

  refundRatio(hoursBefore) {
    if (hoursBefore >= this.fullRefundHours) return 1;
    if (hoursBefore >= this.halfRefundHours) return 0.5;
    return 0;
  }

  canReschedule(hoursBefore) { return hoursBefore >= this.rescheduleLimitHours; }

  describe() {
    return `Reembolso total hasta ${this.fullRefundHours} h antes, 50 % hasta ${this.halfRefundHours} h antes. Reprogramación gratis hasta ${this.rescheduleLimitHours} h antes.`;
  }
}

const POLICIES = Object.freeze({
  flexible: new CancellationPolicy({ id: 'flexible', label: 'Flexible', fullRefundHours: 24, halfRefundHours: 2, rescheduleLimitHours: 6 }),
  moderada: new CancellationPolicy({ id: 'moderada', label: 'Moderada', fullRefundHours: 48, halfRefundHours: 24, rescheduleLimitHours: 24 }),
  estricta: new CancellationPolicy({ id: 'estricta', label: 'Estricta', fullRefundHours: 72, halfRefundHours: 48, rescheduleLimitHours: 48 }),
});

export const CancellationPolicyFactory = Object.freeze({
  get(id) {
    const policy = POLICIES[id];
    if (!policy) throw new Error(`Política desconocida: ${id}`);
    return policy;
  },
  all() { return Object.values(POLICIES); },
});
