export type CustomerIdentityErrorCode = "INVALID_INPUT" | "IDENTITY_TRANSACTION_FAILED";

export class CustomerIdentityError extends Error {
  constructor(public readonly code: CustomerIdentityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CustomerIdentityError";
  }
}

export class InvalidCustomerIdentityError extends CustomerIdentityError {
  constructor(message: string) {
    super("INVALID_INPUT", message);
    this.name = "InvalidCustomerIdentityError";
  }
}
