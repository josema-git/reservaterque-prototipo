import { TEMPLATES } from './notifications/templates.js';
import { newId } from '../shared/ids.js';

export class NotificationService {
  #repository; #channels; #clock;

  constructor({ notificationRepository, channels, clock, eventBus }) {
    this.#repository = notificationRepository;
    this.#channels = channels;
    this.#clock = clock;
    for (const type of Object.keys(TEMPLATES)) {
      eventBus.subscribe(type, (event) => this.#dispatch(event));
    }
  }

  async #dispatch(event) {
    const messages = TEMPLATES[event.type](event.payload);
    for (const message of messages) {
      const now = this.#clock.now();
      // Los mensajes al equipo administrativo solo van por la app.
      const channels = message.to === 'admin' ? this.#channels.filter((c) => c.id === 'app') : this.#channels;
      const deliveries = await Promise.all(channels.map((channel) => channel.send(message, now)));
      await this.#repository.save({ id: newId('ntf'), ...message, event: event.type, createdAt: now, deliveries });
    }
  }

  async inbox(recipientType, recipientId) {
    return (await this.#repository.findAll((n) => n.to === recipientType && n.recipientId === recipientId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Indicador del criterio de aceptación 5: entregas en menos de un minuto.
  async deliveryStats() {
    const deliveries = (await this.#repository.findAll()).flatMap((n) => n.deliveries.map((d) => d.deliveredAt - n.createdAt));
    const fast = deliveries.filter((ms) => ms < 60_000).length;
    return { total: deliveries.length, underOneMinute: fast, ratio: deliveries.length ? fast / deliveries.length : 1 };
  }
}
