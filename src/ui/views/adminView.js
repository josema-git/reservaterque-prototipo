import { html } from '../html.js';
import { statusChip } from '../components.js';
import { getService } from '../../domain/ServiceCatalog.js';
import { formatCOP, formatDay, formatDateTime } from '../../shared/format.js';

const EVENT_LABELS = {
  'slot.published': 'Horario publicado', 'slot.removed': 'Horario quitado', 'caregiver.policy_changed': 'Política cambiada',
  'booking.held': 'Horario apartado', 'booking.confirmed': 'Reserva confirmada', 'booking.payment_rejected': 'Pago rechazado',
  'booking.expired': 'Bloqueo vencido', 'booking.late_payment_refunded': 'Pago tardío reembolsado',
  'booking.cancelled_by_owner': 'Cancelación del dueño', 'booking.cancelled_by_caregiver': 'Cancelación del cuidador',
  'booking.rescheduled': 'Reprogramación', 'payment.started': 'Pago iniciado', 'payment.approved': 'Pago aprobado',
  'payment.declined': 'Pago rechazado en pasarela', 'payment.refunded': 'Reembolso enviado', 'payment.reconciled': 'Conciliación',
  'payment.unknown_transaction': 'Transacción desconocida', 'webhook.duplicate_ignored': 'Webhook duplicado ignorado',
  'webhook.invalid_signature': 'Webhook con firma inválida',
};

const pct = (r) => `${Math.round(r * 100)} %`;

export const adminView = {
  inbox: (ctx) => ctx.app.notificationService.inbox('admin', 'admin'),

  async render(ctx) {
    const { app } = ctx;
    const [summary, occupancy, bookings, events, caregivers] = await Promise.all([
      app.reportService.summary(), app.reportService.occupancy(), app.bookingService.listAll(),
      app.auditLog.recent(40), app.repos.caregivers.findAll(),
    ]);
    const names = new Map(caregivers.map((c) => [c.id, c.name]));
    const confirmSeconds = Math.round(summary.maxApprovalToConfirmMs / 1000);

    return html`
    <header class="view-head">
      <div>
        <h1>Panel administrativo</h1>
        <p class="lead">El equipo de Terque solo interviene en excepciones. Aquí ve el estado de cada reserva y cada pago.</p>
      </div>
      <div class="row">
        <button type="button" class="btn btn--ghost" data-action="admin-expire">Revisar bloqueos vencidos</button>
        <button type="button" class="btn" data-action="admin-reconcile">Conciliar pagos pendientes</button>
      </div>
    </header>

    <section class="kpis" aria-label="Indicadores">
      <div class="kpi"><span class="kpi__value">${summary.totalBookings}</span><span class="kpi__label">reservas creadas</span></div>
      <div class="kpi"><span class="kpi__value">${pct(summary.conversion)}</span><span class="kpi__label">llegaron a confirmarse</span></div>
      <div class="kpi"><span class="kpi__value">${confirmSeconds} s</span><span class="kpi__label">máximo entre pago aprobado y confirmación (meta: 300 s)</span></div>
      <div class="kpi"><span class="kpi__value">${formatCOP(summary.grossRevenue)}</span><span class="kpi__label">pagos aprobados</span></div>
      <div class="kpi"><span class="kpi__value">${formatCOP(summary.refunded)}</span><span class="kpi__label">reembolsado</span></div>
      <div class="kpi"><span class="kpi__value">${summary.pendingPayments}</span><span class="kpi__label">pagos esperando a la pasarela</span></div>
      <div class="kpi"><span class="kpi__value">${summary.duplicatesIgnored}</span><span class="kpi__label">avisos duplicados ignorados</span></div>
      <div class="kpi"><span class="kpi__value">${pct(summary.notifications.ratio)}</span><span class="kpi__label">notificaciones en menos de 1 minuto (meta: 98 %)</span></div>
    </section>

    <div class="split">
      <section class="panel">
        <h2 class="section-title">Ocupación de la semana</h2>
        <ul class="bars">${occupancy.map((o) => html`
          <li>
            <span>${o.caregiver.name}</span>
            <span class="bar" role="img" aria-label="${pct(o.ratio)} ocupado"><span style="width:${Math.round(o.ratio * 100)}%"></span></span>
            <span class="muted small">${o.booked} de ${o.total}</span>
          </li>`)}</ul>
      </section>
      <section class="panel">
        <h2 class="section-title">Bitácora de eventos</h2>
        <ol class="log">${events.map((e) => html`
          <li><time>${formatDateTime(e.at)}</time><span>${EVENT_LABELS[e.type] ?? e.type}</span><code>${e.ref}</code></li>`)}</ol>
      </section>
    </div>

    <section class="panel">
      <h2 class="section-title">Reservas</h2>
      ${bookings.length === 0 ? html`<p class="empty">Todavía no hay reservas. Crea una desde la vista del dueño.</p>` : html`
      <div class="table-wrap"><table>
        <thead><tr><th>Reserva</th><th>Servicio</th><th>Cuidador</th><th>Fecha</th><th>Valor</th><th>Estado</th><th>Historial</th></tr></thead>
        <tbody>${bookings.map((b) => html`
          <tr>
            <td><code>${b.id}</code></td>
            <td>${getService(b.service).label} (${b.petName})</td>
            <td>${names.get(b.caregiverId)}</td>
            <td>${formatDay(b.date)} ${b.start}</td>
            <td>${formatCOP(b.price)}</td>
            <td>${statusChip(b.status)}</td>
            <td><details><summary>${b.history.length} pasos</summary><ol class="history">${b.history.map((h) => html`<li><time>${formatDateTime(h.at)}</time> ${h.note}</li>`)}</ol></details></td>
          </tr>`)}</tbody>
      </table></div>`}
    </section>`;
  },

  actions: {
    'admin-reconcile': async (ctx) => {
      const { checked, resolved } = await ctx.app.paymentService.reconcile();
      ctx.toast(checked ? `Conciliación: ${resolved} de ${checked} pago(s) pendiente(s) resuelto(s).` : 'No hay pagos pendientes por conciliar.');
    },
    'admin-expire': async (ctx) => {
      const n = await ctx.app.bookingService.expireHolds();
      ctx.toast(n ? `${n} bloqueo(s) vencido(s) liberado(s).` : 'No hay bloqueos vencidos.');
    },
  },
};
