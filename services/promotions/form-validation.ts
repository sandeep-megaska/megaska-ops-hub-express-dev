import type { PromotionRewardType, PromotionRuleStatus, PromotionTriggerReferenceInput } from "./domain.ts";
import { validatePromotionRule } from "./validation.ts";

export const promotionTextLimits = { heading: 120, badgeText: 60, customerMessage: 240, ctaText: 60 } as const;

export const friendlyPromotionFieldLabels: Record<string, string> = {
  name: "Internal name",
  triggerReferences: "Trigger selection",
  offerProductGid: "Offer product",
  minimumTriggerQuantity: "Minimum trigger quantity",
  maximumRewardQuantity: "Maximum reward quantity",
  rewardValue: "Reward value",
  startsAt: "Start date",
  endsAt: "End date",
  heading: "Heading",
  badgeText: "Badge text",
  customerMessage: "Customer message",
  ctaText: "CTA text",
};

export function friendlyPromotionFieldLabel(field: string) {
  const root = field.split(".")[0] ?? field;
  return friendlyPromotionFieldLabels[field] ?? friendlyPromotionFieldLabels[root] ?? field;
}

export function rewardValueLabel(type: PromotionRewardType) {
  if (type === "PERCENTAGE_OFF") return "Discount percentage";
  if (type === "FIXED_AMOUNT_OFF") return "Fixed amount off";
  return "Promotional final price";
}

export function rewardValueHelp(type: PromotionRewardType) {
  if (type === "PERCENTAGE_OFF") return "Enter a percentage greater than 0 and no more than 100.";
  if (type === "FIXED_AMOUNT_OFF") return "Enter the amount to subtract from the offer product price. Currency follows the store configuration.";
  return "Enter the final promotional price for the offer product. Currency follows the store configuration.";
}

export type PromotionClientValidationInput = {
  name: string;
  triggerType: "PRODUCT" | "COLLECTION" | "PRODUCT_TYPE";
  triggerReferences: PromotionTriggerReferenceInput[];
  offerProductGid: string;
  minimumTriggerQuantity: number;
  maximumRewardQuantity: number;
  rewardType: PromotionRewardType;
  rewardValue: string | number;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  heading?: string | null;
  badgeText?: string | null;
  customerMessage?: string | null;
  ctaText?: string | null;
  status?: PromotionRuleStatus;
};

export function validatePromotionFormClient(input: PromotionClientValidationInput) {
  const result = validatePromotionRule(input);
  const errors = [...result.errors];
  if (input.triggerReferences.length === 0) errors.push({ field: "triggerReferences", message: "Select at least one trigger before saving or activating." });
  return { valid: errors.length === 0, errors: errors.map((error) => ({ ...error, label: friendlyPromotionFieldLabel(error.field) })) };
}

export type ReadinessItem = { key: string; label: string; complete: boolean };

export function promotionActivationReadiness(input: PromotionClientValidationInput): ReadinessItem[] {
  const valid = validatePromotionFormClient(input);
  const hasError = (fields: string[]) => valid.errors.some((error) => fields.some((field) => error.field === field || error.field.startsWith(`${field}.`)));
  return [
    { key: "name", label: "Internal name is present", complete: input.name.trim().length > 0 && !hasError(["name"]) },
    { key: "trigger", label: "Trigger selection is configured", complete: input.triggerReferences.length > 0 && !hasError(["triggerReferences"]) },
    { key: "offer", label: "Offer product is selected", complete: Boolean(input.offerProductGid) && !hasError(["offerProductGid"]) },
    { key: "reward", label: "Reward value is valid", complete: !hasError(["rewardValue"]) },
    { key: "quantities", label: "Quantities are valid", complete: !hasError(["minimumTriggerQuantity", "maximumRewardQuantity"]) },
    { key: "schedule", label: "Schedule order is valid", complete: !hasError(["startsAt", "endsAt"]) },
  ];
}
