import { getPromotionRulesConfig, type PromotionRule } from "../promotion-rules/config";
import type { CompiledPromotionEnforcementRule, LoopDeskDiscountFunctionConfig, LoopDeskDiscountFunctionTriggerType, RewardEnforcementType } from "./discount-function";

const SUPPORTED_FUNCTION_TRIGGER_TYPES = new Set(["always", "cart_contains_variant", "cart_subtotal_gte", "cart_quantity_gte"]);

function firstTrigger(rule: PromotionRule) {
  return rule.eligibility.triggers[0] || { type: "always" as const };
}

export function canonicalizeProductVariantGid(input: string | null | undefined) {
  const value = String(input || "").trim();
  const gidMatch = value.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
  if (gidMatch) return `gid://shopify/ProductVariant/${gidMatch[1]}`;
  const numericMatch = value.match(/^(\d+)$/);
  if (numericMatch) return `gid://shopify/ProductVariant/${numericMatch[1]}`;
  throw new Error(`Malformed Shopify ProductVariant ID: ${value || "empty"}`);
}

export function isRustFunctionSupportedTriggerType(type: string) {
  return SUPPORTED_FUNCTION_TRIGGER_TYPES.has(type);
}

function triggerValue(rule: PromotionRule): string | number | null {
  const trigger = firstTrigger(rule);
  if (trigger.type === "cart_contains_product") return String(trigger.productGid || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_collection") return String(trigger.collectionGid || trigger.value || "").trim() || null;
  if (trigger.type === "cart_contains_variant") {
    const raw = String(trigger.variantGid || trigger.value || "").trim();
    return raw ? canonicalizeProductVariantGid(raw) : null;
  }
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
    return typeof percentageValue === "number" && Number.isFinite(percentageValue) && percentageValue > 0 && percentageValue <= 100 && hasValidTrigger(rule);
  }

  if (rule.rewardEnforcementType === "fixed_amount") {
    const fixedAmountValue = rule.fixedAmountValue;
    return typeof fixedAmountValue === "number" && Number.isFinite(fixedAmountValue) && fixedAmountValue > 0 && hasValidTrigger(rule);
  }

  return false;
}

export function compilePromotionRuleEnforcementRule(rule: PromotionRule): CompiledPromotionEnforcementRule | null {
  const discount = rule.reward.discount;
  if (!isRustFunctionSupportedTriggerType(firstTrigger(rule).type)) return null;
  if (discount?.type !== "fixed_price" && discount?.type !== "percentage" && discount?.type !== "fixed_amount") return null;

  const baseRule = {
    id: rule.id,
    enabled: true,
    priority: rule.priority,
    triggerType: firstTrigger(rule).type as LoopDeskDiscountFunctionTriggerType,
    triggerValue: triggerValue(rule),
    rewardProductGid: rule.reward.productGid || null,
    rewardVariantGid: canonicalizeProductVariantGid(rule.reward.variantGid),
    quantity: rule.reward.quantity,
  };

  if (discount.type === "percentage") {
    return {
      ...baseRule,
      rewardEnforcementType: "percentage" satisfies RewardEnforcementType,
      percentageValue: discount.value,
    };
  }

  if (discount.type === "fixed_amount") {
    return {
      ...baseRule,
      rewardEnforcementType: "fixed_amount" satisfies RewardEnforcementType,
      fixedAmountValue: discount.value,
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
