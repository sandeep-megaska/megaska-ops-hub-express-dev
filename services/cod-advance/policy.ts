export type CodAdvancePolicyReason =
  | "disabled"
  | "invalid_min_order_amount"
  | "invalid_max_order_amount"
  | "below_min_order_amount"
  | "above_max_order_amount"
  | "advance_exceeds_order_amount"
  | "invalid_percentage_amount";

export type CodAdvancePolicySettings = {
  enabled: boolean;
  advanceBasisPoints?: number | null;
  fixedAdvanceAmountPaise?: number | null;
  minOrderAmountPaise: number | null;
  maxOrderAmountPaise: number | null;
  policyText?: string | null;
  currency?: string | null;
};

export type CodAdvancePolicyResult = {
  enabled: boolean;
  eligibility: { eligible: boolean; reasons: CodAdvancePolicyReason[] };
  advanceAmount: number;
  codBalanceAmount: number;
  policyText: string | null;
  currency: string;
};

function isValidPaiseThreshold(value: number | null): value is number {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function isValidPaiseAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function calculateRoundedPercentagePaise(amountPaise: number, basisPoints: number): number | null {
  if (!isValidPaiseAmount(amountPaise) || !Number.isSafeInteger(basisPoints) || basisPoints < 0) return null;

  const rounded = (BigInt(amountPaise) * BigInt(basisPoints) + 5000n) / 10000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return Number(rounded);
}

export function calculateCodAdvancePolicy(settings: CodAdvancePolicySettings, orderAmountPaise: number): CodAdvancePolicyResult {
  const reasons: CodAdvancePolicyReason[] = [];
  const minOrderAmountValid = isValidPaiseThreshold(settings.minOrderAmountPaise);
  const maxOrderAmountValid = isValidPaiseThreshold(settings.maxOrderAmountPaise);

  if (!settings.enabled) reasons.push("disabled");
  if (!minOrderAmountValid) reasons.push("invalid_min_order_amount");
  if (!maxOrderAmountValid) reasons.push("invalid_max_order_amount");

  if (minOrderAmountValid && settings.minOrderAmountPaise !== null && orderAmountPaise < settings.minOrderAmountPaise) {
    reasons.push("below_min_order_amount");
  }

  if (maxOrderAmountValid && settings.maxOrderAmountPaise !== null && orderAmountPaise > settings.maxOrderAmountPaise) {
    reasons.push("above_max_order_amount");
  }

  const percentageAdvanceAmount = settings.advanceBasisPoints == null
    ? null
    : calculateRoundedPercentagePaise(orderAmountPaise, settings.advanceBasisPoints);
  const advanceAmountPaise = percentageAdvanceAmount ?? settings.fixedAdvanceAmountPaise ?? 0;

  if (!isValidPaiseAmount(advanceAmountPaise)) reasons.push("invalid_percentage_amount");
  if (isValidPaiseAmount(advanceAmountPaise) && advanceAmountPaise > orderAmountPaise) reasons.push("advance_exceeds_order_amount");

  const eligible = reasons.length === 0;

  return {
    enabled: settings.enabled,
    eligibility: { eligible, reasons },
    advanceAmount: eligible ? advanceAmountPaise : 0,
    codBalanceAmount: eligible ? orderAmountPaise - advanceAmountPaise : orderAmountPaise,
    policyText: settings.policyText ?? null,
    currency: settings.currency || "INR",
  };
}
