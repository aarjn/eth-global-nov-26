import type { RelayErrorCode } from "@paisalink/shared";

/** Error codes returned by the API. The five relay codes from PLAN.md section 3 come first. */
export type ApiErrorCode =
  | RelayErrorCode
  | "BAD_REQUEST"
  | "BAD_SIGNATURE"
  | "INVOICE_NOT_FOUND"
  | "INVOICE_NOT_OPEN"
  | "INVOICE_NOT_PAID"
  | "PAYMENT_IN_PROGRESS"
  | "MERCHANT_NOT_FOUND"
  | "TX_FAILED"
  | "NOT_CONFIGURED"
  | "DEMO_FAUCET_LIMIT"
  | "INTERNAL";

const STATUS: Record<ApiErrorCode, number> = {
  MERCHANT_NOT_VERIFIED: 403,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  BAD_AUTHORIZATION: 400,
  SIMULATION_FAILED: 422,
  BAD_REQUEST: 400,
  BAD_SIGNATURE: 401,
  INVOICE_NOT_FOUND: 404,
  INVOICE_NOT_OPEN: 409,
  INVOICE_NOT_PAID: 409,
  PAYMENT_IN_PROGRESS: 409,
  MERCHANT_NOT_FOUND: 404,
  TX_FAILED: 502,
  NOT_CONFIGURED: 503,
  DEMO_FAUCET_LIMIT: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ApiErrorCode, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.status = STATUS[code];
  }
  toJSON() { return { error: this.message, code: this.code, ...this.extra }; }
}

export const bad = (msg: string) => new ApiError("BAD_REQUEST", msg);
