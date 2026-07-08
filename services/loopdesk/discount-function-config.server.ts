import { getPromotionRulesConfig, type PromotionRule } from "../promotion-rules/config";
import type { CompiledPromotionEnforcementRule, LoopDeskDiscountFunctionConfig, LoopDeskDiscountFunctionTriggerType, RewardEnforcementType } from "./discount-function";

function firstTrigger(rule: PromotionRule) {
  return rule.eligibility.triggers[0] || { type: "always" as const };
}

function triggerValue(rule: PromotionRule): string | number | null {
  const trigger = firstTrigger(rule);
  if (trigger.type === "cart_contains_product") return String(trigger.productGid || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_collection") return String(trigger.collectionGid || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_variant") return String(trigger.variantGid || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_product_type") return String(trigger.productType || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_tag") return String(trigger.tag || trigger.value || "").trim() || null;
  if (trigger.type === "cart_subtotal_gte") return Number(trigger.subtotalGte ?? trigger.value ?? 0) || null;
  if (trigger.type === "cart_quantity_gte") return Number(trigger.quantityGte ?? trigger.value ?? 0) || null;
  return null;
}

function rewardEnforcementType(rule: PromotionRule): RewardEnforcementType {
  const displayPrice = String(rule.display.offerPriceDisplay || "").trim();
  return displayPrice ? "fixed_price" : "free_gift";
}

function fixedPriceAmount(rule: PromotionRule): number | null {
  const raw = String(rule.display.offerPriceDisplay || "").replace(/[^0-9.]/g, "");
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function isValidCompiledRule(rule: CompiledPromotionEnforcementRule) {
  if (!rule.id || !rule.rewardVariantGid || !rule.rewardProductGid) return false;
  if (rule.rewardEnforcementType !== "fixed_price") return false;
  if (!rule.fixedPriceAmount || rule.fixedPriceAmount <= 0) return false;
  if (rule.triggerType === "always") return true;
  return rule.triggerValue !== null && rule.triggerValue !== undefined && String(rule.triggerValue).trim() !== "";
}

export async function compileLoopDeskDiscountFunctionConfig(shopId: string, shopDomain?: string | null): Promise<LoopDeskDiscountFunctionConfig> {
  const promotionConfig = await getPromotionRulesConfig(shopId, shopDomain);
  if (!promotionConfig.enabled) return { schemaVersion: 1, enabled: false, rules: [] };

  const rules = promotionConfig.rules
    .filter((rule) => rule.enabled && rule.status === "active")
    .map((rule): CompiledPromotionEnforcementRule => ({
      id: rule.id,
      enabled: true,
      priority: rule.priority,
      triggerType: firstTrigger(rule).type as LoopDeskDiscountFunctionTriggerType,
      triggerValue: triggerValue(rule),
      rewardEnforcementType: rewardEnforcementType(rule),
      rewardProductGid: rule.reward.productGid || null,
      rewardVariantGid: rule.reward.variantGid || null,
      quantity: rule.reward.quantity,
      fixedPriceAmount: fixedPriceAmount(rule),
    }))
    .filter(isValidCompiledRule)
    .sort((left, right) => left.priority - right.priority);

  return { schemaVersion: 1, enabled: rules.length > 0, rules };
}
