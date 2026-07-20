import { promotionRewardMethods, promotionRewardScopes, rewardCapability, type PromotionRewardMethod, type PromotionRewardScope } from "./reward-strategy.ts";

export type DecimalLike = string | number | bigint;
export type OrderDiscountBasis = "eligible_merchandise_subtotal";
export type TierContinuityMode = "allow_gaps" | "continuous";
export type TierSelectionMode = "highest_eligible";

export type OrderDiscountTier = {
  id: string;
  minimumSubtotal: DecimalLike;
  maximumSubtotal?: DecimalLike;
  percentage: DecimalLike;
  priority?: number;
};
export type TieredOrderDiscountConfiguration = {
  selectionMode: TierSelectionMode;
  continuityMode: TierContinuityMode;
  basis: OrderDiscountBasis;
  tiers: OrderDiscountTier[];
};
export type TieredOrderPercentageReward = { scope: "order"; method: "percentage"; configuration: TieredOrderDiscountConfiguration };
export type PromotionCombinationPolicy = {
  combineWithProductDiscounts: boolean;
  combineWithOrderDiscounts: boolean;
  combineWithShippingDiscounts: boolean;
};
export const DEFAULT_ORDER_REWARD_COMBINATION_POLICY: Readonly<PromotionCombinationPolicy> = Object.freeze({
  combineWithProductDiscounts: true,
  combineWithOrderDiscounts: false,
  combineWithShippingDiscounts: true,
});
export type TierValidationIssue = { code: string; tierId?: string; field?: string; message: string; severity: "error" | "warning" };
export type TierValidationResult = { valid: boolean; executable: false; issues: TierValidationIssue[] };
export type EvaluatedOrderDiscountTier = { id: string; minimumSubtotal: string; maximumSubtotal?: string; percentage: string; priority?: number };
export type TierProgressEvaluation = { activeTier?: EvaluatedOrderDiscountTier; nextTier?: EvaluatedOrderDiscountTier; amountToNextTier?: string; highestTierReached: boolean };
export type OrderRewardEvaluation =
  | { status: "applicable"; scope: "order"; method: "percentage"; basis: OrderDiscountBasis; activeTierId: string; configuredPercentage: string; authoritativeSubtotal?: string; nextTierId?: string; amountToNextTier?: string }
  | { status: "not_eligible" | "no_matching_tier" | "invalid_reward" | "unsupported_reward" | "suppressed_by_conflict" | "excluded_by_combination_policy"; reasonCode: string };
export type ProductRewardCandidate = { scope: "product"; sourceRuleId: string; priority: number };
export type ShippingRewardCandidate = { scope: "shipping"; sourceRuleId: string; priority: number };
export type OrderRewardCandidate = { scope: "order"; method: "percentage"; percentage: string; sourceRuleId: string; sourceTierId: string; priority: number; combinationPolicy: PromotionCombinationPolicy };
export type RewardCandidate = ProductRewardCandidate | OrderRewardCandidate | ShippingRewardCandidate;

type ParsedDecimal = { coefficient: bigint; scale: number };
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseDecimal(value: DecimalLike): ParsedDecimal | null {
  if (typeof value === "number" && (!Number.isFinite(value) || String(value).includes("e"))) return null;
  const raw = String(value).trim();
  if (!DECIMAL_PATTERN.test(raw)) return null;
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "");
  return { coefficient: BigInt(`${negative ? "-" : ""}${digits || "0"}`), scale: fraction.length };
}
function align(a: ParsedDecimal, b: ParsedDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.coefficient * 10n ** BigInt(scale - a.scale), b.coefficient * 10n ** BigInt(scale - b.scale), scale];
}
function compareParsed(a: ParsedDecimal, b: ParsedDecimal): number { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; }
function formatDecimal(value: ParsedDecimal): string {
  const negative = value.coefficient < 0n;
  let digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  if (value.scale) digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.?0+$/, "");
  return `${negative && digits !== "0" ? "-" : ""}${digits}`;
}
export function normalizeDecimal(value: DecimalLike): string | null { const parsed = parseDecimal(value); return parsed ? formatDecimal(parsed) : null; }
function compareDecimal(a: DecimalLike, b: DecimalLike): number { const x = parseDecimal(a); const y = parseDecimal(b); if (!x || !y) throw new Error("Cannot compare malformed decimals."); return compareParsed(x, y); }
function subtractDecimal(a: DecimalLike, b: DecimalLike): string { const x = parseDecimal(a)!; const y = parseDecimal(b)!; const [left, right, scale] = align(x, y); return formatDecimal({ coefficient: left - right, scale }); }

