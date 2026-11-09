import { html, when } from '../html.js';
import { statusChip, countdown, field, timeRange } from '../components.js';
import { SERVICES, getService } from '../../domain/ServiceCatalog.js';
import { BookingStatus } from '../../domain/BookingStatus.js';
import { CancellationPolicyFactory } from '../../domain/CancellationPolicy.js';
import { PAYMENT_METHODS, PaymentStatus } from '../../domain/Payment.js';
import { formatCOP, formatDay } from '../../shared/format.js';
import { addDays, dateKey } from '../../shared/time.js';
import { CAREGIVERS, OWNERS } from '../../app/seed.js';

const ZONES = [...new Set(CAREGIVERS.map((c) => c.zone))];

function nextDays(now) {
  const today = dateKey(now);
  return Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
}

function checkoutPanel(booking, payment, caregiverName, now) {
  const service = getService(booking.service);
  const waiting = payment && payment.status === PaymentStatus.PENDING;
  return html`
  <section class="checkout" aria-live="polite">
    <div class="tag">
      <span class="tag__hole" aria-hidden="true"></span>
      <span class="tag__label">Horario apartado</span>
      ${countdown(booking.holdExpiresAt)}
      <span class="tag__small">${waiting ? 'Te guardamos el horario mientras tu banco confirma' : 'para completar el pago'}</span>
    </div>
    <div class="checkout__body">
      <h2>${service.label} para ${booking.petName}</h2>
      <p class="muted">${caregiverName}, ${formatDay(booking.date)} de ${timeRange(booking.start, booking.end)}</p>
      <p class="checkout__price">${formatCOP(booking.price)}</p>
      ${waiting ? html`
        <div class="notice">
          <p><strong>Estamos esperando que ${payment.method === 'NEQUI' ? 'Nequi' : 'tu banco'} confirme el pago.</strong> No tienes que hacer nada más: apenas lo confirme, te avisamos y la reserva queda lista. Si el pago no pasa, no se te cobra.</p>
          <div class="sandbox-inline">
            <span>Solo en el prototipo, simula la respuesta del banco:</span>
            <button type="button" class="btn btn--small" data-action="owner-simulate" data-tx="${payment.transactionId}" data-result="APPROVED">Aprobar pago</button>
            <button type="button" class="btn btn--small btn--ghost" data-action="owner-simulate" data-tx="${payment.transactionId}" data-result="DECLINED">Rechazar pago</button>
          </div>
        </div>` : html`
        <form class="pay-form" data-action="owner-pay" data-booking="${booking.id}">
          <fieldset>
            <legend>Medio de pago</legend>
            ${Object.entries(PAYMENT_METHODS).map(([value, label], i) => html`
              <label class="radio"><input type="radio" name="method" value="${value}" ${i === 1 ? 'checked' : ''}> ${label}</label>`)}
          </fieldset>
          <button class="btn" type="submit">Pagar ${formatCOP(booking.price)}</button>
        </form>`}
    </div>
  </section>`;
}

function bookingRow(b, caregivers, ui, preview, rescheduleOptions) {
  const caregiver = caregivers.get(b.caregiverId);
  const actions = [];
  if (b.status === BookingStatus.HELD) actions.push(html`<button type="button" class="btn btn--small" data-action="owner-resume" data-booking="${b.id}">Continuar pago</button>`);
  if (b.status === BookingStatus.CONFIRMED) {
    actions.push(html`<button type="button" class="btn btn--small btn--ghost" data-action="owner-reschedule-open" data-booking="${b.id}">Reprogramar</button>`);
    actions.push(html`<button type="button" class="btn btn--small btn--ghost" data-action="owner-cancel-open" data-booking="${b.id}">Cancelar</button>`);
  }
  return html`
  <li class="booking">
    <div class="booking__main">
      <div>
        <strong>${getService(b.service).label}</strong> para ${b.petName} con ${caregiver?.name ?? 'cuidador'}
        <div class="muted">${formatDay(b.date)}, ${timeRange(b.start, b.end)}. ${formatCOP(b.price)}${b.refundAmount ? `. Reembolso: ${formatCOP(b.refundAmount)}` : ''}</div>
      </div>
      <div class="booking__side">${statusChip(b.status)}<div class="booking__actions">${actions}</div></div>
    </div>
    ${when(ui.cancelFor === b.id && preview, () => html`
      <div class="inline-panel">
        <p>Política ${preview.policy.label}: faltan ${Math.floor(preview.hoursBefore)} horas para el servicio, así que te devolvemos <strong>${formatCOP(preview.amount)}</strong> (${preview.ratio * 100} %).</p>
        <div class="row">
          <button type="button" class="btn btn--small btn--danger" data-action="owner-cancel-confirm" data-booking="${b.id}">Cancelar reserva</button>
          <button type="button" class="btn btn--small btn--ghost" data-action="owner-panel-close">Mantener reserva</button>
        </div>
      </div>`)}
    ${when(ui.rescheduleFor === b.id, () => html`
      <div class="inline-panel">
        ${rescheduleOptions.length ? html`
          <p>Horarios libres de ${caregiver?.name} para el mismo servicio:</p>
          <div class="slot-list">${rescheduleOptions.map((s) => html`
            <button type="button" class="slot" data-action="owner-reschedule" data-booking="${b.id}" data-slot="${s.id}">${formatDay(s.date)} ${s.start}</button>`)}</div>`
          : html`<p>${caregiver?.name} no tiene otros horarios libres para este servicio esta semana.</p>`}
        <button type="button" class="btn btn--small btn--ghost" data-action="owner-panel-close">Cerrar</button>
      </div>`)}
  </li>`;
}

