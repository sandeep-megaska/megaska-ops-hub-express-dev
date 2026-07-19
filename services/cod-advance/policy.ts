export type CodAdvanceTypeValue = "FIXED" | "PERCENTAGE";

export type CodAdvancePolicyInput = {
  enabled: boolean;
  advanceType: CodAdvanceTypeValue;
  fixedAdvanceAmountPaise: number;
  percentageBasisPoints: number | null;
  minimumAdvanceAmountPaise: number | null;
  maximumAdvanceAmountPaise: number | null;
  minOrderAmountPaise: number | null;
  maxOrderAmountPaise: number | null;
  orderTotalPaise: number;
  storeCreditAppliedPaise: number;
};

export type CodAdvancePolicyResult = {
  available: boolean;
  eligible: boolean;
  requiresAdvance: boolean;
  reasons: string[];
  orderTotalPaise: number;
  storeCreditAppliedPaise: number;
  customerCashLiabilityPaise: number;
  advanceAmountPaise: number;
  codBalanceAmountPaise: number;
};

type NullableMoneyKey =
  | "minimumAdvanceAmountPaise"
  | "maximumAdvanceAmountPaise"
  | "minOrderAmountPaise"
  | "maxOrderAmountPaise";

const nullableMoneyReasonByKey: Record<NullableMoneyKey, string> = {
  minimumAdvanceAmountPaise: "invalid_minimum_advance",
  maximumAdvanceAmountPaise: "invalid_maximum_advance",
  minOrderAmountPaise: "invalid_min_order_amount",
  maxOrderAmountPaise: "invalid_max_order_amount",
};

function isValidNonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function invalidResult(input: CodAdvancePolicyInput, reasons: string[], available = false): CodAdvancePolicyResult {
  const orderTotalPaise = isValidNonNegativeInteger(input.orderTotalPaise) ? input.orderTotalPaise : 0;
  const storeCreditAppliedPaise = isValidNonNegativeInteger(input.storeCreditAppliedPaise) ? input.storeCreditAppliedPaise : 0;
  const customerCashLiabilityPaise = Math.max(0, orderTotalPaise - Math.min(storeCreditAppliedPaise, orderTotalPaise));

  return {
    available,
    eligible: false,
    requiresAdvance: false,
    reasons,
    orderTotalPaise,
    storeCreditAppliedPaise,
    customerCashLiabilityPaise,
    advanceAmountPaise: 0,
    codBalanceAmountPaise: customerCashLiabilityPaise,
  };
}

function validateNullableMoney(input: CodAdvancePolicyInput, key: NullableMoneyKey, reasons: string[]) {
  const value = input[key];
  const valid = value === null || isValidNonNegativeInteger(value);
  if (!valid) {
    addReason(reasons, nullableMoneyReasonByKey[key]);
  }

  return valid;
}

function safePercentageRound(amountPaise: number, basisPoints: number): number | null {
  const numerator = BigInt(amountPaise) * BigInt(basisPoints);
  const rounded = (numerator + BigInt(5000)) / BigInt(10000);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return Number(rounded);
}

