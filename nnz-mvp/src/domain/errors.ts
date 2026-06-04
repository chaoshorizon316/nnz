export class ScopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class OwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipError';
  }
}

export class CovenantStateError extends Error {
  constructor(state: string) {
    super(`Cannot generate reply in covenant state "${state}".`);
    this.name = 'CovenantStateError';
  }
}
