export type FreeShippingResolutionStatus =
  | "AVAILABLE"
  | "UNLOCKED"
  | "NOT_CONFIGURED"
  | "AMBIGUOUS"
  | "UNSUPPORTED";

export type FreeShippingSource = "SHOPIFY_DELIVERY_PROFILE" | "MERCHANT_FALLBACK" | null;
export type FreeShippingSourceMode = "SHOPIFY_ONLY" | "SHOPIFY_WITH_FALLBACK" | "MANUAL_DISPLAY_ONLY";

export type FreeShippingProgressViewModel = {
  visible: boolean;
  status: FreeShippingResolutionStatus;
  source: FreeShippingSource;
  currency: string | null;
  thresholdMinor: number | null;
  currentSubtotalMinor: number;
  remainingMinor: number | null;
  progressPercent: number | null;
  message: string | null;
  diagnostic?: { profileCount: number; applicableProfileCount: number; reason: string };
};

export type ShopifyFreeShippingCandidate = {
  profileId: string;
  profileName: string;
  broadlyApplicable: boolean;
  zoneCount: number;
  active: boolean;
  providerType: "MERCHANT" | "CARRIER" | "UNKNOWN";
  priceAmount: string | null;
  priceCurrency: string | null;
  conditionType: "MINIMUM_SUBTOTAL" | "WEIGHT" | "UNSUPPORTED" | null;
  conditionAmount: string | null;
  conditionCurrency: string | null;
};

export type ShopifyFreeShippingAudit = {
  status: Exclude<FreeShippingResolutionStatus, "AVAILABLE" | "UNLOCKED"> | "AVAILABLE";
  thresholdMinor: number | null;
  currency: string | null;
  profileId: string | null;
  profileName: string | null;
  profileCount: number;
  applicableProfileCount: number;
  reason: string;
  resolvedAt: string | null;
};
