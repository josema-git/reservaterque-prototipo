import { formatCOP, formatDay, formatTime } from '../../shared/format.js';
import { getService } from '../../domain/ServiceCatalog.js';

// Cada plantilla traduce un evento de dominio en mensajes por destinatario.
const when = (b) => `${formatDay(b.date)}, ${b.start}`;
const what = (b) => `${getService(b.service).label.toLowerCase()} para ${b.petName}`;

export const TEMPLATES = Object.freeze({
  'booking.held': ({ booking: b }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Horario apartado', body: `Tienes hasta las ${formatTime(b.holdExpiresAt)} para pagar el ${what(b)} (${when(b)}).` },
  ],
  'booking.confirmed': ({ booking: b, late }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Reserva confirmada', body: `Pago aprobado. Tu reserva de ${what(b)} el ${when(b)} quedó confirmada${late ? ' (el pago llegó tarde, pero el horario seguía libre)' : ''}.` },
    { to: 'caregiver', recipientId: b.caregiverId, title: 'Nueva reserva pagada', body: `${b.petName} te espera el ${when(b)}. El pago ya está aprobado.` },
    { to: 'admin', recipientId: 'admin', title: 'Reserva confirmada automáticamente', body: `${b.id} confirmada${late ? ' con pago tardío' : ''}.` },
  ],
  'booking.payment_rejected': ({ booking: b }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Pago rechazado', body: `La pasarela rechazó el pago del ${what(b)}. El horario se liberó; puedes intentarlo de nuevo con otro medio de pago.` },
  ],
  'booking.expired': ({ booking: b }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Se venció el tiempo para pagar', body: `El horario del ${when(b)} volvió a quedar disponible. Si el pago se aprueba después, te avisamos.` },
  ],
  'booking.late_payment_refunded': ({ booking: b }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Reembolso automático', body: `Tu pago llegó cuando el horario del ${when(b)} ya estaba tomado. Te devolvemos ${formatCOP(b.price)} completos.` },
    { to: 'admin', recipientId: 'admin', title: 'Pago tardío reembolsado', body: `${b.id}: aprobado tarde sobre un horario ocupado. Reembolso total.` },
  ],
  'booking.cancelled_by_owner': ({ booking: b, refundAmount }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Reserva cancelada', body: `Cancelaste el ${what(b)}. Reembolso: ${formatCOP(refundAmount)}.` },
    { to: 'caregiver', recipientId: b.caregiverId, title: 'Una reserva fue cancelada', body: `${b.petName} ya no va el ${when(b)}. El horario quedó libre otra vez.` },
  ],
  'booking.cancelled_by_caregiver': ({ booking: b, alternatives }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Tu cuidador canceló', body: `Te devolvemos ${formatCOP(b.price)}. Hay ${alternatives} horario(s) de otros cuidadores disponibles ese día.` },
    { to: 'admin', recipientId: 'admin', title: 'Cancelación de cuidador', body: `${b.id} cancelada por el cuidador. Reembolso total en curso.` },
  ],
  'booking.rescheduled': ({ booking: b }) => [
    { to: 'owner', recipientId: b.ownerId, title: 'Reserva reprogramada', body: `Nueva fecha: ${when(b)}.` },
    { to: 'caregiver', recipientId: b.caregiverId, title: 'Reserva reprogramada', body: `${b.petName} ahora va el ${when(b)}.` },
  ],
  'webhook.duplicate_ignored': ({ eventId }) => [
    { to: 'admin', recipientId: 'admin', title: 'Notificación duplicada ignorada', body: `El evento ${eventId} ya se había procesado. No se hizo nada.` },
  ],
  'webhook.invalid_signature': ({ eventId }) => [
    { to: 'admin', recipientId: 'admin', title: 'Firma inválida', body: `Se rechazó el evento ${eventId}: la firma no coincide.` },
  ],
  'payment.reconciled': ({ checked, resolved }) => (checked === 0 ? [] : [
    { to: 'admin', recipientId: 'admin', title: 'Conciliación ejecutada', body: `${checked} pago(s) pendiente(s) revisado(s), ${resolved} resuelto(s).` },
  ]),
});
