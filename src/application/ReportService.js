import { PaymentStatus } from '../domain/Payment.js';
import { SlotState } from '../domain/Slot.js';

// Indicadores del panel administrativo, alineados con los criterios de
// aceptación del documento de formulación.
export class ReportService {
  #bookings; #payments; #slots; #caregivers; #audit; #notifications; #clock;

  constructor({ bookingRepository, paymentRepository, slotRepository, caregiverRepository, auditLog, notificationService, clock }) {
    this.#bookings = bookingRepository;
    this.#payments = paymentRepository;
    this.#slots = slotRepository;
    this.#caregivers = caregiverRepository;
    this.#audit = auditLog;
    this.#notifications = notificationService;
    this.#clock = clock;
  }

  async summary() {
    const bookings = await this.#bookings.findAll();
    const payments = await this.#payments.findAll();
    const byId = new Map(payments.map((p) => [p.id, p]));
    const confirmed = bookings.filter((b) => b.confirmedAt);

    const approvalToConfirm = confirmed
      .map((b) => byId.get(b.paymentId))
      .filter((p) => p?.resolvedAt)
      .map((p) => confirmed.find((b) => b.paymentId === p.id).confirmedAt - p.resolvedAt);

    const approved = payments.filter((p) => p.status === PaymentStatus.APPROVED);
    const refunded = payments.reduce((sum, p) => sum + p.refundedAmount, 0);

    return {
      totalBookings: bookings.length,
      confirmedBookings: confirmed.length,
      conversion: bookings.length ? confirmed.length / bookings.length : 0,
      maxApprovalToConfirmMs: approvalToConfirm.length ? Math.max(...approvalToConfirm) : 0,
      grossRevenue: approved.reduce((sum, p) => sum + p.amount, 0),
      refunded,
      pendingPayments: payments.filter((p) => p.status === PaymentStatus.PENDING).length,
      reconciledPayments: payments.filter((p) => p.resolvedBy === 'conciliación').length,
      duplicatesIgnored: await this.#audit.countByType('webhook.duplicate_ignored'),
      notifications: await this.#notifications.deliveryStats(),
    };
  }

  async occupancy() {
    const now = this.#clock.now();
    const caregivers = await this.#caregivers.findAll();
    const slots = await this.#slots.findAll((s) => s.startsAt() > now);
    return caregivers.map((c) => {
      const own = slots.filter((s) => s.caregiverId === c.id);
      const booked = own.filter((s) => s.state === SlotState.BOOKED).length;
      return { caregiver: c, total: own.length, booked, ratio: own.length ? booked / own.length : 0 };
    });
  }
}
