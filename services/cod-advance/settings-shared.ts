import { calculateCodAdvancePolicy } from "./policy.ts";

export const DEFAULT_CUSTOMER_TITLE = "Confirm Cash on Delivery";
export const DEFAULT_CUSTOMER_MESSAGE = "A small online advance is required to confirm this Cash on Delivery order.";

export class CodAdvanceSettingsValidationError extends Error {
  status = 400;
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "CodAdvanceSettingsValidationError";
    this.issues = issues;
  }
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function nullableMoney(value: unknown) { return value === null || nonNegativeSafeInteger(value); }

export type CodAdvanceSettingsInput = {
  enabled: boolean;
  advanceType: "FIXED" | "PERCENTAGE";
  fixedAdvanceAmountPaise: number;
  percentageBasisPoints: number | null;
  minimumAdvanceAmountPaise: number | null;
  maximumAdvanceAmountPaise: number | null;
  minOrderAmountPaise: number | null;
  maxOrderAmountPaise: number | null;
  customerTitle: string | null;
  customerMessage: string | null;
};

export function validateCodAdvanceSettingsInput(input: CodAdvanceSettingsInput) {
  const issues: string[] = [];
  if (typeof input.enabled !== "boolean") issues.push("enabled must be boolean");
  if (input.advanceType !== "FIXED" && input.advanceType !== "PERCENTAGE") issues.push("advanceType must be FIXED or PERCENTAGE");
  if (!nonNegativeSafeInteger(input.fixedAdvanceAmountPaise)) issues.push("fixedAdvanceAmountPaise must be a non-negative safe integer");
  for (const key of ["minimumAdvanceAmountPaise", "maximumAdvanceAmountPaise", "minOrderAmountPaise", "maxOrderAmountPaise"] as const) {
    if (!nullableMoney(input[key])) issues.push(`${key} must be null or a non-negative safe integer`);
  }
  if (input.percentageBasisPoints !== null && (!Number.isSafeInteger(input.percentageBasisPoints) || input.percentageBasisPoints < 1 || input.percentageBasisPoints > 10000)) issues.push("percentageBasisPoints must be between 1 and 10000");
  if (input.customerTitle !== null && input.customerTitle.length > 120) issues.push("customerTitle must be 120 characters or fewer");
  if (input.customerMessage !== null && input.customerMessage.length > 500) issues.push("customerMessage must be 500 characters or fewer");
  if (input.advanceType === "FIXED") {
    if (input.percentageBasisPoints !== null) issues.push("percentageBasisPoints must be null for FIXED advance");
    if (input.enabled && input.fixedAdvanceAmountPaise <= 0) issues.push("fixedAdvanceAmountPaise must be greater than 0 when enabled");
  }
  if (input.advanceType === "PERCENTAGE" && input.enabled && input.percentageBasisPoints === null) issues.push("percentageBasisPoints is required when percentage Partial COD is enabled");
  if (input.minimumAdvanceAmountPaise !== null && input.maximumAdvanceAmountPaise !== null && input.minimumAdvanceAmountPaise > input.maximumAdvanceAmountPaise) issues.push("minimumAdvanceAmountPaise cannot exceed maximumAdvanceAmountPaise");
  if (input.minOrderAmountPaise !== null && input.maxOrderAmountPaise !== null && input.minOrderAmountPaise > input.maxOrderAmountPaise) issues.push("minOrderAmountPaise cannot exceed maxOrderAmountPaise");
  if (issues.length) throw new CodAdvanceSettingsValidationError(issues);
}

export function parseRupeesToPaise(value: string, { optional = false } = {}) {
  const trimmed = value.trim();
  if (optional && trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new CodAdvanceSettingsValidationError(["Amount must use digits with up to two decimal places"]);
  const [rupees, paise = ""] = trimmed.split(".");
  const result = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new CodAdvanceSettingsValidationError(["Amount is too large"]);
  return result;
}

export function parsePercentageToBasisPoints(value: string, { optional = false } = {}) {
  const trimmed = value.trim();
  if (optional && trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) throw new CodAdvanceSettingsValidationError(["Percentage must use digits with up to two decimal places"]);
  const [whole, fractional = ""] = trimmed.split(".");
  const result = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (result <= 0 || result > 10000) throw new CodAdvanceSettingsValidationError(["Percentage must be greater than 0 and at most 100"]);
  return result;
}

export function buildCodAdvancePreview(settings: Pick<CodAdvanceSettingsInput, "advanceType" | "fixedAdvanceAmountPaise" | "percentageBasisPoints" | "minimumAdvanceAmountPaise" | "maximumAdvanceAmountPaise">) {
  return calculateCodAdvancePolicy({ enabled: true, minOrderAmountPaise: null, maxOrderAmountPaise: null, orderTotalPaise: 200000, storeCreditAppliedPaise: 40000, ...settings });
}
