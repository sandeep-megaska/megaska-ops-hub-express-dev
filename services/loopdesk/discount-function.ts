export const LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_NAMESPACE = "loopdesk" as const;
export const LOOPDESK_DISCOUNT_FUNCTION_METAFIELD_KEY = "discount_function_config" as const;

export type RewardEnforcementType =
  | "fixed_price"
  | "percentage"
  | "fixed_amount"
  | "free_gift";

export type LoopDeskDiscountFunctionTriggerType =
  | "always"
  | "cart_contains_product"
  | "cart_contains_collection"
  | "cart_contains_variant"
  | "cart_contains_product_type"
  | "cart_contains_tag"
  | "cart_subtotal_gte"
  | "cart_quantity_gte";

export type CompiledPromotionEnforcementRule = {
  id: string;
  enabled: boolean;
  priority: number;
  triggerType: LoopDeskDiscountFunctionTriggerType;
  triggerValue?: string | number | null;
  rewardEnforcementType: RewardEnforcementType;
  rewardProductGid?: string | null;
  rewardVariantGid?: string | null;
  quantity?: number;
};

export type LoopDeskDiscountFunctionConfig = {
  schemaVersion: 1;
  enabled: boolean;
  rules: CompiledPromotionEnforcementRule[];
};
