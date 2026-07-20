import { PROMOTION_COMPILER_SCHEMA_VERSION, type PromotionCompilerResult, type PromotionCompilerRuleInput, type PromotionSourceMembershipGroup } from "./compiler-domain.ts";
import { sha256Hex } from "./compiler-hash.ts";
import { canonicalCollectionGid, canonicalDecimalString, canonicalOptionalText, canonicalProductGid, canonicalProductType, canonicalUtcIso, PromotionCompilerNormalizationError } from "./compiler-normalization.ts";
import { normalizePromotionReward } from "./reward-strategy.ts";
import { canonicalizeTieredOrderReward, validateTieredOrderReward } from "./tiered-order-discount.ts";

function refId(ref: PromotionCompilerRuleInput["triggerReferences"][number], index: number) { return ref.id || ref.referenceGid || ref.normalizedValue || ref.referenceValue || `${ref.sourceType}:${index}`; }
function sortedGroups(groups: PromotionSourceMembershipGroup[]) { return [...groups].map((g) => ({ ...g, productGids: [...new Set(g.productGids)].sort() })).sort((a, b) => `${a.sourceType}:${a.sourceReferenceId}`.localeCompare(`${b.sourceType}:${b.sourceReferenceId}`)); }

export function compilePromotionRule(input: PromotionCompilerRuleInput): PromotionCompilerResult {
  const isOrder = input.rewardScope === "ORDER";
  const offerProductGid = isOrder ? canonicalOptionalText(input.offerProductGid) ?? "" : canonicalProductGid(input.offerProductGid);
  const offerProductHandle = canonicalOptionalText(input.offerProductHandle);
  const normalizedReward = normalizePromotionReward(
    { type: input.rewardType, value: canonicalDecimalString(input.rewardValue), maximumQuantity: input.maximumRewardQuantity },
    { productGid: offerProductGid, quantityCap: input.maximumRewardQuantity },
  );
  if (!isOrder && (!normalizedReward.ok || !normalizedReward.validation.executable)) throw new PromotionCompilerNormalizationError(`Reward is not executable: ${normalizedReward.ok ? "unsupported reward" : normalizedReward.issues.map((entry) => entry.code).join(", ")}.`);
  const groups = sortedGroups(input.triggerReferences.map((ref, index): PromotionSourceMembershipGroup => {
    const sourceReferenceId = refId(ref, index);
    if (ref.sourceType === "PRODUCT") { const gid = canonicalProductGid(ref.referenceGid); return { sourceReferenceId, sourceType: "PRODUCT", sourceGid: gid, productGids: [gid], unresolved: false }; }
    if (ref.sourceType === "COLLECTION") return { sourceReferenceId, sourceType: "COLLECTION", sourceGid: canonicalCollectionGid(ref.referenceGid), productGids: [], unresolved: true };
    if (ref.sourceType === "PRODUCT_TYPE") return { sourceReferenceId, sourceType: "PRODUCT_TYPE", sourceValue: canonicalProductType(ref.normalizedValue ?? ref.referenceValue), productGids: [], unresolved: true };
    throw new PromotionCompilerNormalizationError("Unsupported trigger source type.");
  }));
  const base = {
    schemaVersion: PROMOTION_COMPILER_SCHEMA_VERSION,
    ruleId: input.id,
    status: input.status,
    priority: input.priority,
    trigger: { type: input.triggerType, matchMode: input.triggerMatchMode, minimumQuantity: input.minimumTriggerQuantity, minimumCartSubtotal: input.minimumCartSubtotal == null ? null : canonicalDecimalString(input.minimumCartSubtotal), sourceGroups: groups },
    offer: { productGid: offerProductGid, handle: offerProductHandle },
    reward: isOrder ? (() => { const reward = { scope: "order" as const, method: "percentage" as const, configuration: { selectionMode: "highest_eligible" as const, continuityMode: input.tierContinuityMode === "ALLOW_GAPS" ? "allow_gaps" as const : "continuous" as const, basis: "eligible_merchandise_subtotal" as const, tiers: (input.orderTiers ?? []).map((tier) => ({ id: tier.publicId, minimumSubtotal: String(tier.minimumSubtotal), ...(tier.maximumSubtotal == null ? {} : { maximumSubtotal: String(tier.maximumSubtotal) }), percentage: String(tier.percentage) })) } }; if (!validateTieredOrderReward(reward).valid) throw new PromotionCompilerNormalizationError("Persisted order tier configuration is invalid."); return canonicalizeTieredOrderReward(reward); })() : (normalizedReward as Extract<typeof normalizedReward, { ok: true }>).reward,
    schedule: { startsAt: canonicalUtcIso(input.startsAt), endsAt: canonicalUtcIso(input.endsAt) },
    combinesWith: { productDiscounts: Boolean(input.combinesWithProductDiscounts), orderDiscounts: Boolean(input.combinesWithOrderDiscounts), shippingDiscounts: Boolean(input.combinesWithShippingDiscounts) },
  };
  const storefrontPayload = { ...base, offer: { ...base.offer, title: canonicalOptionalText(input.offerProductTitle), imageUrl: canonicalOptionalText(input.offerProductImageUrl) }, presentation: { heading: canonicalOptionalText(input.heading), badgeText: canonicalOptionalText(input.badgeText), customerMessage: canonicalOptionalText(input.customerMessage), ctaText: canonicalOptionalText(input.ctaText) } };
  const functionPayload = base;
  const hashes = { sourceHash: sha256Hex(base), storefrontHash: sha256Hex(storefrontPayload), functionHash: sha256Hex(functionPayload) };
  const flattenedProductGids = [...new Set(groups.flatMap((g) => g.productGids))].sort();
  return { sourceSnapshot: base, storefrontPayload, functionPayload, hashes, diagnostics: { schemaVersion: PROMOTION_COMPILER_SCHEMA_VERSION, ruleId: input.id, triggerGroupCount: groups.length, flattenedProductGids, unresolvedGroupCount: groups.filter((g) => g.unresolved).length, ...hashes } };
}
