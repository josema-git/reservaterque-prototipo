export class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message) { super(message, 'VALIDATION'); }
}

export class NotFoundError extends DomainError {
  constructor(entity) { super(`No se encontró ${entity}.`, 'NOT_FOUND'); }
}

export class SlotUnavailableError extends DomainError {
  constructor() { super('Ese horario acaba de ser apartado por otra persona. Elige otro espacio del calendario.', 'SLOT_UNAVAILABLE'); }
}

export class InvalidTransitionError extends DomainError {
  constructor(from, to) { super(`La reserva no puede pasar de ${from} a ${to}.`, 'INVALID_TRANSITION'); }
}
