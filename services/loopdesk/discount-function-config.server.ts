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

function hasValidTrigger(rule: CompiledPromotionEnforcementRule) {
  if (rule.triggerType === "always") return true;
  return rule.triggerValue !== null && rule.triggerValue !== undefined && String(rule.triggerValue).trim() !== "";
}

function isValidCompiledRule(rule: CompiledPromotionEnforcementRule) {
  if (!rule.id || !rule.rewardVariantGid || !rule.rewardProductGid) return false;

  if (rule.rewardEnforcementType === "fixed_price") {
    return Number.isFinite(rule.fixedPriceAmount) && hasValidTrigger(rule);
  }

  if (rule.rewardEnforcementType === "percentage") {
    const percentageValue = rule.percentageValue;
    return Number.isFinite(percentageValue) && percentageValue > 0 && percentageValue <= 100 && hasValidTrigger(rule);
  }

  return false;
}

export function compilePromotionRuleEnforcementRule(rule: PromotionRule): CompiledPromotionEnforcementRule | null {
  const discount = rule.reward.discount;
  if (discount?.type !== "fixed_price" && discount?.type !== "percentage") return null;

  const baseRule = {
    id: rule.id,
    enabled: true,
    priority: rule.priority,
    triggerType: firstTrigger(rule).type as LoopDeskDiscountFunctionTriggerType,
    triggerValue: triggerValue(rule),
    rewardProductGid: rule.reward.productGid || null,
    rewardVariantGid: rule.reward.variantGid || null,
    quantity: rule.reward.quantity,
  };

  if (discount.type === "percentage") {
    return {
      ...baseRule,
      rewardEnforcementType: "percentage" satisfies RewardEnforcementType,
      percentageValue: discount.value,
    };
  }

  return {
    ...baseRule,
    rewardEnforcementType: "fixed_price" satisfies RewardEnforcementType,
    fixedPriceAmount: discount.value,
  };
}

export async function compileLoopDeskDiscountFunctionConfig(shopId: string, shopDomain?: string | null): Promise<LoopDeskDiscountFunctionConfig> {
  const promotionConfig = await getPromotionRulesConfig(shopId, shopDomain);
  if (!promotionConfig.enabled) return { schemaVersion: 1, enabled: false, rules: [] };

  const rules = promotionConfig.rules
    .filter((rule) => rule.enabled && rule.status === "active")
    .map(compilePromotionRuleEnforcementRule)
    .filter((rule): rule is CompiledPromotionEnforcementRule => Boolean(rule))
    .filter(isValidCompiledRule)
    .sort((left, right) => left.priority - right.priority);

  return { schemaVersion: 1, enabled: rules.length > 0, rules };
}