export function calculateCodAdvancePolicy(input: CodAdvancePolicyInput): CodAdvancePolicyResult {
  const reasons: string[] = [];

  // Checkout amounts are shared by normal and Partial COD and must always be
  // safe. Advance settings, however, are irrelevant when the module is off.
  if (!isValidNonNegativeInteger(input.orderTotalPaise)) addReason(reasons, "invalid_order_total");
  if (!isValidNonNegativeInteger(input.storeCreditAppliedPaise)) addReason(reasons, "invalid_store_credit_amount");
  if (isValidNonNegativeInteger(input.orderTotalPaise) && isValidNonNegativeInteger(input.storeCreditAppliedPaise)) {
    if (input.storeCreditAppliedPaise > input.orderTotalPaise) addReason(reasons, "store_credit_exceeds_order_total");
  }

  const sharedInputsValid = reasons.length === 0;
  if (!input.enabled) {
    addReason(reasons, "disabled");
    if (!sharedInputsValid) return invalidResult(input, reasons, false);

    const customerCashLiabilityPaise = input.orderTotalPaise - input.storeCreditAppliedPaise;
    return {
      available: true,
      eligible: true,
      requiresAdvance: false,
      reasons,
      orderTotalPaise: input.orderTotalPaise,
      storeCreditAppliedPaise: input.storeCreditAppliedPaise,
      customerCashLiabilityPaise,
      advanceAmountPaise: 0,
      codBalanceAmountPaise: customerCashLiabilityPaise,
    };
  }

  // From this point onward validation applies only to Partial COD settings.
  if (!isValidNonNegativeInteger(input.fixedAdvanceAmountPaise)) addReason(reasons, "invalid_fixed_advance");

  const minimumAdvanceValid = validateNullableMoney(input, "minimumAdvanceAmountPaise", reasons);
  const maximumAdvanceValid = validateNullableMoney(input, "maximumAdvanceAmountPaise", reasons);
  const minOrderValid = validateNullableMoney(input, "minOrderAmountPaise", reasons);
  const maxOrderValid = validateNullableMoney(input, "maxOrderAmountPaise", reasons);

  if (input.advanceType === "PERCENTAGE") {
    if (
      input.percentageBasisPoints === null ||
      !Number.isFinite(input.percentageBasisPoints) ||
      !Number.isInteger(input.percentageBasisPoints) ||
      input.percentageBasisPoints < 1 ||
      input.percentageBasisPoints > 10000
    ) {
      addReason(reasons, "invalid_percentage_basis_points");
    }
  }

  if (
    isValidNonNegativeInteger(input.minimumAdvanceAmountPaise) &&
    isValidNonNegativeInteger(input.maximumAdvanceAmountPaise) &&
    input.minimumAdvanceAmountPaise > input.maximumAdvanceAmountPaise
  ) {
    addReason(reasons, "minimum_advance_exceeds_maximum_advance");
  }

  const structurallyValid = !reasons.some((reason) =>
    [
      "invalid_order_total",
      "invalid_store_credit_amount",
      "store_credit_exceeds_order_total",
      "invalid_fixed_advance",
      "invalid_percentage_basis_points",
      "invalid_minimum_advance",
      "invalid_maximum_advance",
      "invalid_min_order_amount",
      "invalid_max_order_amount",
      "minimum_advance_exceeds_maximum_advance",
    ].includes(reason),
  ) && minimumAdvanceValid && maximumAdvanceValid && minOrderValid && maxOrderValid;

  if (!structurallyValid) return invalidResult(input, reasons, false);

  if (input.minOrderAmountPaise !== null && input.orderTotalPaise < input.minOrderAmountPaise) addReason(reasons, "below_min_order_amount");
  if (input.maxOrderAmountPaise !== null && input.orderTotalPaise > input.maxOrderAmountPaise) addReason(reasons, "above_max_order_amount");

  const customerCashLiabilityPaise = input.orderTotalPaise - input.storeCreditAppliedPaise;
  if (customerCashLiabilityPaise === 0) addReason(reasons, "zero_cash_liability");

  const eligible = !reasons.some((reason) => reason !== "zero_cash_liability");
  if (!eligible) {
    return {
      available: true,
      eligible: false,
      requiresAdvance: false,
      reasons,
      orderTotalPaise: input.orderTotalPaise,
      storeCreditAppliedPaise: input.storeCreditAppliedPaise,
      customerCashLiabilityPaise,
      advanceAmountPaise: 0,
      codBalanceAmountPaise: customerCashLiabilityPaise,
    };
  }

  let advanceAmountPaise = input.advanceType === "FIXED"
    ? input.fixedAdvanceAmountPaise
    : safePercentageRound(customerCashLiabilityPaise, input.percentageBasisPoints as number);

  if (advanceAmountPaise === null || !Number.isSafeInteger(advanceAmountPaise)) {
    addReason(reasons, input.advanceType === "PERCENTAGE" ? "invalid_percentage_basis_points" : "invalid_fixed_advance");
    return invalidResult(input, reasons, false);
  }

  if (input.minimumAdvanceAmountPaise !== null) advanceAmountPaise = Math.max(advanceAmountPaise, input.minimumAdvanceAmountPaise);
  if (input.maximumAdvanceAmountPaise !== null) advanceAmountPaise = Math.min(advanceAmountPaise, input.maximumAdvanceAmountPaise);
  advanceAmountPaise = Math.max(0, Math.min(advanceAmountPaise, customerCashLiabilityPaise));

  const codBalanceAmountPaise = customerCashLiabilityPaise - advanceAmountPaise;

  return {
    available: true,
    eligible: true,
    requiresAdvance: advanceAmountPaise > 0,
    reasons,
    orderTotalPaise: input.orderTotalPaise,
    storeCreditAppliedPaise: input.storeCreditAppliedPaise,
    customerCashLiabilityPaise,
    advanceAmountPaise,
    codBalanceAmountPaise,
  };
}
