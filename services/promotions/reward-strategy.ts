import type { PromotionRewardType } from "./domain.ts";
import { normalizeNumericValue, normalizeShopifyProductGid } from "./normalization.ts";

export const promotionRewardScopes = ["product", "order", "shipping", "store_credit"] as const;
export type PromotionRewardScope = (typeof promotionRewardScopes)[number];
export const promotionRewardMethods = ["percentage", "fixed_amount", "fixed_price"] as const;
export type PromotionRewardMethod = (typeof promotionRewardMethods)[number];

export type PromotionRewardConfiguration = {
  value: string;
  productGid: string;
  variantGid?: string;
  quantityCap: number;
};
export type CanonicalPromotionReward = {
  scope: PromotionRewardScope;
  method: PromotionRewardMethod;
  configuration: PromotionRewardConfiguration;
  display?: Record<string, string | number | boolean | null>;
};
export type ProductPromotionReward = CanonicalPromotionReward & { scope: "product" };
export type RewardValidationIssue = { code: string; field?: string; message: string; severity: "error" | "warning" };
export type RewardValidationResult = { valid: boolean; executable: boolean; issues: RewardValidationIssue[] };
export type RewardNormalizationResult =
  | { ok: true; format: "canonical" | "legacy"; reward: CanonicalPromotionReward; validation: RewardValidationResult }
  | { ok: false; format: "canonical" | "legacy" | "unknown"; reason: "invalid" | "unsupported"; issues: RewardValidationIssue[] };

const legacyMethods: Record<PromotionRewardType, PromotionRewardMethod> = {
  PERCENTAGE_OFF: "percentage",
  FIXED_AMOUNT_OFF: "fixed_amount",
  FIXED_PRICE: "fixed_price",
};
const methodsToLegacy: Record<PromotionRewardMethod, PromotionRewardType> = {
  percentage: "PERCENTAGE_OFF",
  fixed_amount: "FIXED_AMOUNT_OFF",
  fixed_price: "FIXED_PRICE",
};