function normalizedTier(tier: OrderDiscountTier): EvaluatedOrderDiscountTier | null {
  const minimumSubtotal = normalizeDecimal(tier.minimumSubtotal);
  const maximumSubtotal = tier.maximumSubtotal === undefined ? undefined : normalizeDecimal(tier.maximumSubtotal);
  const percentage = normalizeDecimal(tier.percentage);
  if (minimumSubtotal === null || maximumSubtotal === null || percentage === null) return null;
  return { id: tier.id, minimumSubtotal, ...(maximumSubtotal === undefined ? {} : { maximumSubtotal }), percentage, ...(tier.priority === undefined ? {} : { priority: tier.priority }) };
}
export function sortOrderDiscountTiers(tiers: readonly OrderDiscountTier[]): OrderDiscountTier[] {
  return [...tiers].sort((a, b) => {
    const amin = parseDecimal(a.minimumSubtotal); const bmin = parseDecimal(b.minimumSubtotal);
    if (!amin || !bmin) return String(a.minimumSubtotal).localeCompare(String(b.minimumSubtotal)) || a.id.localeCompare(b.id);
    const minimum = compareParsed(amin, bmin); if (minimum) return minimum;
    if (a.maximumSubtotal === undefined && b.maximumSubtotal !== undefined) return 1;
    if (a.maximumSubtotal !== undefined && b.maximumSubtotal === undefined) return -1;
    if (a.maximumSubtotal !== undefined && b.maximumSubtotal !== undefined) { const maximum = compareDecimal(a.maximumSubtotal, b.maximumSubtotal); if (maximum) return maximum; }
    return a.id.localeCompare(b.id);
  });
}
function issue(code: string, message: string, tier?: OrderDiscountTier, field?: string): TierValidationIssue { return { code, ...(tier?.id ? { tierId: tier.id } : {}), ...(field ? { field } : {}), message, severity: "error" }; }

export function validateTieredOrderReward(reward: { scope: unknown; method: unknown; configuration?: Partial<TieredOrderDiscountConfiguration> }): TierValidationResult {
  const issues: TierValidationIssue[] = [];
  const scope = reward.scope as PromotionRewardScope; const method = reward.method as PromotionRewardMethod;
  if (!promotionRewardScopes.includes(scope) || !promotionRewardMethods.includes(method) || rewardCapability(scope, method) !== "planned") issues.push(issue("TIER_UNSUPPORTED_REWARD", "Only planned order percentage rewards are valid in this domain contract.", undefined, "scope"));
  const configuration = reward.configuration;
  if (configuration?.basis !== "eligible_merchandise_subtotal") issues.push(issue("TIER_UNSUPPORTED_BASIS", "The order reward basis is unsupported.", undefined, "configuration.basis"));
  if (configuration?.selectionMode !== "highest_eligible") issues.push(issue("TIER_UNSUPPORTED_SELECTION_MODE", "The tier selection mode is unsupported.", undefined, "configuration.selectionMode"));
  if (configuration?.continuityMode !== "continuous" && configuration?.continuityMode !== "allow_gaps") issues.push(issue("TIER_CONTINUITY_INVALID", "The continuity mode is invalid.", undefined, "configuration.continuityMode"));
  const tiers = configuration?.tiers ?? [];
  if (!tiers.length) issues.push(issue("TIER_REQUIRED", "At least one tier is required.", undefined, "configuration.tiers"));
  const ids = new Set<string>();
  for (const tier of tiers) {
    if (!tier.id?.trim()) issues.push(issue("TIER_ID_INVALID", "A stable public tier ID is required.", tier, "id"));
    else if (ids.has(tier.id)) issues.push(issue("TIER_DUPLICATE_ID", "Tier IDs must be unique.", tier, "id")); else ids.add(tier.id);
    const min = parseDecimal(tier.minimumSubtotal); const max = tier.maximumSubtotal === undefined ? undefined : parseDecimal(tier.maximumSubtotal); const pct = parseDecimal(tier.percentage);
    if (!min) issues.push(issue("TIER_DECIMAL_MALFORMED", "Minimum subtotal must be a plain decimal value.", tier, "minimumSubtotal"));
    else if (compareParsed(min, { coefficient: 0n, scale: 0 }) < 0) issues.push(issue("TIER_MINIMUM_NEGATIVE", "Minimum subtotal cannot be negative.", tier, "minimumSubtotal"));
    if (tier.maximumSubtotal !== undefined && !max) issues.push(issue("TIER_DECIMAL_MALFORMED", "Maximum subtotal must be a plain decimal value.", tier, "maximumSubtotal"));
    else if (max && compareParsed(max, { coefficient: 0n, scale: 0 }) < 0) issues.push(issue("TIER_MAXIMUM_NEGATIVE", "Maximum subtotal cannot be negative.", tier, "maximumSubtotal"));
    if (min && max && compareParsed(max, min) <= 0) issues.push(issue("TIER_MAXIMUM_INVALID", "Maximum subtotal must be greater than minimum subtotal.", tier, "maximumSubtotal"));
    if (!pct) issues.push(issue("TIER_DECIMAL_MALFORMED", "Percentage must be a plain decimal value.", tier, "percentage"));
    else if (compareParsed(pct, { coefficient: 0n, scale: 0 }) <= 0 || compareParsed(pct, { coefficient: 100n, scale: 0 }) > 0) issues.push(issue("TIER_PERCENTAGE_INVALID", "Percentage must be greater than zero and no more than 100.", tier, "percentage"));
  }
  const sorted = sortOrderDiscountTiers(tiers).filter((tier) => normalizedTier(tier));
  const openEnded = sorted.filter((tier) => tier.maximumSubtotal === undefined);
  if (openEnded.length > 1) issues.push(issue("TIER_MULTIPLE_OPEN_ENDED", "Only one tier may be open-ended."));
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]; const current = sorted[index];
    if (compareDecimal(previous.minimumSubtotal, current.minimumSubtotal) === 0) {
      if (previous.maximumSubtotal === current.maximumSubtotal || (previous.maximumSubtotal !== undefined && current.maximumSubtotal !== undefined && compareDecimal(previous.maximumSubtotal, current.maximumSubtotal) === 0)) issues.push(issue("TIER_DUPLICATE_RANGE", "Tier ranges must be unique.", current));
      issues.push(issue("TIER_DUPLICATE_MINIMUM", "Tier minimums must be unique.", current, "minimumSubtotal"));
    }
    if (previous.maximumSubtotal === undefined) issues.push(issue("TIER_AFTER_OPEN_ENDED", "No tier may follow an open-ended tier.", current));
    else {
      const boundary = compareDecimal(previous.maximumSubtotal, current.minimumSubtotal);
      if (boundary > 0) issues.push(issue("TIER_OVERLAP", "Tier ranges cannot overlap.", current));
      else if (boundary < 0 && configuration?.continuityMode === "continuous") issues.push(issue("TIER_GAP_NOT_ALLOWED", "Continuous tiers cannot contain gaps.", current));
    }
  }
  return { valid: issues.length === 0, executable: false, issues };
}