export const ownerView = {
  inbox: (ctx) => ctx.app.notificationService.inbox('owner', ctx.ui.ownerId),

  async render(ctx) {
    const { app, ui } = ctx;
    const now = app.clock.now();
    const days = nextDays(now);
    if (!days.includes(ui.search.date)) ui.search.date = days[0];
    const owner = OWNERS.find((o) => o.id === ui.ownerId);
    if (!ui.search.pet) ui.search.pet = owner.pet;

    const caregivers = new Map((await app.repos.caregivers.findAll()).map((c) => [c.id, c]));
    const results = await app.availabilityService.search(ui.search);
    const myBookings = await app.bookingService.listByOwner(ui.ownerId);

    const active = myBookings.find((b) => b.id === ui.activeBookingId && b.status === BookingStatus.HELD);
    const activePayment = active?.paymentId ? await app.paymentService.findById(active.paymentId) : null;
    const justConfirmed = myBookings.find((b) => b.id === ui.activeBookingId && b.status === BookingStatus.CONFIRMED);

    const preview = ui.cancelFor ? await app.bookingService.refundPreview(ui.cancelFor) : null;
    let rescheduleOptions = [];
    if (ui.rescheduleFor) {
      const target = myBookings.find((b) => b.id === ui.rescheduleFor);
      rescheduleOptions = (await app.availabilityService.slotsOf(target.caregiverId))
        .filter((s) => s.service === target.service && s.id !== target.slotId && s.isAvailableAt(now) && s.startsAt() > now);
    }

    const grouped = new Map();
    for (const { slot, caregiver } of results) {
      if (!grouped.has(caregiver.id)) grouped.set(caregiver.id, { caregiver, slots: [] });
      grouped.get(caregiver.id).slots.push(slot);
    }

    return html`
    <header class="view-head">
      <div>
        <h1>Reservar un cuidador</h1>
        <p class="lead">Ves solo horarios que el cuidador ya publicó. Al elegir uno lo apartamos ${app.config.holdMinutes} minutos mientras pagas.</p>
      </div>
      ${field('Estás usando la cuenta de', html`<select data-action="owner-switch">${OWNERS.map((o) => html`<option value="${o.id}" ${o.id === ui.ownerId ? 'selected' : ''}>${o.name} (${o.pet})</option>`)}</select>`)}
    </header>

    ${when(active, () => checkoutPanel(active, activePayment, caregivers.get(active.caregiverId)?.name, now))}
    ${when(justConfirmed, () => html`
      <section class="confirmed" role="status">
        <h2>Reserva confirmada</h2>
        <p>${getService(justConfirmed.service).label} para ${justConfirmed.petName} el ${formatDay(justConfirmed.date)} a las ${justConfirmed.start}. ${caregivers.get(justConfirmed.caregiverId)?.name} ya recibió el aviso.</p>
        <button type="button" class="btn btn--small btn--ghost" data-action="owner-panel-close">Listo</button>
      </section>`)}

    <section class="panel">
      <form class="search" data-action="owner-search">
        ${field('Mascota', html`<input name="pet" required maxlength="40" value="${ui.search.pet}">`)}
        ${field('Servicio', html`<select name="service">${Object.values(SERVICES).map((s) => html`<option value="${s.id}" ${s.id === ui.search.service ? 'selected' : ''}>${s.label}</option>`)}</select>`)}
        ${field('Fecha', html`<select name="date">${days.map((d) => html`<option value="${d}" ${d === ui.search.date ? 'selected' : ''}>${formatDay(d)}</option>`)}</select>`)}
        ${field('Barrio o municipio', html`<select name="zone"><option value="">Todo el Valle de Aburrá</option>${ZONES.map((z) => html`<option value="${z}" ${z === ui.search.zone ? 'selected' : ''}>${z}</option>`)}</select>`)}
        <button class="btn" type="submit">Buscar horarios</button>
      </form>

      <h2 class="section-title">${results.length} horario${results.length === 1 ? '' : 's'} libre${results.length === 1 ? '' : 's'} el ${formatDay(ui.search.date)}</h2>
      ${grouped.size === 0 ? html`<p class="empty">Nadie publicó disponibilidad para ese servicio ese día. Prueba otra fecha o cambia el barrio.</p>` : html`
      <ul class="results">${[...grouped.values()].map(({ caregiver, slots }) => html`
        <li class="result">
          <div class="result__who">
            <span class="avatar" aria-hidden="true">${caregiver.name.split(' ').map((p) => p[0]).join('')}</span>
            <div>
              <strong>${caregiver.name}</strong>
              <div class="muted">${caregiver.zone}. ${caregiver.bio}</div>
              <div class="muted small">Cancelación ${CancellationPolicyFactory.get(caregiver.policy).label.toLowerCase()}: ${CancellationPolicyFactory.get(caregiver.policy).describe()}</div>
            </div>
            <span class="price">${formatCOP(caregiver.priceFor(ui.search.service))}</span>
          </div>
          <div class="slot-list">${slots.map((s) => html`
            <button type="button" class="slot" data-action="owner-hold" data-slot="${s.id}" ${active ? 'disabled' : ''}>${timeRange(s.start, s.end)}</button>`)}</div>
        </li>`)}</ul>`}
    </section>

    <section class="panel">
      <h2 class="section-title">Mis reservas</h2>
      ${myBookings.length === 0 ? html`<p class="empty">Todavía no tienes reservas. Elige un horario arriba para empezar.</p>`
        : html`<ul class="bookings">${myBookings.map((b) => bookingRow(b, caregivers, ui, b.id === ui.cancelFor ? preview : null, rescheduleOptions))}</ul>`}
    </section>`;
  },

  actions: {
    'owner-switch': (ctx, el) => {
      Object.assign(ctx.ui, { ownerId: el.value, activeBookingId: null, cancelFor: null, rescheduleFor: null });
      ctx.ui.search.pet = OWNERS.find((o) => o.id === el.value).pet;
    },
    'owner-search': (ctx, el, data) => {
      Object.assign(ctx.ui.search, { pet: data.get('pet'), service: data.get('service'), date: data.get('date'), zone: data.get('zone') });
    },
    'owner-hold': async (ctx, el) => {
      const booking = await ctx.app.bookingService.requestBooking({ ownerId: ctx.ui.ownerId, petName: ctx.ui.search.pet, slotId: el.dataset.slot });
      ctx.ui.activeBookingId = booking.id;
      ctx.toast('Horario apartado. Tienes 10 minutos para pagar.');
    },
    'owner-pay': async (ctx, el, data) => {
      await ctx.app.paymentService.startPayment({ bookingId: el.dataset.booking, ownerId: ctx.ui.ownerId, method: data.get('method') });
    },
    'owner-simulate': async (ctx, el) => {
      const { delivered } = await ctx.app.gateway.simulateResult(el.dataset.tx, el.dataset.result);
      if (!delivered) ctx.toast('La pasarela respondió, pero el aviso no llegó (caída simulada). La conciliación lo recupera.', 'warn');
    },
    'owner-resume': (ctx, el) => { ctx.ui.activeBookingId = el.dataset.booking; },
    'owner-cancel-open': (ctx, el) => { Object.assign(ctx.ui, { cancelFor: el.dataset.booking, rescheduleFor: null }); },
    'owner-reschedule-open': (ctx, el) => { Object.assign(ctx.ui, { rescheduleFor: el.dataset.booking, cancelFor: null }); },
    'owner-panel-close': (ctx) => { Object.assign(ctx.ui, { cancelFor: null, rescheduleFor: null, activeBookingId: null }); },
    'owner-cancel-confirm': async (ctx, el) => {
      const { refundAmount } = await ctx.app.bookingService.cancelByOwner(el.dataset.booking, ctx.ui.ownerId);
      ctx.ui.cancelFor = null;
      ctx.toast(`Reserva cancelada. Reembolso de ${formatCOP(refundAmount)} en camino.`);
    },
    'owner-reschedule': async (ctx, el) => {
      await ctx.app.bookingService.reschedule(el.dataset.booking, ctx.ui.ownerId, el.dataset.slot);
      ctx.ui.rescheduleFor = null;
      ctx.toast('Reserva reprogramada. El cuidador ya fue avisado.');
    },
  },
};
