import { html, when } from '../html.js';
import { countdown, field, timeRange } from '../components.js';
import { getService } from '../../domain/ServiceCatalog.js';
import { SlotState } from '../../domain/Slot.js';
import { CancellationPolicyFactory } from '../../domain/CancellationPolicy.js';
import { formatDay } from '../../shared/format.js';
import { addDays, dateKey } from '../../shared/time.js';
import { OWNERS } from '../../app/seed.js';

const ownerName = (id) => OWNERS.find((o) => o.id === id)?.name ?? 'dueño sin nombre';

function slotRow(slot, booking, ui, now) {
  const service = getService(slot.service);
  const held = slot.state === SlotState.HELD && slot.holdUntil > now;
  let state;
  if (slot.state === SlotState.BOOKED) state = html`<span class="chip chip--ok">Reservado: ${booking?.petName ?? ''}, de ${ownerName(booking?.ownerId)}</span>`;
  else if (held) state = html`<span class="chip chip--wait">Un dueño está pagando ${countdown(slot.holdUntil)}</span>`;
  else state = html`<span class="chip chip--free">Libre</span>`;

  return html`
  <li class="agenda__slot">
    <div class="agenda__time"><strong>${timeRange(slot.start, slot.end)}</strong><span class="muted">${service.label}</span></div>
    <div class="agenda__state">${state}</div>
    <div class="agenda__actions">
      ${slot.state === SlotState.BOOKED
        ? html`<button type="button" class="btn btn--small btn--ghost" data-action="cg-cancel-open" data-booking="${slot.bookingId}">No puedo atenderla</button>`
        : html`<button type="button" class="btn btn--small btn--ghost" data-action="cg-remove" data-slot="${slot.id}">Quitar horario</button>`}
    </div>
    ${when(ui.caregiverCancelFor === slot.bookingId && slot.state === SlotState.BOOKED, () => html`
      <form class="inline-panel" data-action="cg-cancel" data-booking="${slot.bookingId}">
        <p>El dueño recibe el reembolso total y le mostramos otros cuidadores con horario libre ese día. Las cancelaciones frecuentes afectan tu perfil.</p>
        ${field('Motivo (lo verá el equipo de Terque)', html`<input name="reason" maxlength="120" placeholder="Por ejemplo: calamidad familiar">`)}
        <div class="row">
          <button class="btn btn--small btn--danger" type="submit">Cancelar reserva</button>
          <button type="button" class="btn btn--small btn--ghost" data-action="cg-cancel-close">Volver</button>
        </div>
      </form>`)}
  </li>`;
}