export function evaluateTierProgress(tiers: readonly OrderDiscountTier[], subtotal: DecimalLike): TierProgressEvaluation {
  const parsedSubtotal = parseDecimal(subtotal); if (!parsedSubtotal) throw new Error("Subtotal must be a plain decimal value.");
  const sorted = sortOrderDiscountTiers(tiers).map(normalizedTier).filter((tier): tier is EvaluatedOrderDiscountTier => tier !== null);
  const matches = sorted.filter((tier) => compareDecimal(subtotal, tier.minimumSubtotal) >= 0 && (tier.maximumSubtotal === undefined || compareDecimal(subtotal, tier.maximumSubtotal) < 0));
  if (matches.length > 1) throw new Error("Invalid tier configuration matched more than one tier.");
  const activeTier = matches[0];
  const nextTier = sorted.find((tier) => compareDecimal(tier.minimumSubtotal, subtotal) > 0);
  const amountToNextTier = nextTier ? subtractDecimal(nextTier.minimumSubtotal, subtotal) : undefined;
  return { ...(activeTier ? { activeTier } : {}), ...(nextTier ? { nextTier, amountToNextTier } : {}), highestTierReached: Boolean(activeTier && !nextTier) };
}

export function canonicalizeTieredOrderReward(reward: TieredOrderPercentageReward): TieredOrderPercentageReward {
  const validation = validateTieredOrderReward(reward); if (!validation.valid) throw new Error(`Invalid tiered order reward: ${validation.issues.map((entry) => entry.code).join(", ")}`);
  return { scope: "order", method: "percentage", configuration: { selectionMode: "highest_eligible", continuityMode: reward.configuration.continuityMode, basis: "eligible_merchandise_subtotal", tiers: sortOrderDiscountTiers(reward.configuration.tiers).map((tier) => normalizedTier(tier)!) } };
}
export function resolveOrderRewardCandidate(candidates: readonly OrderRewardCandidate[], authoritativeSubtotal: DecimalLike): OrderRewardCandidate | undefined {
  const subtotal = parseDecimal(authoritativeSubtotal);
  if (!subtotal || compareParsed(subtotal, { coefficient: 0n, scale: 0 }) < 0) throw new Error("Authoritative subtotal must be a non-negative plain decimal value.");
  return [...candidates].sort((a, b) => b.priority - a.priority || compareDecimal(b.percentage, a.percentage) || a.sourceRuleId.localeCompare(b.sourceRuleId))[0];
}
