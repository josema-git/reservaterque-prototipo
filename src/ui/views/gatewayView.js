import { html } from '../html.js';
import { PAYMENT_METHODS } from '../../domain/Payment.js';
import { formatCOP, formatDateTime } from '../../shared/format.js';

const TX_LABEL = { PENDING: 'Pendiente', APPROVED: 'Aprobada', DECLINED: 'Rechazada' };
const TX_TONE = { PENDING: 'wait', APPROVED: 'ok', DECLINED: 'bad' };

export const gatewayView = {
  inbox: (ctx) => ctx.app.notificationService.inbox('admin', 'admin'),

  async render(ctx) {
    const { gateway } = ctx.app;
    const transactions = await gateway.listTransactions();
    return html`
    <header class="view-head">
      <div>
        <h1>Pasarela de pagos (ambiente de pruebas)</h1>
        <p class="lead">Imita el sandbox de una pasarela colombiana como Wompi o PayU. Sirve para probar lo que en producción no controlamos: rechazos, avisos repetidos y caídas de comunicación.</p>
      </div>
    </header>

    <section class="panel">
      <label class="switch">
        <input type="checkbox" data-action="gw-outage" ${gateway.outage ? 'checked' : ''}>
        <span>Simular caída de comunicación: la pasarela procesa los pagos, pero sus avisos (webhooks) no llegan a Terque.</span>
      </label>
    </section>

    <section class="panel">
      <h2 class="section-title">Transacciones</h2>
      ${transactions.length === 0 ? html`<p class="empty">Aún no hay transacciones. Aparecen cuando un dueño paga una reserva.</p>` : html`
      <div class="table-wrap"><table>
        <thead><tr><th>Transacción</th><th>Reserva</th><th>Medio</th><th>Valor</th><th>Estado</th><th>Avisos enviados</th><th>Acciones</th></tr></thead>
        <tbody>${transactions.map((tx) => html`
          <tr>
            <td><code>${tx.id}</code><div class="muted small">${formatDateTime(tx.createdAt)}</div></td>
            <td><code>${tx.reference}</code></td>
            <td>${PAYMENT_METHODS[tx.method]}</td>
            <td>${formatCOP(tx.amount)}${tx.refunds.length ? html`<div class="muted small">Reembolsado: ${formatCOP(tx.refunds.reduce((s, r) => s + r.amount, 0))}</div>` : ''}</td>
            <td><span class="chip chip--${TX_TONE[tx.status]}">${TX_LABEL[tx.status]}</span></td>
            <td>${tx.deliveries.length === 0 ? 'Ninguno' : html`<ul class="deliveries">${tx.deliveries.map((d) => html`<li><code>${d.eventId}</code> ${d.delivered ? 'entregado' : 'no llegó'}</li>`)}</ul>`}</td>
            <td><div class="row">
              ${tx.status === 'PENDING' ? html`
                <button type="button" class="btn btn--small" data-action="gw-result" data-tx="${tx.id}" data-result="APPROVED">Aprobar</button>
                <button type="button" class="btn btn--small btn--ghost" data-action="gw-result" data-tx="${tx.id}" data-result="DECLINED">Rechazar</button>`
              : html`<button type="button" class="btn btn--small btn--ghost" data-action="gw-redeliver" data-tx="${tx.id}">Reenviar aviso</button>`}
            </div></td>
          </tr>`)}</tbody>
      </table></div>`}
    </section>`;
  },

  actions: {
    'gw-outage': (ctx, el) => {
      ctx.app.gateway.setOutage(el.checked);
      ctx.toast(el.checked ? 'Caída simulada: los avisos de la pasarela no llegarán.' : 'Comunicación restablecida.', el.checked ? 'warn' : 'info');
    },
    'gw-result': async (ctx, el) => {
      const { delivered } = await ctx.app.gateway.simulateResult(el.dataset.tx, el.dataset.result);
      ctx.toast(delivered ? 'Resultado enviado a Terque.' : 'Resultado registrado, pero el aviso no llegó. Usa la conciliación del panel.', delivered ? 'info' : 'warn');
    },
    'gw-redeliver': async (ctx, el) => {
      const { delivered, result } = await ctx.app.gateway.redeliver(el.dataset.tx);
      if (!delivered) ctx.toast('El aviso tampoco llegó esta vez.', 'warn');
      else ctx.toast(result.duplicate ? 'Aviso repetido: Terque lo reconoció y no hizo nada.' : 'Aviso procesado.');
    },
  },
};
