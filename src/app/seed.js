import { Caregiver } from '../domain/Caregiver.js';
import { Slot } from '../domain/Slot.js';
import { addDays, dateKey } from '../shared/time.js';
import { newId } from '../shared/ids.js';

export const SEED_VERSION = '1';

// Datos ficticios para la prueba piloto en Medellín y el Valle de Aburrá.
export const CAREGIVERS = [
  { id: 'cg_mariana', name: 'Mariana Ríos', zone: 'Laureles', services: ['paseo', 'guarderia'], policy: 'flexible', prices: { paseo: 22000 }, bio: 'Paseadora, 3 años con perros grandes.' },
  { id: 'cg_julian', name: 'Julián Ospina', zone: 'El Poblado', services: ['paseo', 'alojamiento'], policy: 'moderada', prices: { alojamiento: 95000 }, bio: 'Casa con patio cerrado. Acepta gatos.' },
  { id: 'cg_daniela', name: 'Daniela Restrepo', zone: 'Envigado', services: ['guarderia', 'alojamiento'], policy: 'estricta', bio: 'Auxiliar veterinaria. Recibe mascotas con medicación.' },
  { id: 'cg_camilo', name: 'Camilo Arango', zone: 'Belén', services: ['paseo'], policy: 'moderada', prices: { paseo: 20000 }, bio: 'Paseos en grupo pequeño por el parque de Belén.' },
];

export const OWNERS = [
  { id: 'own_laura', name: 'Laura Gómez', pet: 'Toby' },
  { id: 'own_andres', name: 'Andrés Mejía', pet: 'Luna' },
];

const PATTERNS = {
  paseo: [['07:00', '08:00'], ['17:00', '18:00']],
  guarderia: [['08:00', '17:00']],
  alojamiento: [['18:00', '08:00']],
};

export async function seedIfEmpty(container, storage) {
  const { repos } = container;
  const firstRun = !(storage.getItem('reservaterque:seed') === SEED_VERSION && (await repos.caregivers.count()) > 0);
  if (firstRun) {
    for (const data of CAREGIVERS) await repos.caregivers.save(new Caregiver(data));
    for (const owner of OWNERS) await repos.owners.save(owner);
    storage.setItem('reservaterque:seed', SEED_VERSION);
  }
  await ensureUpcomingAvailability(container);
  return firstRun;
}

// Mantiene la demo viva: si alguno de los próximos 7 días no tiene ningún
// horario publicado (por ejemplo, porque la demo se abre semanas después),
// se publica la agenda de ejemplo para ese día.
export async function ensureUpcomingAvailability({ repos, clock }) {
  const today = dateKey(clock.now());
  const slots = await repos.slots.findAll();
  const covered = new Set(slots.map((s) => s.date));
  for (let day = 1; day <= 7; day += 1) {
    const date = addDays(today, day);
    if (covered.has(date)) continue;
    for (const caregiver of CAREGIVERS) {
      for (const service of caregiver.services) {
        for (const [start, end] of PATTERNS[service]) {
          // Se omiten algunos espacios para que la agenda se vea realista.
          if ((Number(date.slice(-2)) + caregiver.id.length + start.length) % 4 === 0) continue;
          await repos.slots.save(new Slot({ id: newId('slot'), caregiverId: caregiver.id, date, start, end, service }));
        }
      }
    }
  }
}
