import type { PromotionRuleValidationInput, PromotionTriggerReferenceInput, PromotionValidationError, PromotionValidationResult } from "./domain.ts";
import { normalizeDate, normalizeRewardValue, normalizeShopifyCollectionGid, normalizeShopifyProductGid } from "./normalization.ts";
import { normalizePromotionReward } from "./reward-strategy.ts";

const TEXT_LIMITS = {
  name: 120,
  heading: 120,
  badgeText: 60,
  customerMessage: 240,
  ctaText: 60,
} as const;

function add(errors: PromotionValidationError[], field: string, message: string) {
  errors.push({ field, message });
}

export function validatePromotionTriggerReference(reference: PromotionTriggerReferenceInput): PromotionValidationResult {
  const errors: PromotionValidationError[] = [];
  if (reference.sourceType === "PRODUCT") {
    if (!normalizeShopifyProductGid(reference.referenceGid)) add(errors, "referenceGid", "Product triggers require a canonical Shopify Product GID.");
    if (reference.referenceGid && String(reference.referenceGid).includes("/ProductVariant/")) add(errors, "referenceGid", "Product triggers must not use variant GIDs.");
  } else if (reference.sourceType === "COLLECTION") {
    if (!normalizeShopifyCollectionGid(reference.referenceGid)) add(errors, "referenceGid", "Collection triggers require a canonical Shopify Collection GID.");
  } else if (reference.sourceType === "PRODUCT_TYPE") {
    // Product-type triggers are not supported by the discount Function runtime
    // (it matches by product/collection GID). They compile but can never sync,
    // so reject them here with a clear message instead of failing at publish.
    add(errors, "sourceType", "Product-type triggers aren't supported yet. Use a Product or Collection trigger instead.");
  } else {
    add(errors, "sourceType", "Unsupported promotion trigger type.");
  }
  return { valid: errors.length === 0, errors };
}

export function validatePromotionRule(input: PromotionRuleValidationInput): PromotionValidationResult {
  const errors: PromotionValidationError[] = [];
  const name = input.name.trim();
  if (!name) add(errors, "name", "Name is required.");
  if (name.length > TEXT_LIMITS.name) add(errors, "name", `Name must be ${TEXT_LIMITS.name} characters or fewer.`);
  if (input.priority !== undefined && !Number.isInteger(input.priority)) add(errors, "priority", "Priority must be an integer.");
  if (!Number.isInteger(input.minimumTriggerQuantity) || Number(input.minimumTriggerQuantity) < 1) add(errors, "minimumTriggerQuantity", "Minimum trigger quantity must be at least 1.");
  if ((input as typeof input & { rewardScope?: string }).rewardScope !== "ORDER" && (!Number.isInteger(input.maximumRewardQuantity) || Number(input.maximumRewardQuantity) < 1)) add(errors, "maximumRewardQuantity", "Maximum reward quantity must be at least 1.");
  if ((input as typeof input & { rewardScope?: string }).rewardScope !== "ORDER" && !normalizeShopifyProductGid(input.offerProductGid)) add(errors, "offerProductGid", "Offer product must be a canonical Shopify Product GID.");

  const startsAt = normalizeDate(input.startsAt);
  const endsAt = normalizeDate(input.endsAt);
  if (input.startsAt != null && !startsAt) add(errors, "startsAt", "Start date must be a valid UTC DateTime.");
  if (input.endsAt != null && !endsAt) add(errors, "endsAt", "End date must be a valid UTC DateTime.");
  if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) add(errors, "endsAt", "End date must be after start date.");

  const rewardValue = normalizeRewardValue(input.rewardValue);
  const reward = normalizePromotionReward({ type: input.rewardType, value: rewardValue, maximumQuantity: input.maximumRewardQuantity }, { productGid: input.offerProductGid, quantityCap: input.maximumRewardQuantity });
  if ((input as typeof input & { rewardScope?: string }).rewardScope !== "ORDER" && !reward.ok) reward.issues.filter((entry) => !["configuration.productGid", "configuration.quantityCap"].includes(entry.field ?? "")).forEach((entry) => add(errors, "rewardValue", entry.message));

  for (const field of ["heading", "badgeText", "customerMessage", "ctaText"] as const) {
    const value = input[field];
    if (typeof value === "string" && value.trim().length > TEXT_LIMITS[field]) add(errors, field, `${field} must be ${TEXT_LIMITS[field]} characters or fewer.`);
  }

  const references = input.triggerReferences ?? [];
  if (input.status === "ACTIVE" && references.length === 0) add(errors, "triggerReferences", "Active rules require at least one trigger reference.");
  references.forEach((reference, index) => {
    if (reference.sourceType !== input.triggerType) add(errors, `triggerReferences.${index}.sourceType`, "Trigger reference type must match the rule trigger type.");
    validatePromotionTriggerReference(reference).errors.forEach((error) => add(errors, `triggerReferences.${index}.${error.field}`, error.message));
  });

  return { valid: errors.length === 0, errors };
}