export const caregiverView = {
  inbox: (ctx) => ctx.app.notificationService.inbox('caregiver', ctx.ui.caregiverId),

  async render(ctx) {
    const { app, ui } = ctx;
    const now = app.clock.now();
    const caregivers = await app.repos.caregivers.findAll();
    const me = caregivers.find((c) => c.id === ui.caregiverId);
    const slots = await app.availabilityService.slotsOf(me.id);
    const bookings = new Map((await app.bookingService.listByCaregiver(me.id)).map((b) => [b.id, b]));
    const today = dateKey(now);
    const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));
    const policy = CancellationPolicyFactory.get(me.policy);
    const defaultService = getService(ui.publishService && me.offers(ui.publishService) ? ui.publishService : me.services[0]);

    const byDay = days.map((d) => ({ date: d, slots: slots.filter((s) => s.date === d) })).filter((g) => g.slots.length);

    return html`
    <header class="view-head">
      <div>
        <h1>Mi disponibilidad</h1>
        <p class="lead">Lo que publiques aquí es lo único que los dueños pueden reservar. Mantenerlo al día evita cancelaciones.</p>
      </div>
      ${field('Cuidador', html`<select data-action="cg-switch">${caregivers.map((c) => html`<option value="${c.id}" ${c.id === me.id ? 'selected' : ''}>${c.name} (${c.zone})</option>`)}</select>`)}
    </header>

    <div class="split">
      <section class="panel">
        <h2 class="section-title">Publicar un horario</h2>
        <form class="publish" data-action="cg-publish">
          ${field('Servicio', html`<select name="service" data-action="cg-service">${me.services.map((id) => html`<option value="${id}" ${id === defaultService.id ? 'selected' : ''}>${getService(id).label}</option>`)}</select>`)}
          ${field('Fecha', html`<select name="date">${days.slice(1).map((d) => html`<option value="${d}">${formatDay(d)}</option>`)}</select>`)}
          <div class="row">
            ${field('Desde', html`<input type="time" name="start" required value="${defaultService.defaultStart}">`)}
            ${field('Hasta', html`<input type="time" name="end" required value="${defaultService.defaultEnd}">`, defaultService.overnight ? 'Termina al día siguiente' : '')}
          </div>
          <button class="btn" type="submit">Publicar horario</button>
        </form>
      </section>

      <section class="panel">
        <h2 class="section-title">Política de cancelación</h2>
        ${field('Aplica a las reservas nuevas', html`<select data-action="cg-policy">${CancellationPolicyFactory.all().map((p) => html`<option value="${p.id}" ${p.id === me.policy ? 'selected' : ''}>${p.label}</option>`)}</select>`)}
        <p class="muted">${policy.describe()}</p>
        <p class="muted small">Las reservas ya pagadas conservan la política que el dueño aceptó al pagar.</p>
      </section>
    </div>

    <section class="panel">
      <h2 class="section-title">Agenda de los próximos días</h2>
      ${byDay.length === 0 ? html`<p class="empty">No tienes horarios publicados. Publica el primero para empezar a recibir reservas.</p>` : html`
      <div class="agenda">${byDay.map((g) => html`
        <div class="agenda__day">
          <h3>${formatDay(g.date)}</h3>
          <ul>${g.slots.map((s) => slotRow(s, bookings.get(s.bookingId), ui, now))}</ul>
        </div>`)}</div>`}
    </section>`;
  },

  actions: {
    'cg-switch': (ctx, el) => { Object.assign(ctx.ui, { caregiverId: el.value, caregiverCancelFor: null, publishService: null }); },
    'cg-service': (ctx, el) => { ctx.ui.publishService = el.value; },
    'cg-publish': async (ctx, el, data) => {
      const slot = await ctx.app.availabilityService.publishSlot(ctx.ui.caregiverId, {
        service: data.get('service'), date: data.get('date'), start: data.get('start'), end: data.get('end'),
      });
      ctx.toast(`Horario publicado: ${formatDay(slot.date)}, ${slot.start}.`);
    },
    'cg-remove': async (ctx, el) => {
      if (!window.confirm('¿Quitar este horario de tu agenda? Los dueños dejarán de verlo.')) return;
      await ctx.app.availabilityService.removeSlot(ctx.ui.caregiverId, el.dataset.slot);
      ctx.toast('Horario quitado de tu agenda.');
    },
    'cg-policy': async (ctx, el) => {
      await ctx.app.availabilityService.changePolicy(ctx.ui.caregiverId, el.value);
      ctx.toast('Política actualizada para las próximas reservas.');
    },
    'cg-cancel-open': (ctx, el) => { ctx.ui.caregiverCancelFor = el.dataset.booking; },
    'cg-cancel-close': (ctx) => { ctx.ui.caregiverCancelFor = null; },
    'cg-cancel': async (ctx, el, data) => {
      const { alternatives } = await ctx.app.bookingService.cancelByCaregiver(el.dataset.booking, ctx.ui.caregiverId, data.get('reason'));
      ctx.ui.caregiverCancelFor = null;
      ctx.toast(`Reserva cancelada. Reembolso total al dueño y ${alternatives.length} alternativa(s) sugerida(s).`);
    },
  },
};
