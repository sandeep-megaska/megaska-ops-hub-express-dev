export const promotionRuleStatuses = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type PromotionRuleStatus = (typeof promotionRuleStatuses)[number];

export const promotionTriggerTypes = ["PRODUCT", "COLLECTION", "PRODUCT_TYPE"] as const;
export type PromotionTriggerType = (typeof promotionTriggerTypes)[number];

export const promotionTriggerMatchModes = ["ANY", "ALL"] as const;
export type PromotionTriggerMatchMode = (typeof promotionTriggerMatchModes)[number];

export const promotionRewardTypes = ["PERCENTAGE_OFF", "FIXED_AMOUNT_OFF", "FIXED_PRICE"] as const;
export type PromotionRewardType = (typeof promotionRewardTypes)[number];

export const promotionCompilationStatuses = ["PENDING", "COMPILING", "READY", "FAILED", "SUPERSEDED"] as const;
export type PromotionCompilationStatus = (typeof promotionCompilationStatuses)[number];

export const promotionCompilationReasons = [
  "RULE_CREATED",
  "RULE_UPDATED",
  "MANUAL_RECOMPILE",
  "COLLECTION_CHANGED",
  "PRODUCT_CHANGED",
  "PRODUCT_TYPE_CHANGED",
  "SCHEDULE_RECONCILIATION",
  "SYSTEM_REPAIR",
] as const;
export type PromotionCompilationReason = (typeof promotionCompilationReasons)[number];

export type PromotionTriggerReferenceInput = {
  sourceType: PromotionTriggerType;
  referenceGid?: string | null;
  referenceValue?: string | null;
  normalizedValue?: string | null;
};

export type PromotionRuleValidationInput = {
  name: string;
  status?: PromotionRuleStatus;
  priority?: number;
  triggerType: PromotionTriggerType;
  triggerReferences?: PromotionTriggerReferenceInput[];
  minimumTriggerQuantity?: number;
  offerProductGid: string;
  rewardType: PromotionRewardType;
  rewardValue: string | number;
  maximumRewardQuantity?: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  heading?: string | null;
  badgeText?: string | null;
  customerMessage?: string | null;
  ctaText?: string | null;
};

export type PromotionValidationError = {
  field: string;
  message: string;
};

export type PromotionValidationResult = {
  valid: boolean;
  errors: PromotionValidationError[];
};
