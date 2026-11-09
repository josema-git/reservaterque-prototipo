import { html } from './html.js';
import { STATUS_LABELS } from '../domain/BookingStatus.js';
import { formatTime } from '../shared/format.js';

const STATUS_TONE = {
  HELD: 'wait', CONFIRMED: 'ok', PAYMENT_REJECTED: 'bad', EXPIRED: 'muted',
  REFUNDED_LATE_PAYMENT: 'info', CANCELLED_BY_OWNER: 'muted', CANCELLED_BY_CAREGIVER: 'bad', COMPLETED: 'ok',
};

export const statusChip = (status) => html`<span class="chip chip--${STATUS_TONE[status]}">${STATUS_LABELS[status]}</span>`;

export const countdown = (until) => html`<span class="countdown" data-countdown="${until}">--:--</span>`;

export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const CHANNEL_LABEL = { app: 'App', email: 'Correo', whatsapp: 'WhatsApp' };

export function inboxList(notifications) {
  if (!notifications.length) {
    return html`<p class="empty">Aquí aparecen los avisos automáticos de reservas, pagos y cancelaciones.</p>`;
  }
  return html`<ol class="inbox">${notifications.slice(0, 25).map((n) => html`
    <li class="inbox__item">
      <div class="inbox__top"><strong>${n.title}</strong><time>${formatTime(n.createdAt)}</time></div>
      <p>${n.body}</p>
      <div class="inbox__channels">${n.deliveries.map((d) => html`<span>${CHANNEL_LABEL[d.channel]}</span>`)}</div>
    </li>`)}</ol>`;
}

export const field = (label, control, hint = '') => html`
  <label class="field"><span class="field__label">${label}</span>${control}${hint ? html`<span class="field__hint">${hint}</span>` : ''}</label>`;

// Los alojamientos terminan al día siguiente; se dice explícitamente.
export const timeRange = (start, end) => (end <= start ? `${start} a ${end} del día siguiente` : `${start} a ${end}`);