function issue(code: string, field: string, message: string): RewardValidationIssue {
  return { code, field, message, severity: "error" };
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function decimal(value: unknown): string | null {
  const numeric = normalizeNumericValue(value);
  if (numeric === null) return null;
  return String(numeric);
}

export function legacyRewardType(method: PromotionRewardMethod): PromotionRewardType { return methodsToLegacy[method]; }
export function canonicalRewardMethod(type: PromotionRewardType): PromotionRewardMethod { return legacyMethods[type]; }

export function validateCanonicalPromotionReward(reward: CanonicalPromotionReward): RewardValidationResult {
  const issues: RewardValidationIssue[] = [];
  if (reward.scope !== "product") issues.push(issue("unsupported_scope", "scope", `Reward scope '${reward.scope}' is not executable.`));
  if (!promotionRewardMethods.includes(reward.method)) issues.push(issue("unsupported_method", "method", "Reward method is not supported."));
  const value = normalizeNumericValue(reward.configuration.value);
  if (value === null) issues.push(issue("invalid_value", "configuration.value", "Reward value must be numeric."));
  else if (reward.method === "percentage" && (value <= 0 || value > 100)) issues.push(issue("invalid_percentage", "configuration.value", "Percentage discounts must be greater than 0 and no more than 100."));
  else if (reward.method === "fixed_amount" && value <= 0) issues.push(issue("invalid_fixed_amount", "configuration.value", "Fixed amount discounts must be greater than 0."));
  else if (reward.method === "fixed_price" && value < 0) issues.push(issue("invalid_fixed_price", "configuration.value", "Fixed promotional prices must be zero or greater."));
  if (!normalizeShopifyProductGid(reward.configuration.productGid)) issues.push(issue("invalid_product_gid", "configuration.productGid", "Reward product must be a canonical Shopify Product GID."));
  if (!Number.isInteger(reward.configuration.quantityCap) || reward.configuration.quantityCap <= 0) issues.push(issue("invalid_quantity_cap", "configuration.quantityCap", "Reward quantity cap must be a positive integer."));
  if (reward.configuration.variantGid !== undefined && !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(reward.configuration.variantGid)) issues.push(issue("invalid_variant_gid", "configuration.variantGid", "Reward variant must be a canonical Shopify ProductVariant GID."));
  const executable = issues.length === 0 && reward.scope === "product";
  return { valid: issues.length === 0, executable, issues };
}

export function normalizePromotionReward(input: unknown, defaults: { productGid?: unknown; quantityCap?: unknown } = {}): RewardNormalizationResult {
  const source = record(input);
  if (!source) return { ok: false, format: "unknown", reason: "invalid", issues: [issue("invalid_reward", "reward", "Reward must be an object.")] };
  const canonical = typeof source.scope === "string" || typeof source.method === "string" || source.configuration !== undefined;
  const configuration = record(source.configuration) ?? {};
  const legacyType = source.type as PromotionRewardType;
  const scope = (canonical ? source.scope : "product") as PromotionRewardScope;
  const method = (canonical ? source.method : legacyMethods[legacyType]) as PromotionRewardMethod;
  if (!promotionRewardScopes.includes(scope)) return { ok: false, format: canonical ? "canonical" : "legacy", reason: "unsupported", issues: [issue("unsupported_scope", "scope", "Reward scope is not supported.")] };
  if (!promotionRewardMethods.includes(method)) return { ok: false, format: canonical ? "canonical" : "legacy", reason: "unsupported", issues: [issue("unsupported_method", "method", "Reward method is not supported.")] };
  const normalizedValue = decimal(canonical ? configuration.value : source.value);
  const productGid = normalizeShopifyProductGid(canonical ? configuration.productGid : (source.productGid ?? defaults.productGid));
  const quantity = Number(canonical ? configuration.quantityCap : (source.maximumQuantity ?? source.quantityCap ?? defaults.quantityCap));
  const reward: CanonicalPromotionReward = {
    scope,
    method,
    configuration: {
      value: normalizedValue ?? "",
      productGid: productGid ?? "",
      ...(typeof configuration.variantGid === "string" ? { variantGid: configuration.variantGid.trim() } : {}),
      quantityCap: quantity,
    },
    ...(record(source.display) ? { display: source.display as CanonicalPromotionReward["display"] } : {}),
  };
  const validation = validateCanonicalPromotionReward(reward);
  if (!validation.valid) return { ok: false, format: canonical ? "canonical" : "legacy", reason: reward.scope === "product" ? "invalid" : "unsupported", issues: validation.issues };
  return { ok: true, format: canonical ? "canonical" : "legacy", reward, validation };
}

export type ProductRewardEvaluationContext = { eligible: boolean; eligibleQuantity: number; exhaustedByCap?: boolean; suppressedByConflict?: boolean };
export type ProductRewardEvaluation = { applicable: boolean; scope: "product"; method: PromotionRewardMethod; targetProductGid: string; targetVariantGid?: string; eligibleQuantity: number; configuredValue: number; diagnosticReason?: "rule_not_eligible" | "reward_exhausted_by_cap" | "reward_suppressed_by_conflict" };
export interface PromotionRewardStrategy<TReward extends CanonicalPromotionReward = CanonicalPromotionReward, TContext = unknown, TResult = unknown> {
  readonly scope: TReward["scope"];
  supports(reward: CanonicalPromotionReward): reward is TReward;
  validate(reward: TReward): RewardValidationResult;
  evaluate(reward: TReward, context: TContext): TResult;
}
export const productRewardStrategy: PromotionRewardStrategy<ProductPromotionReward, ProductRewardEvaluationContext, ProductRewardEvaluation> = {
  scope: "product",
  supports: (reward): reward is ProductPromotionReward => reward.scope === "product" && promotionRewardMethods.includes(reward.method),
  validate: validateCanonicalPromotionReward,
  evaluate(reward, context) {
    const reason = !context.eligible ? "rule_not_eligible" : context.exhaustedByCap ? "reward_exhausted_by_cap" : context.suppressedByConflict ? "reward_suppressed_by_conflict" : undefined;
    return { applicable: !reason, scope: "product", method: reward.method, targetProductGid: reward.configuration.productGid, ...(reward.configuration.variantGid ? { targetVariantGid: reward.configuration.variantGid } : {}), eligibleQuantity: Math.min(Math.max(0, context.eligibleQuantity), reward.configuration.quantityCap), configuredValue: Number(reward.configuration.value), ...(reason ? { diagnosticReason: reason } : {}) };
  },
};
const rewardStrategies = { product: productRewardStrategy } as const;
export function resolvePromotionRewardStrategy(reward: CanonicalPromotionReward) {
  return reward.scope === "product" && productRewardStrategy.supports(reward) ? rewardStrategies.product : null;
}
