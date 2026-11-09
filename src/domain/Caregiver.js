import { getService } from './ServiceCatalog.js';

export class Caregiver {
  constructor({ id, name, zone, city = 'Medellín', services, prices = {}, policy = 'moderada', bio = '' }) {
    Object.assign(this, { id, name, zone, city, services: [...services], prices: { ...prices }, policy, bio });
  }

  offers(serviceId) { return this.services.includes(serviceId); }

  priceFor(serviceId) { return this.prices[serviceId] ?? getService(serviceId).basePrice; }

  changePolicy(policyName) { this.policy = policyName; }

  toJSON() { return { ...this }; }

  static fromJSON(json) { return new Caregiver(json); }
}
