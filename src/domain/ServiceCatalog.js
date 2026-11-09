// Catálogo de servicios con sus horarios por defecto y precio base (COP).
export const SERVICES = Object.freeze({
  paseo: Object.freeze({ id: 'paseo', label: 'Paseo', defaultStart: '07:00', defaultEnd: '08:00', basePrice: 25000 }),
  guarderia: Object.freeze({ id: 'guarderia', label: 'Guardería de día', defaultStart: '08:00', defaultEnd: '17:00', basePrice: 60000 }),
  alojamiento: Object.freeze({ id: 'alojamiento', label: 'Alojamiento (una noche)', defaultStart: '18:00', defaultEnd: '08:00', basePrice: 85000, overnight: true }),
});

export function getService(id) {
  const service = SERVICES[id];
  if (!service) throw new Error(`Servicio desconocido: ${id}`);
  return service;
}
