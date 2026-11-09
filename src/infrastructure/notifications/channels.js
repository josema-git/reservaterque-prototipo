// Canales de notificación. En el prototipo todos registran el envío; en
// producción cada uno envolvería su proveedor (FCM, correo transaccional,
// WhatsApp Business API) sin cambiar el servicio que los usa.
class SimulatedChannel {
  constructor(id, label, latencyMs) { Object.assign(this, { id, label, latencyMs }); }
  async send(notification, now) { return { channel: this.id, deliveredAt: now + this.latencyMs }; }
}

export const createDefaultChannels = () => [
  new SimulatedChannel('app', 'App', 300),
  new SimulatedChannel('email', 'Correo', 2500),
  new SimulatedChannel('whatsapp', 'WhatsApp', 1500),
];
