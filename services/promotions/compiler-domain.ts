import type { PromotionRewardType, PromotionRuleStatus, PromotionTriggerMatchMode, PromotionTriggerType } from "./domain.ts";
import type { CanonicalPromotionReward } from "./reward-strategy.ts";

export const PROMOTION_COMPILER_SCHEMA_VERSION = 1 as const;
export type PromotionCompilerSchemaVersion = typeof PROMOTION_COMPILER_SCHEMA_VERSION;
export type DecimalLike = string | number | { toString(): string };

export type PromotionCompilerTriggerReference = {
  id?: string | null;
  sourceType: PromotionTriggerType;
  referenceGid?: string | null;
  referenceValue?: string | null;
  normalizedValue?: string | null;
};

export type PromotionCompilerRuleInput = {
  id: string;
  shopId: string;
  status: PromotionRuleStatus;
  priority: number;
  triggerType: PromotionTriggerType;
  triggerReferences: PromotionCompilerTriggerReference[];
  triggerMatchMode: PromotionTriggerMatchMode;
  minimumTriggerQuantity: number;
  minimumCartSubtotal?: DecimalLike | null;
  offerProductGid: string;
  offerProductTitle?: string | null;
  offerProductHandle?: string | null;
  offerProductImageUrl?: string | null;
  rewardType: PromotionRewardType;
  rewardValue: DecimalLike;
  maximumRewardQuantity: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  combinesWithProductDiscounts: boolean;
  combinesWithOrderDiscounts: boolean;
  combinesWithShippingDiscounts: boolean;
  heading?: string | null;
  badgeText?: string | null;
  customerMessage?: string | null;
  ctaText?: string | null;
  description?: string | null;
  [key: string]: unknown;
};

export type PromotionSourceMembershipGroup = {
  sourceReferenceId: string;
  sourceType: PromotionTriggerType;
  sourceGid?: string;
  sourceValue?: string;
  productGids: string[];
  unresolved: boolean;
};

export type PromotionCompilerSourceSnapshot = {
  schemaVersion: PromotionCompilerSchemaVersion;
  ruleId: string;
  status: PromotionRuleStatus;
  priority: number;
  trigger: { type: PromotionTriggerType; matchMode: PromotionTriggerMatchMode; minimumQuantity: number; minimumCartSubtotal: string | null; sourceGroups: PromotionSourceMembershipGroup[] };
  offer: { productGid: string; handle: string | null };
  reward: CanonicalPromotionReward;
  schedule: { startsAt: string | null; endsAt: string | null };
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
};

export type PromotionCompiledStorefrontPromotion = PromotionCompilerSourceSnapshot & {
  offer: { productGid: string; title: string | null; handle: string | null; imageUrl: string | null };
  presentation: { heading: string | null; badgeText: string | null; customerMessage: string | null; ctaText: string | null };
};

export type PromotionCompiledFunctionPromotion = PromotionCompilerSourceSnapshot;

export type PromotionCompilerDiagnosticSummary = {
  schemaVersion: PromotionCompilerSchemaVersion;
  ruleId: string;
  triggerGroupCount: number;
  flattenedProductGids: string[];
  unresolvedGroupCount: number;
  sourceHash: string;
  storefrontHash: string;
  functionHash: string;
};

export type PromotionCompilerResult = {
  sourceSnapshot: PromotionCompilerSourceSnapshot;
  storefrontPayload: PromotionCompiledStorefrontPromotion;
  functionPayload: PromotionCompiledFunctionPromotion;
  hashes: { sourceHash: string; storefrontHash: string; functionHash: string };
  diagnostics: PromotionCompilerDiagnosticSummary;
};
