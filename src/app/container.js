import { JsonRepository, mapperFor } from '../infrastructure/persistence/JsonRepository.js';
import { EventBus } from '../infrastructure/EventBus.js';
import { SandboxPaymentGateway } from '../infrastructure/payments/SandboxPaymentGateway.js';
import { createDefaultChannels } from '../infrastructure/notifications/channels.js';
import { KeyedMutex } from '../shared/KeyedMutex.js';
import { Booking } from '../domain/Booking.js';
import { Slot } from '../domain/Slot.js';
import { Caregiver } from '../domain/Caregiver.js';
import { Payment } from '../domain/Payment.js';
import { AvailabilityService } from '../application/AvailabilityService.js';
import { BookingService } from '../application/BookingService.js';
import { PaymentService } from '../application/PaymentService.js';
import { NotificationService } from '../application/NotificationService.js';
import { AuditLog } from '../application/AuditLog.js';
import { ReportService } from '../application/ReportService.js';
import { WebhookVerifier } from '../application/WebhookVerifier.js';

export const DEFAULT_CONFIG = Object.freeze({
  holdMinutes: 10,          // tiempo para pagar después de apartar un horario
  verificationMinutes: 30,  // extensión del bloqueo mientras la pasarela verifica
  webhookSecret: 'sandbox_integrity_secret',
});

// Raíz de composición: aquí, y solo aquí, se decide qué implementación
// concreta recibe cada servicio (inyección de dependencias manual).
export function createContainer({ storage, clock, config = DEFAULT_CONFIG, onError }) {
  const repos = {
    caregivers: new JsonRepository(storage, 'caregivers', mapperFor(Caregiver)),
    slots: new JsonRepository(storage, 'slots', mapperFor(Slot)),
    bookings: new JsonRepository(storage, 'bookings', mapperFor(Booking)),
    payments: new JsonRepository(storage, 'payments', mapperFor(Payment)),
    processedEvents: new JsonRepository(storage, 'processed_events'),
    notifications: new JsonRepository(storage, 'notifications'),
    audit: new JsonRepository(storage, 'audit'),
    owners: new JsonRepository(storage, 'owners'),
    gatewayTransactions: new JsonRepository(storage, 'gateway_transactions'),
  };

  const eventBus = new EventBus(clock, onError);
  const mutex = new KeyedMutex();
  const webhookVerifier = new WebhookVerifier(config.webhookSecret);
  const gateway = new SandboxPaymentGateway({ repository: repos.gatewayTransactions, clock, signer: webhookVerifier, storage });

  const auditLog = new AuditLog({ auditRepository: repos.audit, eventBus });
  const notificationService = new NotificationService({ notificationRepository: repos.notifications, channels: createDefaultChannels(), clock, eventBus });
  const availabilityService = new AvailabilityService({ slotRepository: repos.slots, caregiverRepository: repos.caregivers, clock, eventBus, mutex });
  const bookingService = new BookingService({
    slotRepository: repos.slots, bookingRepository: repos.bookings, caregiverRepository: repos.caregivers,
    clock, eventBus, mutex, config,
  });
  const paymentService = new PaymentService({
    paymentRepository: repos.payments, processedEventRepository: repos.processedEvents,
    bookingService, gateway, webhookVerifier, clock, eventBus, mutex, config,
  });
  const reportService = new ReportService({
    bookingRepository: repos.bookings, paymentRepository: repos.payments, slotRepository: repos.slots,
    caregiverRepository: repos.caregivers, auditLog, notificationService, clock,
  });

  return { config, clock, repos, eventBus, gateway, webhookVerifier, auditLog, notificationService, availabilityService, bookingService, paymentService, reportService };
}
