# ReservaTerque: prototipo funcional

Prototipo funcional del módulo de reservas automatizadas para la plataforma Terque. Cubre el ciclo completo que hoy se hace a mano por mensajes: el cuidador publica su disponibilidad, el dueño aparta un horario, paga en línea y la reserva se confirma sola cuando la pasarela aprueba el pago.

Proyecto de software, Corporación Universitaria Iberoamericana. Autor: José Manuel Sánchez.

**Demo en línea:** https://josema-git.github.io/reservaterque-prototipo/

## Qué se puede probar

| Rol | Funcionalidades |
|---|---|
| Dueño | Búsqueda por servicio, fecha y barrio; bloqueo temporal de 10 minutos con cuenta regresiva; pago con PSE, Nequi o tarjeta; confirmación automática; cancelación con cálculo de reembolso según la política; reprogramación. |
| Cuidador | Publicación de horarios con validación de cruces; agenda con estado de cada espacio; elección de política de cancelación; cancelación de una reserva con reembolso total al dueño. |
| Administración | Indicadores ligados a los criterios de aceptación, ocupación por cuidador, historial de cada reserva, bitácora de eventos, conciliación de pagos pendientes. |
| Pasarela (pruebas) | Aprobar o rechazar transacciones, reenviar un aviso (webhook duplicado) y simular una caída de comunicación. |

El **reloj simulado** de la barra superior adelanta el tiempo (+10 min, +1 h, +1 día) para ver vencer un bloqueo o cambiar el reembolso de una cancelación sin esperar.

## Reglas de negocio implementadas

1. **Bloqueo temporal.** Al elegir un horario queda apartado 10 minutos. Si el dueño inicia el pago, el bloqueo se extiende hasta 30 minutos mientras la pasarela verifica (PSE puede tardar).
2. **Sin reservas duplicadas.** Las operaciones sobre un mismo horario se serializan con un candado por clave. La prueba automática lanza 200 solicitudes simultáneas y solo una gana.
3. **Avisos duplicados de la pasarela.** Cada webhook se identifica por su `eventId`; si llega dos veces, la segunda se ignora. Además, un pago con resultado final no se vuelve a aplicar.
4. **Firma de integridad.** Cada aviso trae una firma SHA-256; si no coincide, se rechaza.
5. **Pago aprobado después de vencido el bloqueo.** Si el horario sigue libre, la reserva se confirma. Si otra persona ya lo tomó, se reembolsa el 100 % automáticamente.
6. **Caída de comunicación.** Si el aviso nunca llega, la conciliación consulta a la pasarela los pagos pendientes y aplica su resultado.
7. **Cambios de disponibilidad del cuidador.** No puede borrar un horario reservado ni uno que alguien está pagando. Si no puede atender una reserva confirmada, la cancela: el dueño recibe reembolso total y se le informan las alternativas de ese día.
8. **Políticas de cancelación** (flexible, moderada, estricta). La reserva guarda la política vigente al momento de pagar; si el cuidador la cambia después, no afecta lo ya pactado.

## Arquitectura

Arquitectura por capas (inspirada en arquitectura hexagonal). El dominio no conoce la interfaz ni el almacenamiento.

```
src/
├── domain/           Entidades y reglas puras: Booking, Slot, Payment, Caregiver,
│                     máquina de estados de la reserva, políticas de cancelación
├── application/      Casos de uso: AvailabilityService, BookingService,
│                     PaymentService, NotificationService, ReportService, AuditLog
│   └── ports/        Interfaz de la pasarela de pagos (PaymentGateway)
├── infrastructure/   Adaptadores: repositorio JSON sobre localStorage, pasarela
│                     sandbox, canales de notificación, bus de eventos, reloj
├── app/              Raíz de composición (inyección de dependencias) y datos semilla
├── shared/           Utilidades: tiempo, formato, identificadores, hash, KeyedMutex
└── ui/               Vistas por rol y arranque de la interfaz
tests/                Pruebas automatizadas con node:test
```

Patrones de diseño usados:

- **Repository**: `JsonRepository` aísla la persistencia. Cambiar localStorage por una API o una base de datos no toca los servicios.
- **Adapter / Ports and Adapters**: `SandboxPaymentGateway` implementa el puerto `PaymentGateway`; un adaptador de Wompi o PayU lo reemplazaría.
- **Strategy**: `CancellationPolicyFactory` entrega la política flexible, moderada o estricta.
- **State (máquina de estados)**: `BookingStatus` define qué transiciones son válidas; cualquier otra lanza `InvalidTransitionError`.
- **Observer**: `EventBus` publica eventos de dominio; notificaciones, bitácora y reembolsos se suscriben sin acoplarse a los servicios.
- **Factory method**: `Booking.create` y `Payment.create` centralizan la construcción válida de entidades.
- **Dependency Injection**: `createContainer` arma todas las dependencias en un solo lugar; las pruebas usan el mismo contenedor con almacenamiento en memoria y un reloj fijo.

Buenas prácticas: plantillas HTML con escape automático (previene XSS), errores de dominio con mensajes para el usuario, idempotencia en pagos y webhooks, candados ordenados para evitar interbloqueos, sin datos de tarjeta en el sistema (los maneja la pasarela).

## Instalación y ejecución local

Requisitos: Git y Node.js 18 o superior (o Python 3, si prefieres no usar Node). No hay dependencias que instalar.

```bash
git clone https://github.com/josema-git/reservaterque-prototipo.git
cd reservaterque-prototipo

# Opción 1: con Node.js
npm start              # abre http://localhost:5173

# Opción 2: con Python
python -m http.server 5173
```

Luego abre `http://localhost:5173` en el navegador. El proyecto usa módulos de JavaScript, por eso debe abrirse desde un servidor y no con doble clic sobre `index.html`.

### Ejecutar las pruebas

```bash
npm test
```

Se ejecutan 20 pruebas: concurrencia con 200 solicitudes simultáneas, flujo completo de pago, rechazo, vencimiento del bloqueo, pago tardío (con y sin horario libre), webhook duplicado, firma inválida, caída de comunicación y conciliación, doble clic en pagar, políticas de cancelación, reprogramación y reglas del cuidador.

## Recorrido sugerido para la demo

1. **Dueño**: elige un horario, revisa la placa con la cuenta regresiva, paga con Nequi y pulsa «Aprobar pago». La reserva queda confirmada y los avisos aparecen en la columna derecha.
2. **Cuidador**: selecciona al cuidador de esa reserva y verifica que el horario aparece como reservado. Intenta publicar un horario que se cruce para ver la validación.
3. **Pasarela**: crea otra reserva, apruébala desde la pasarela y pulsa «Reenviar aviso». El panel registra el duplicado y no se repite nada.
4. **Caída**: activa la caída de comunicación, aprueba un pago y ve al panel de administración: el pago queda pendiente hasta que pulsas «Conciliar pagos pendientes».
5. **Tiempo**: aparta un horario sin pagar y pulsa «+10 min»: el bloqueo vence y el horario vuelve a quedar libre.

Para empezar de cero usa «Reiniciar datos de la demo».

## Alcance del prototipo

Los datos viven en el `localStorage` del navegador y la pasarela, el correo y WhatsApp son simulados. En la versión de producción, los adaptadores de infraestructura se reemplazan por la base de datos de Terque, la pasarela real y los proveedores de mensajería, sin cambiar el dominio ni los casos de uso.

## Licencia

MIT
