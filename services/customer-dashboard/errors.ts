export type CustomerDashboardErrorCode = "SHOP_REQUIRED" | "SESSION_REQUIRED" | "SESSION_EXPIRED" | "CUSTOMER_NOT_FOUND" | "DASHBOARD_UNAVAILABLE";

const GENERIC_MESSAGE = "We could not load your dashboard right now. Please try again.";

export class CustomerDashboardError extends Error {
  readonly code: CustomerDashboardErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(input: { code: CustomerDashboardErrorCode; message: string; status: number; retryable?: boolean; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "CustomerDashboardError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export type CustomerDashboardErrorDto = { version: "dashboard.error.v1"; code: CustomerDashboardErrorCode; message: string; retryable: boolean };

export function toCustomerDashboardErrorDto(error: unknown): CustomerDashboardErrorDto {
  if (error instanceof CustomerDashboardError) {
    return { version: "dashboard.error.v1", code: error.code, message: error.message, retryable: error.retryable };
  }

  return { version: "dashboard.error.v1", code: "DASHBOARD_UNAVAILABLE", message: GENERIC_MESSAGE, retryable: true };
}
