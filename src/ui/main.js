import { createContainer } from '../app/container.js';
import { seedIfEmpty } from '../app/seed.js';
import { createBrowserStorage } from '../infrastructure/persistence/storage.js';
import { SimulatedClock } from '../infrastructure/SimulatedClock.js';
import { DomainError } from '../domain/errors.js';
import { ownerView } from './views/ownerView.js';
import { caregiverView } from './views/caregiverView.js';
import { adminView } from './views/adminView.js';
import { gatewayView } from './views/gatewayView.js';
import { inboxList, formatRemaining } from './components.js';
import { formatDateTime } from '../shared/format.js';
import { MINUTE } from '../shared/time.js';

const VIEWS = { dueno: ownerView, cuidador: caregiverView, admin: adminView, pasarela: gatewayView };
const INBOX_TITLES = { dueno: 'Avisos del dueño', cuidador: 'Avisos del cuidador', admin: 'Avisos del equipo Terque', pasarela: 'Avisos del equipo Terque' };

const storage = createBrowserStorage();
const clock = new SimulatedClock(storage);
const app = createContainer({ storage, clock, onError: (error) => console.error(error) });
await seedIfEmpty(app, storage);

const $view = document.getElementById('view');
const $inbox = document.getElementById('inbox');
const $inboxTitle = document.getElementById('inbox-title');
const $clock = document.getElementById('clock');
const $toasts = document.getElementById('toasts');

const ui = {
  ownerId: 'own_laura',
  caregiverId: 'cg_mariana',
  search: { service: 'paseo', date: '', zone: '', pet: '' },
  activeBookingId: null,
  cancelFor: null,
  rescheduleFor: null,
  caregiverCancelFor: null,
  publishService: null,
};

const currentRoute = () => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dueno');

function toast(message, tone = 'info') {
  const node = document.createElement('div');
  node.className = `toast toast--${tone}`;
  node.textContent = message;
  while ($toasts.children.length >= 2) $toasts.firstElementChild.remove();
  $toasts.append(node);
  setTimeout(() => node.remove(), tone === 'error' ? 7000 : 4500);
}

const ctx = { app, ui, toast };

let rendering = Promise.resolve();
function render() {
  rendering = rendering.then(async () => {
    const route = currentRoute();
    const view = VIEWS[route];
    $view.innerHTML = String(await view.render(ctx));
    $inboxTitle.textContent = INBOX_TITLES[route];
    $inbox.innerHTML = String(inboxList(await view.inbox(ctx)));
    document.querySelectorAll('[data-route]').forEach((a) => {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    paintClock();
    tickCountdowns();
  }).catch((error) => {
    console.error(error);
    $view.innerHTML = '<p class="empty">No se pudo dibujar la vista. Usa «Reiniciar datos» para volver al estado inicial.</p>';
  });
  return rendering;
}

const GLOBAL_ACTIONS = {
  'clock-advance': (c, el) => {
    clock.advance(Number(el.dataset.minutes) * MINUTE);
    toast(`Reloj simulado adelantado ${el.dataset.label}.`);
    return app.bookingService.expireHolds();
  },
  'clock-reset': () => { clock.reset(); },
  'reset-data': () => {
    if (!confirm('Se borrarán las reservas y pagos de esta demo. ¿Continuar?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('reservaterque:')).forEach((k) => localStorage.removeItem(k));
    location.reload();
  },
};

async function run(name, el, data) {
  const handler = GLOBAL_ACTIONS[name] ?? VIEWS[currentRoute()].actions[name];
  if (!handler) return;
  try {
    await handler(ctx, el, data);
  } catch (error) {
    if (error instanceof DomainError) toast(error.message, 'error');
    else { console.error(error); toast('Ocurrió un error inesperado. El detalle quedó en la consola del navegador.', 'error'); }
  }
  await render();
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('button[data-action]');
  if (el && !el.disabled) run(el.dataset.action, el);
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.matches('select[data-action], input[type="checkbox"][data-action]')) run(el.dataset.action, el);
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-action]');
  if (!form) return;
  event.preventDefault();
  run(form.dataset.action, form, new FormData(form));
});

window.addEventListener('hashchange', () => render());

function paintClock() {
  $clock.textContent = formatDateTime(clock.now());
}

let expiring = false;
function tickCountdowns() {
  const now = clock.now();
  let reachedZero = false;
  document.querySelectorAll('[data-countdown]').forEach((node) => {
    const remaining = Number(node.dataset.countdown) - now;
    node.textContent = formatRemaining(remaining);
    if (remaining <= 0) reachedZero = true;
  });
  if (reachedZero && !expiring) {
    expiring = true;
    app.bookingService.expireHolds().then((n) => (n ? render() : null)).finally(() => { expiring = false; });
  }
}

setInterval(() => { paintClock(); tickCountdowns(); }, 1000);
setInterval(async () => { if (await app.bookingService.expireHolds()) render(); }, 5000);

render();
