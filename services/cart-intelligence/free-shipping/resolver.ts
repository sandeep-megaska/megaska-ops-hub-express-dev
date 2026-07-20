import type {
  FreeShippingProgressViewModel,
  FreeShippingSourceMode,
  ShopifyFreeShippingAudit,
  ShopifyFreeShippingCandidate,
} from "./types";

function minorUnits(amount: string | null) {
  if (amount === null || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function resolveShopifyFreeShipping(input: {
  candidates: ShopifyFreeShippingCandidate[];
  profileCount: number;
  cartCurrency: string;
  malformed?: boolean;
  failureReason?: string;
}): ShopifyFreeShippingAudit {
  const base = { profileCount: input.profileCount, applicableProfileCount: 0, resolvedAt: new Date().toISOString() };
  if (input.failureReason) return { ...base, status: "UNSUPPORTED", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: input.failureReason };
  if (input.malformed) return { ...base, status: "UNSUPPORTED", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "Malformed Shopify delivery-profile response" };
  if (input.candidates.some((candidate) => !candidate.broadlyApplicable)) {
    return { ...base, status: "AMBIGUOUS", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "Product-specific delivery profile cannot be mapped reliably to the cart" };
  }
  const active = input.candidates.filter((candidate) => candidate.active);
  if (active.some((candidate) => candidate.providerType === "CARRIER")) {
    return { ...base, status: "UNSUPPORTED", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "Carrier-calculated delivery rate is not supported" };
  }
  if (active.some((candidate) => candidate.conditionType === "WEIGHT" || candidate.conditionType === "UNSUPPORTED")) {
    return { ...base, status: "UNSUPPORTED", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "Delivery method uses an unsupported condition type" };
  }
  const zeroRates = active.filter((candidate) => Number(candidate.priceAmount) === 0 && candidate.conditionType === "MINIMUM_SUBTOTAL");
  if (!zeroRates.length) return { ...base, status: "NOT_CONFIGURED", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "No active zero-price minimum-subtotal delivery method was found" };
  if (zeroRates.some((candidate) => candidate.zoneCount !== 1)) {
    return { ...base, applicableProfileCount: zeroRates.length, status: "AMBIGUOUS", thresholdMinor: null, currency: null, profileId: null, profileName: null, reason: "Delivery zone applicability is ambiguous before destination is known" };
  }
  const cartCurrency = input.cartCurrency.toUpperCase();
  if (zeroRates.some((candidate) => candidate.priceCurrency?.toUpperCase() !== cartCurrency || candidate.conditionCurrency?.toUpperCase() !== cartCurrency)) {
    return { ...base, applicableProfileCount: zeroRates.length, status: "UNSUPPORTED", thresholdMinor: null, currency: cartCurrency, profileId: null, profileName: null, reason: "Delivery method currency does not match the cart currency" };
  }
  const thresholds = zeroRates.map((candidate) => minorUnits(candidate.conditionAmount));
  if (thresholds.some((threshold) => threshold === null || threshold! <= 0)) {
    return { ...base, applicableProfileCount: zeroRates.length, status: "UNSUPPORTED", thresholdMinor: null, currency: cartCurrency, profileId: null, profileName: null, reason: "Delivery threshold is malformed" };
  }
  const distinct = [...new Set(thresholds as number[])];
  if (distinct.length !== 1) return { ...base, applicableProfileCount: zeroRates.length, status: "AMBIGUOUS", thresholdMinor: null, currency: cartCurrency, profileId: null, profileName: null, reason: "Multiple conflicting Shopify free-shipping thresholds were found" };
  return { ...base, applicableProfileCount: zeroRates.length, status: "AVAILABLE", thresholdMinor: distinct[0], currency: cartCurrency, profileId: zeroRates[0].profileId, profileName: zeroRates.length === 1 ? zeroRates[0].profileName : "Multiple profiles (same threshold)", reason: "Reliable Shopify minimum-subtotal threshold detected" };
}

export function resolveFreeShippingProgress(input: {
  enabled: boolean;
  progressEnabled: boolean;
  sourceMode: FreeShippingSourceMode;
  fallbackThresholdMinor: number | null;
  progressBarText: string;
  currentSubtotalMinor: number;
  cartCurrency: string;
  shopify: ShopifyFreeShippingAudit;
}): FreeShippingProgressViewModel {
  const diagnostic = { profileCount: input.shopify.profileCount, applicableProfileCount: input.shopify.applicableProfileCount, reason: input.shopify.reason };
  let threshold = input.shopify.status === "AVAILABLE" ? input.shopify.thresholdMinor : null;
  let source: FreeShippingProgressViewModel["source"] = threshold ? "SHOPIFY_DELIVERY_PROFILE" : null;
  if (input.sourceMode === "MANUAL_DISPLAY_ONLY") { threshold = input.fallbackThresholdMinor; source = threshold ? "MERCHANT_FALLBACK" : null; }
  else if (input.sourceMode === "SHOPIFY_WITH_FALLBACK" && (input.shopify.status === "NOT_CONFIGURED" || input.shopify.status === "UNSUPPORTED") && !threshold) { threshold = input.fallbackThresholdMinor; source = threshold ? "MERCHANT_FALLBACK" : null; }
  const visible = Boolean(input.enabled && input.progressEnabled && threshold && threshold > 0 && source);
  if (!visible) return { visible: false, status: input.shopify.status, source: null, currency: null, thresholdMinor: null, currentSubtotalMinor: input.currentSubtotalMinor, remainingMinor: null, progressPercent: null, message: null, diagnostic };
  const remaining = Math.max(0, threshold! - input.currentSubtotalMinor);
  const unlocked = remaining === 0;
  return { visible: true, status: unlocked ? "UNLOCKED" : "AVAILABLE", source, currency: input.cartCurrency.toUpperCase(), thresholdMinor: threshold, currentSubtotalMinor: input.currentSubtotalMinor, remainingMinor: remaining, progressPercent: unlocked ? 100 : Math.min(100, Math.max(0, Math.round(input.currentSubtotalMinor / threshold! * 100))), message: unlocked ? "You’ve unlocked free shipping" : input.progressBarText, diagnostic };
}
