import { prisma } from "../db/prisma";
import { getDelhiveryRuntimeConfig, type DelhiveryPublicRuntimeConfig } from "../delhivery/config";
import { getRazorpayRuntimeConfig, type RazorpayPublicRuntimeConfig } from "../razorpay/config";
import { shopifyAdminGraphql } from "../shopify/admin";
import { readShopifyFreeShipping } from "../cart-intelligence/free-shipping/shopify-reader.server";
import type { FreeShippingSourceMode, ShopifyFreeShippingAudit } from "../cart-intelligence/free-shipping/types";
import { cartDrawerModuleDefaults } from "../cart-intelligence/modules/defaults";
import { normalizeCartDrawerModules } from "../cart-intelligence/modules/normalize";
import type { CartDrawerModulesRuntime } from "../cart-intelligence/modules/types";

export const LOOPDESK_RUNTIME_CONFIG_MODULE_KEY = "loopdesk_runtime_config";
export const CART_INTELLIGENCE_CONFIG_MODULE_KEY = "cart_intelligence_config";

type DrawerMode = "theme" | "loopdesk" | "auto";
type IntegrationStatus = "not_configured" | "configured" | "disabled";

export type LoopDeskMerchantSettings = {
  general: {
    merchantName: string;
    storeName: string;
    supportEmail: string;
    supportPhone: string;
    supportWhatsApp: string;
  };
  branding: {
    merchantName: string;
    storeName: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    textColor: string;
    surfaceColor: string;
    borderRadius: string;
    fontFamily: string;
    showPoweredBy: boolean;
    poweredByText: string;
  };
  labels: {
    expressCheckoutText: string;
    viewCartText: string;
    continueShoppingText: string;
    loadingText: string;
    secureCheckoutText: string;
    otpContinueText: string;
  };
  cart: {
    drawerMode: DrawerMode;
    openAfterAddToCart: boolean;
    expressCheckoutButtonEnabled: boolean;
    viewCartButtonEnabled: boolean;
    nativeDrawerDisabledRequiredMessage: string;
  };
  checkout: { showSecureBadge: boolean; showTrustCopy: boolean };
  otpModalBranding: {
    logoUrl: string | null;
    logoAlt: string;
    fallbackBrandText: string;
    heading: string;
    description: string;
    promotionEnabled: boolean;
    promotionBadgeText: string;
    promotionMessage: string;
    showTrustItems: boolean;
    trustItems: [string, string, string];
    privacyText: string;
    inputHelperText: string;
  };
  integrations: {
    razorpay: { status: IntegrationStatus; displayName: string };
    delhivery: { status: IntegrationStatus; displayName: string };
  };
  analytics: { enabled: boolean; anonymizeCustomerData: boolean };
};

export type CartIntelligenceSettings = {
  enabled: boolean;
  freeShippingProgressEnabled: boolean;
  freeShippingThreshold: number;
  freeShippingSourceMode: FreeShippingSourceMode;
  progressBarText: string;
  trustBadgesEnabled: boolean;
  trustBadges: TrustBadgeConfig;
  dynamicBannerEnabled: boolean;
  dynamicBannerText: string;
  upsellsEnabled: boolean;
  bundlesEnabled: boolean;
  aiRecommendationsEnabled: boolean;
  cartDrawerModules: CartDrawerModulesRuntime;
};

export type TrustBadgeIcon = "secure-payment" | "delivery" | "exchange" | "cod" | "support" | "authenticity" | "custom";
export type TrustBadgeItem = { id: string; enabled: boolean; icon: TrustBadgeIcon; label: string; sortOrder: number };
export type TrustBadgeConfig = { enabled: boolean; placement: "BELOW_TOTALS" | "BELOW_CHECKOUT_BUTTON"; layout: "ROW" | "GRID"; items: TrustBadgeItem[] };

export type CartIntelligencePublicRuntimeConfig = {
  enabled: boolean;
  cartDrawerModules: CartDrawerModulesRuntime;
  trustBadges: TrustBadgeConfig;
  freeShippingProgress: {
    enabled: boolean;
    sourceMode: FreeShippingSourceMode;
    fallbackThresholdMinor: number | null;
    progressBarText: string;
    resolvedShopifyThresholdMinor: number | null;
    resolvedCurrency: string | null;
    resolutionStatus: string;
    resolutionSource: "SHOPIFY_DELIVERY_PROFILE" | null;
    sourceProfile: string | null;
    lastResolvedAt: string | null;
    diagnostic: ShopifyFreeShippingAudit;
  };
};

export type LoopDeskPublicRuntimeConfig = Pick<
  LoopDeskMerchantSettings,
  "general" | "branding" | "labels" | "cart" | "checkout" | "otpModalBranding"
> & {
  enabled: boolean;
  cartOwnershipMode: DrawerMode;
  cartIntelligence?: CartIntelligencePublicRuntimeConfig;
  promotions?: { rules: unknown[] };
  delhivery?: DelhiveryPublicRuntimeConfig;
  razorpay?: RazorpayPublicRuntimeConfig;
};

type ShopModuleConfigDelegate = {
  findUnique(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    select: { config: true; enabled?: true };
  }): Promise<{ config: unknown; enabled?: boolean } | null>;
  upsert(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    create: {
      shopId: string;
      moduleKey: string;
      enabled: boolean;
      config: LoopDeskMerchantSettings | CartIntelligenceSettings;
    };
    update: { enabled: boolean; config: LoopDeskMerchantSettings | CartIntelligenceSettings };
  }): Promise<{ id: string; config: unknown; enabled: boolean }>;
};

type ShopDelegate = {
  findUnique(args: {
    where: { id: string };
    select: {
      shopName: true;
      shopDomain: true;
      primaryDomain: true;
      myshopifyDomain: true;
    };
  }): Promise<{
    shopName: string | null;
    shopDomain: string;
    primaryDomain: string | null;
    myshopifyDomain: string | null;
  } | null>;
};

function db() {
  return prisma as unknown as {
    shopModuleConfig: ShopModuleConfigDelegate;
    shop: ShopDelegate;
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function stripHtml(value: string) {
  return value.replace(/[<>]/g, "").replace(/javascript:/gi, "");
}
function text(value: unknown, fallback: string, max = 120) {
  const next =
    typeof value === "string" ? stripHtml(value.trim()).slice(0, max) : "";
  return next || fallback;
}
function nullableText(value: unknown, max = 500) {
  const next =
    typeof value === "string" ? stripHtml(value.trim()).slice(0, max) : "";
  return next || null;
}
function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
function numberValue(value: unknown, fallback: number, min = 0, max = 10000000) {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : fallback;
}
const COLOR_RE =
  /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)|hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\))$/i;
const RADIUS_RE = /^(?:0|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|rem|em|%))$/i;
function color(value: unknown, fallback: string) {
  const next = typeof value === "string" ? value.trim() : "";
  return COLOR_RE.test(next) ? next : fallback;
}
function radius(value: unknown, fallback: string) {
  const next = typeof value === "string" ? value.trim() : "";
  return RADIUS_RE.test(next) ? next : fallback;
}
function url(value: unknown) {
  const next = nullableText(value, 800);
  if (!next) return null;
  if (
    /^data:image\/(png|gif|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(
      next,
    )
  )
    return next;
  try {
    const parsed = new URL(next);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? next
      : null;
  } catch {
    return null;
  }
}
function httpsUrl(value: unknown) {
  const next = nullableText(value, 800);
  if (!next) return null;
  try {
    const parsed = new URL(next);
    return parsed.protocol === "https:" ? next : null;
  } catch {
    return null;
  }
}
function email(value: unknown) {
  const next = text(value, "", 254);
  return !next || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(next) ? next : "";
}
function drawerMode(value: unknown, fallback: DrawerMode): DrawerMode {
  return value === "theme" || value === "loopdesk" || value === "auto"
    ? value
    : fallback;
}
function status(
  value: unknown,
  fallback: IntegrationStatus,
): IntegrationStatus {
  return value === "configured" ||
    value === "disabled" ||
    value === "not_configured"
    ? value
    : fallback;
}
function freeShippingSourceMode(value: unknown): FreeShippingSourceMode {
  return value === "SHOPIFY_WITH_FALLBACK" || value === "MANUAL_DISPLAY_ONLY" ? value : "SHOPIFY_ONLY";
}
const TRUST_BADGE_ICONS = ["secure-payment", "delivery", "exchange", "cod", "support", "authenticity", "custom"] as const;
const DEFAULT_TRUST_BADGES: TrustBadgeItem[] = [
  { id: "secure-payments", enabled: false, icon: "secure-payment", label: "Secure payments", sortOrder: 0 },
  { id: "fast-dispatch", enabled: false, icon: "delivery", label: "Fast dispatch", sortOrder: 1 },
  { id: "cash-on-delivery", enabled: false, icon: "cod", label: "Cash on delivery", sortOrder: 2 },
  { id: "easy-exchange", enabled: false, icon: "exchange", label: "Easy exchange", sortOrder: 3 },
  { id: "customer-support", enabled: false, icon: "support", label: "Customer support", sortOrder: 4 },
  { id: "authentic-products", enabled: false, icon: "authenticity", label: "Authentic products", sortOrder: 5 },
];
function normalizeTrustBadges(value: unknown, legacyEnabled = false): TrustBadgeConfig {
  const raw = isRecord(value) ? value : {};
  const inputItems = Array.isArray(raw.items) ? raw.items.slice(0, 6) : DEFAULT_TRUST_BADGES;
  const items = inputItems.map((value, index) => {
    const item = isRecord(value) ? value : {};
    const icon = TRUST_BADGE_ICONS.includes(item.icon as TrustBadgeIcon) ? item.icon as TrustBadgeIcon : "custom";
    return { id: text(item.id, `badge-${index + 1}`, 64), enabled: bool(item.enabled, false), icon, label: text(item.label, "", 60), sortOrder: Math.round(numberValue(item.sortOrder, index, 0, 999)) };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    enabled: bool(raw.enabled, legacyEnabled),
    placement: raw.placement === "BELOW_CHECKOUT_BUTTON" ? "BELOW_CHECKOUT_BUTTON" : "BELOW_TOTALS",
    layout: raw.layout === "ROW" ? "ROW" : "GRID",
    items,
  };
}
function section(raw: Record<string, unknown>, name: string) {
  return isRecord(raw[name]) ? raw[name] : raw;
}


export function normalizeCartIntelligenceSettings(input: unknown): CartIntelligenceSettings {
  const raw = isRecord(input) ? input : {};
  const defaultModules = cartDrawerModuleDefaults({
    cartGoalProgressEnabled: bool(raw.freeShippingProgressEnabled, false),
    trustBadgesEnabled: bool(raw.trustBadgesEnabled, isRecord(raw.trustBadges) ? bool(raw.trustBadges.enabled, false) : false),
  });
  return {
    enabled: bool(raw.enabled, false),
    freeShippingProgressEnabled: bool(raw.freeShippingProgressEnabled, false),
    freeShippingThreshold: numberValue(raw.freeShippingThreshold, 0),
    freeShippingSourceMode: freeShippingSourceMode(raw.freeShippingSourceMode),
    progressBarText: text(raw.progressBarText, "You're {amount} away from free shipping", 160),
    trustBadgesEnabled: bool(raw.trustBadgesEnabled, isRecord(raw.trustBadges) ? bool(raw.trustBadges.enabled, false) : false),
    trustBadges: normalizeTrustBadges(raw.trustBadges, bool(raw.trustBadgesEnabled, false)),
    dynamicBannerEnabled: bool(raw.dynamicBannerEnabled, false),
    dynamicBannerText: text(raw.dynamicBannerText, "Limited-time cart offers may appear here.", 160),
    upsellsEnabled: bool(raw.upsellsEnabled, false),
    bundlesEnabled: bool(raw.bundlesEnabled, false),
    aiRecommendationsEnabled: bool(raw.aiRecommendationsEnabled, false),
    cartDrawerModules: raw.cartDrawerModules === undefined ? defaultModules : normalizeCartDrawerModules(raw.cartDrawerModules),
  };
}

export function validateCartIntelligenceSettingsPatch(patch: unknown): string[] {
  const errors: string[] = [];
  const raw = isRecord(patch) ? patch : {};
  const validateBool = (value: unknown, label: string) => {
    if (value !== undefined && typeof value !== "boolean") errors.push(`${label} must be true or false.`);
  };
  const validateText = (value: unknown, label: string, max: number) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string") errors.push(`${label} must be text.`);
    else if (value.trim().length > max) errors.push(`${label} must be ${max} characters or fewer.`);
  };
  [
    ["enabled", "Cart Intelligence Enabled"],
    ["freeShippingProgressEnabled", "Free Shipping Progress Enabled"],
    ["trustBadgesEnabled", "Trust Badges Enabled"],
    ["dynamicBannerEnabled", "Dynamic Banner Enabled"],
    ["upsellsEnabled", "Upsells Enabled"],
    ["bundlesEnabled", "Bundles Enabled"],
    ["aiRecommendationsEnabled", "AI Recommendations Enabled"],
  ].forEach(([key, label]) => validateBool(raw[key], label));
  if (raw.freeShippingThreshold !== undefined && !Number.isFinite(Number(raw.freeShippingThreshold))) {
    errors.push("Fallback Free Shipping Display Threshold must be a number.");
  }
  if (raw.freeShippingSourceMode !== undefined && !["SHOPIFY_ONLY", "SHOPIFY_WITH_FALLBACK", "MANUAL_DISPLAY_ONLY"].includes(String(raw.freeShippingSourceMode))) errors.push("Free Shipping Source is invalid.");
  validateText(raw.progressBarText, "Progress Bar Text", 160);
  validateText(raw.dynamicBannerText, "Dynamic Banner Text", 160);
  if (raw.trustBadges !== undefined) {
    if (!isRecord(raw.trustBadges)) errors.push("Trust Badges must be an object.");
    else {
      validateBool(raw.trustBadges.enabled, "Trust Badges Enabled");
      if (raw.trustBadges.placement !== undefined && !["BELOW_TOTALS", "BELOW_CHECKOUT_BUTTON"].includes(String(raw.trustBadges.placement))) errors.push("Trust Badges placement is invalid.");
      if (raw.trustBadges.layout !== undefined && !["ROW", "GRID"].includes(String(raw.trustBadges.layout))) errors.push("Trust Badges layout is invalid.");
      if (!Array.isArray(raw.trustBadges.items) || raw.trustBadges.items.length > 6) errors.push("Trust Badges must contain no more than six items.");
      else raw.trustBadges.items.forEach((value, index) => {
        if (!isRecord(value)) { errors.push(`Trust Badge ${index + 1} is invalid.`); return; }
        validateBool(value.enabled, `Trust Badge ${index + 1} Enabled`);
        if (!TRUST_BADGE_ICONS.includes(value.icon as TrustBadgeIcon)) errors.push(`Trust Badge ${index + 1} icon is invalid.`);
        validateText(value.label, `Trust Badge ${index + 1} label`, 60);
        if (!Number.isFinite(Number(value.sortOrder))) errors.push(`Trust Badge ${index + 1} order must be a number.`);
      });
    }
  }
  return errors;
}

export function toCartIntelligencePublicRuntimeConfig(settings: CartIntelligenceSettings, audit?: ShopifyFreeShippingAudit): CartIntelligencePublicRuntimeConfig {
  const resolution = audit || { status: "UNSUPPORTED" as const, thresholdMinor: null, currency: null, profileId: null, profileName: null, profileCount: 0, applicableProfileCount: 0, reason: "Shopify resolution data unavailable", resolvedAt: null };
  return { enabled: settings.enabled, cartDrawerModules: normalizeCartDrawerModules(settings.cartDrawerModules), trustBadges: normalizeTrustBadges(settings.trustBadges, settings.trustBadgesEnabled), freeShippingProgress: { enabled: settings.freeShippingProgressEnabled, sourceMode: settings.freeShippingSourceMode, fallbackThresholdMinor: settings.freeShippingThreshold > 0 ? Math.round(settings.freeShippingThreshold * 100) : null, progressBarText: settings.progressBarText, resolvedShopifyThresholdMinor: resolution.status === "AVAILABLE" ? resolution.thresholdMinor : null, resolvedCurrency: resolution.currency, resolutionStatus: resolution.status, resolutionSource: resolution.status === "AVAILABLE" ? "SHOPIFY_DELIVERY_PROFILE" : null, sourceProfile: resolution.profileName, lastResolvedAt: resolution.resolvedAt, diagnostic: resolution } };
}

export function validateLoopDeskMerchantSettingsPatch(
  patch: unknown,
): string[] {
  const errors: string[] = [];
  const raw = isRecord(patch) ? patch : {};
  const validateText = (value: unknown, label: string, max: number) => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string") errors.push(`${label} must be text.`);
    else if (value.trim().length > max)
      errors.push(`${label} must be ${max} characters or fewer.`);
  };
  const validateBool = (value: unknown, label: string) => {
    if (value !== undefined && typeof value !== "boolean")
      errors.push(`${label} must be true or false.`);
  };
  const validateColor = (value: unknown, label: string) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value !== "string" || !COLOR_RE.test(value.trim()))
      errors.push(`${label} must be a valid hex, rgb/rgba, or hsl/hsla color.`);
  };
  const validateUrl = (value: unknown, label: string, options: { httpsOnly?: boolean } = {}) => {
    if (value === undefined || value === null || value === "") return;
    if (typeof value !== "string") {
      errors.push(`${label} must be a URL.`);
      return;
    }
    const next = value.trim();
    if (next.length > 800) {
      errors.push(`${label} must be 800 characters or fewer.`);
      return;
    }
    if (
      /^data:image\/(png|gif|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(
        next,
      )
    )
      return;
    try {
      const parsed = new URL(next);
      if (options.httpsOnly && parsed.protocol !== "https:")
        errors.push(`${label} must use https.`);
      else if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        errors.push(`${label} must use http or https.`);
    } catch {
      errors.push(`${label} must be a valid URL.`);
    }
  };
  const general = isRecord(raw.general) ? raw.general : {};
  const branding = isRecord(raw.branding) ? raw.branding : {};
  const labels = isRecord(raw.labels) ? raw.labels : {};
  const cart = isRecord(raw.cart) ? raw.cart : {};
  const checkout = isRecord(raw.checkout) ? raw.checkout : {};
  const otpModalBranding = isRecord(raw.otpModalBranding) ? raw.otpModalBranding : {};
  validateText(general.merchantName, "Merchant name", 120);
  validateText(general.supportEmail, "Support email", 254);
  if (
    typeof general.supportEmail === "string" &&
    general.supportEmail.trim() &&
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(general.supportEmail.trim())
  )
    errors.push("Support email must be a valid email address.");
  validateText(general.supportPhone, "Support phone", 40);
  validateText(general.supportWhatsApp, "Support WhatsApp", 40);
  validateUrl(branding.logoUrl, "Logo URL");
  validateColor(branding.primaryColor, "Primary color");
  validateColor(branding.secondaryColor, "Secondary color");
  validateColor(branding.accentColor, "Accent color");
  validateText(branding.borderRadius, "Border radius", 24);
  if (
    branding.borderRadius !== undefined &&
    typeof branding.borderRadius === "string" &&
    !RADIUS_RE.test(branding.borderRadius.trim())
  )
    errors.push("Border radius must be 0 or a px, rem, em, or percent value.");
  validateBool(branding.showPoweredBy, "Show Powered by");
  validateText(branding.poweredByText, "Powered by text", 80);
  validateText(labels.expressCheckoutText, "Express checkout text", 80);
  validateText(labels.viewCartText, "View cart text", 80);
  validateText(labels.secureCheckoutText, "Secure checkout text", 80);
  if (
    cart.drawerMode !== undefined &&
    cart.drawerMode !== "theme" &&
    cart.drawerMode !== "loopdesk" &&
    cart.drawerMode !== "auto"
  )
    errors.push("Drawer mode must be auto, loopdesk, or theme.");
  validateBool(cart.openAfterAddToCart, "Open after add to cart");
  validateBool(
    cart.expressCheckoutButtonEnabled,
    "Express checkout button enabled",
  );
  validateBool(cart.viewCartButtonEnabled, "View cart button enabled");
  validateBool(checkout.showSecureBadge, "Show secure badge");
  validateBool(checkout.showTrustCopy, "Show trust copy");
  validateUrl(otpModalBranding.logoUrl, "OTP modal logo URL", { httpsOnly: true });
  validateText(otpModalBranding.logoAlt, "OTP modal logo alt text", 120);
  validateText(otpModalBranding.fallbackBrandText, "OTP modal fallback brand text", 120);
  validateText(otpModalBranding.heading, "OTP modal heading", 120);
  validateText(otpModalBranding.description, "OTP modal description", 240);
  validateBool(otpModalBranding.promotionEnabled, "Show promotional banner");
  validateText(otpModalBranding.promotionBadgeText, "Promotional badge text", 60);
  validateText(otpModalBranding.promotionMessage, "Promotional message", 160);
  validateBool(otpModalBranding.showTrustItems, "Show trust items");
  validateText(otpModalBranding.trustItem1, "Trust item 1", 80);
  validateText(otpModalBranding.trustItem2, "Trust item 2", 80);
  validateText(otpModalBranding.trustItem3, "Trust item 3", 80);
  validateText(otpModalBranding.privacyText, "Privacy/helper text", 160);
  validateText(otpModalBranding.inputHelperText, "OTP input helper text", 180);
  return errors;
}

export function normalizeLoopDeskMerchantSettings(
  input: unknown,
  shopDefaults?: { shopName?: string | null; shopDomain?: string | null },
): LoopDeskMerchantSettings {
  const raw = isRecord(input) ? input : {};
  const general = section(raw, "general");
  const branding = section(raw, "branding");
  const labels = section(raw, "labels");
  const cart = section(raw, "cart");
  const checkout = section(raw, "checkout");
  const otpModalBranding = section(raw, "otpModalBranding");
  const integrations = isRecord(raw.integrations) ? raw.integrations : {};
  const razorpay = isRecord(integrations.razorpay) ? integrations.razorpay : {};
  const delhivery = isRecord(integrations.delhivery)
    ? integrations.delhivery
    : {};
  const analytics = isRecord(raw.analytics) ? raw.analytics : {};
  const storeName = text(
    general.storeName ?? branding.storeName,
    shopDefaults?.shopName || shopDefaults?.shopDomain || "LoopDesk",
  );
  const merchantName = text(
    general.merchantName ?? branding.merchantName,
    storeName,
  );
  return {
    general: {
      merchantName,
      storeName,
      supportEmail: email(general.supportEmail),
      supportPhone: text(general.supportPhone, "", 40),
      supportWhatsApp: text(general.supportWhatsApp, "", 40),
    },
    branding: {
      merchantName,
      storeName,
      logoUrl: url(branding.logoUrl),
      primaryColor: color(branding.primaryColor, "#111827"),
      secondaryColor: color(branding.secondaryColor, "#374151"),
      accentColor: color(branding.accentColor, "#2563eb"),
      textColor: color(branding.textColor, "#111827"),
      surfaceColor: color(branding.surfaceColor, "#ffffff"),
      borderRadius: radius(branding.borderRadius, "16px"),
      fontFamily: text(branding.fontFamily, "inherit", 80),
      showPoweredBy: bool(branding.showPoweredBy, true),
      poweredByText: text(branding.poweredByText, "Powered by LoopDesk", 80),
    },
    labels: {
      expressCheckoutText: text(
        labels.expressCheckoutText ??
          labels.buttonText ??
          labels.checkoutButtonText,
        "Express Checkout",
        80,
      ),
      viewCartText: text(labels.viewCartText, "View Cart", 80),
      continueShoppingText: text(
        labels.continueShoppingText,
        "Continue Shopping",
        80,
      ),
      loadingText: text(labels.loadingText, "Loading...", 80),
      secureCheckoutText: text(
        labels.secureCheckoutText,
        "Secure checkout",
        80,
      ),
      otpContinueText: text(labels.otpContinueText, "Continue", 80),
    },
    cart: {
      drawerMode: drawerMode(cart.drawerMode ?? cart.cartDrawerMode, "auto"),
      openAfterAddToCart: bool(cart.openAfterAddToCart, false),
      expressCheckoutButtonEnabled: bool(
        cart.expressCheckoutButtonEnabled,
        true,
      ),
      viewCartButtonEnabled: bool(cart.viewCartButtonEnabled, true),
      nativeDrawerDisabledRequiredMessage: text(
        cart.nativeDrawerDisabledRequiredMessage,
        "To use LoopDesk Enhanced Drawer, set your theme cart type to Page in Shopify theme settings.",
        220,
      ),
    },
    checkout: {
      showSecureBadge: bool(checkout.showSecureBadge, true),
      showTrustCopy: bool(checkout.showTrustCopy, true),
    },
    otpModalBranding: {
      logoUrl: httpsUrl(otpModalBranding.logoUrl),
      logoAlt: text(otpModalBranding.logoAlt, merchantName || storeName, 120),
      fallbackBrandText: text(otpModalBranding.fallbackBrandText, storeName || "Secure Login", 120),
      heading: text(otpModalBranding.heading, "Login or Signup", 120),
      description: text(otpModalBranding.description, "Sign in securely to continue", 240),
      promotionEnabled: bool(otpModalBranding.promotionEnabled, false),
      promotionBadgeText: text(otpModalBranding.promotionBadgeText, "", 60),
      promotionMessage: text(otpModalBranding.promotionMessage, "", 160),
      showTrustItems: bool(otpModalBranding.showTrustItems, true),
      trustItems: [
        text(otpModalBranding.trustItem1, "Secure login", 80),
        text(otpModalBranding.trustItem2, "Faster checkout", 80),
        text(otpModalBranding.trustItem3, "", 80),
      ],
      inputHelperText: text(otpModalBranding.inputHelperText, "Enter 10 digits to receive an OTP automatically.", 180),
      privacyText: text(otpModalBranding.privacyText, "We never share your number.", 160),
    },
    integrations: {
      razorpay: {
        status: status(razorpay.status, "not_configured"),
        displayName: text(razorpay.displayName, "Razorpay", 80),
      },
      delhivery: {
        status: status(delhivery.status, "not_configured"),
        displayName: text(delhivery.displayName, "Delhivery", 80),
      },
    },
    analytics: {
      enabled: bool(analytics.enabled, false),
      anonymizeCustomerData: bool(analytics.anonymizeCustomerData, true),
    },
  };
}

export function mergeLoopDeskMerchantSettings(
  current: LoopDeskMerchantSettings,
  patch: unknown,
) {
  const raw = isRecord(patch) ? patch : {};
  return normalizeLoopDeskMerchantSettings({
    ...current,
    ...raw,
    general: {
      ...current.general,
      ...(isRecord(raw.general) ? raw.general : {}),
    },
    branding: {
      ...current.branding,
      ...(isRecord(raw.branding) ? raw.branding : {}),
    },
    labels: { ...current.labels, ...(isRecord(raw.labels) ? raw.labels : {}) },
    cart: { ...current.cart, ...(isRecord(raw.cart) ? raw.cart : {}) },
    checkout: {
      ...current.checkout,
      ...(isRecord(raw.checkout) ? raw.checkout : {}),
    },
    otpModalBranding: {
      ...current.otpModalBranding,
      ...(isRecord(raw.otpModalBranding) ? raw.otpModalBranding : {}),
    },
    integrations: current.integrations,
    analytics: current.analytics,
  });
}

export function toLoopDeskPublicRuntimeConfig(
  settings: LoopDeskMerchantSettings,
): LoopDeskPublicRuntimeConfig {
  return {
    general: settings.general,
    branding: settings.branding,
    labels: settings.labels,
    cart: settings.cart,
    checkout: settings.checkout,
    otpModalBranding: settings.otpModalBranding,
    enabled: settings.cart.drawerMode !== "theme",
    cartOwnershipMode: settings.cart.drawerMode,
  };
}

type RuntimePromotionDeps = {
  database?: RuntimePromotionDatabase;
  graphql?: <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
  now?: Date;
};
type RuntimePromotionRow = { id: string; priority: number; status: string; currentCompilation: { id: string; version: number; status: string; storefrontPayload: unknown } | null };
type RuntimePromotionDatabase = {
  shop: { findUnique(args: unknown): Promise<{ shopDomain?: string | null; myshopifyDomain?: string | null; primaryDomain?: string | null } | null> };
  promotionRule: { findMany(args: unknown): Promise<RuntimePromotionRow[]> };
};
type RuntimePromotionCandidate = { row: RuntimePromotionRow; payload: Record<string, unknown> };
type RuntimeOfferProduct = { productGid: string; handle: string; title: string | null; imageUrl: string | null };

const PROMOTION_OFFER_PRODUCTS_QUERY = `
  query LoopDeskPromotionOfferProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        title
        featuredImage {
          url
        }
      }
    }
  }
`;

function offerProductGid(payload: unknown) {
  return isRecord(payload) && isRecord(payload.offer) && typeof payload.offer.productGid === "string" ? payload.offer.productGid.trim() : "";
}
function scheduled(payload: Record<string, unknown>, now: Date) {
  const schedule = isRecord(payload.schedule) ? payload.schedule : {};
  const startsAt = typeof schedule.startsAt === "string" && schedule.startsAt ? Date.parse(schedule.startsAt) : null;
  const endsAt = typeof schedule.endsAt === "string" && schedule.endsAt ? Date.parse(schedule.endsAt) : null;
  return (startsAt === null || startsAt <= now.getTime()) && (endsAt === null || endsAt > now.getTime());
}
function imageUrl(node: Record<string, unknown>) {
  return isRecord(node.featuredImage) && typeof node.featuredImage.url === "string" && node.featuredImage.url.trim() ? node.featuredImage.url.trim() : null;
}
async function resolveRuntimeOfferProducts(shopDomain: string | null | undefined, productGids: string[], deps: RuntimePromotionDeps): Promise<Map<string, RuntimeOfferProduct>> {
  const ids = [...new Set(productGids.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const graphql = deps.graphql ?? shopifyAdminGraphql;
  try {
    const data = await graphql<{ nodes?: Array<Record<string, unknown> | null> }>(PROMOTION_OFFER_PRODUCTS_QUERY, { ids }, { shopDomain });
    const products = new Map<string, RuntimeOfferProduct>();
    for (const node of data.nodes ?? []) {
      if (!isRecord(node) || typeof node.id !== "string") continue;
      const handle = typeof node.handle === "string" ? node.handle.trim() : "";
      if (!handle) continue;
      products.set(node.id, { productGid: node.id, handle, title: typeof node.title === "string" && node.title.trim() ? node.title.trim() : null, imageUrl: imageUrl(node) });
    }
    return products;
  } catch (error) {
    console.warn("[LoopDesk Promotions] offer product enrichment failed; excluding runtime promotion offers", {
      shopDomain,
      productCount: ids.length,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return new Map();
  }
}

export async function getCompiledPromotionRuntime(shopId: string, deps: RuntimePromotionDeps = {}) {
  const database = deps.database ?? (prisma as unknown as RuntimePromotionDatabase);
  const now = deps.now ?? new Date();
  const [shop, rows] = await Promise.all([
    database.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true, myshopifyDomain: true, primaryDomain: true } }),
    database.promotionRule.findMany({
      where: { shopId, status: "ACTIVE", currentCompilation: { is: { status: "READY" } } },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      select: { id: true, priority: true, status: true, currentCompilation: { select: { id: true, version: true, status: true, storefrontPayload: true } } },
    }),
  ]);
  const candidates = rows.reduce<RuntimePromotionCandidate[]>((next, row) => {
    const payload = row.currentCompilation?.storefrontPayload;
    if (isRecord(payload) && (payload.status || row.status) === "ACTIVE" && scheduled(payload, now)) next.push({ row, payload });
    return next;
  }, []);
  const offers = await resolveRuntimeOfferProducts(shop?.shopDomain || shop?.myshopifyDomain || shop?.primaryDomain || null, candidates.map(({ payload }) => offerProductGid(payload)), deps);

  return {
    rules: candidates
      .map(({ row, payload }) => {
        const product = offers.get(offerProductGid(payload));
        if (!product) return null;
        return { ...payload, ruleId: payload.ruleId || row.id, priority: payload.priority ?? row.priority, status: payload.status || row.status, offer: { ...(isRecord(payload.offer) ? payload.offer : {}), productGid: product.productGid, handle: product.handle, title: product.title, imageUrl: product.imageUrl }, compilation: { id: row.currentCompilation!.id, version: row.currentCompilation!.version, status: row.currentCompilation!.status } };
      })
      .filter(Boolean),
  };
}

async function shopDefaults(shopId: string) {
  const shop = await db().shop.findUnique({
    where: { id: shopId },
    select: {
      shopName: true,
      shopDomain: true,
      primaryDomain: true,
      myshopifyDomain: true,
    },
  });
  return {
    shopName: shop?.shopName || shop?.primaryDomain || null,
    shopDomain: shop?.shopDomain || shop?.myshopifyDomain || null,
  };
}
export async function getLoopDeskMerchantSettings(shopId: string) {
  const [defaults, stored] = await Promise.all([
    shopDefaults(shopId),
    db().shopModuleConfig.findUnique({
      where: {
        shopId_moduleKey: {
          shopId,
          moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
        },
      },
      select: { config: true, enabled: true },
    }),
  ]);
  return normalizeLoopDeskMerchantSettings(stored?.config, defaults);
}
export async function updateLoopDeskMerchantSettings(
  shopId: string,
  patch: unknown,
) {
  const errors = validateLoopDeskMerchantSettingsPatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  const current = await getLoopDeskMerchantSettings(shopId);
  const next = mergeLoopDeskMerchantSettings(current, patch);
  const persisted = await db().shopModuleConfig.upsert({
    where: {
      shopId_moduleKey: {
        shopId,
        moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
      },
    },
    create: {
      shopId,
      moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
      enabled: true,
      config: next,
    },
    update: { enabled: true, config: next },
  });
  console.info("[LoopDesk Merchant Settings] runtime config saved", {
    shopId,
    moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
    configId: persisted.id,
  });
  return next;
}
export async function getCartIntelligenceSettings(shopId: string) {
  const stored = await db().shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId, moduleKey: CART_INTELLIGENCE_CONFIG_MODULE_KEY } },
    select: { config: true, enabled: true },
  });
  const settings = normalizeCartIntelligenceSettings(stored?.config);
  return { ...settings, enabled: Boolean(stored?.enabled && settings.enabled) };
}

export async function getCartIntelligenceAdminResolution(shopId: string) {
  const shop = await db().shop.findUnique({ where: { id: shopId }, select: { shopName: true, shopDomain: true, primaryDomain: true, myshopifyDomain: true } });
  return shop?.shopDomain ? readShopifyFreeShipping({ shopDomain: shop.shopDomain }) : readShopifyFreeShipping({ shopDomain: "" });
}

export async function updateCartIntelligenceSettings(shopId: string, patch: unknown) {
  const errors = validateCartIntelligenceSettingsPatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  const next = normalizeCartIntelligenceSettings(patch);
  const persisted = await db().shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId, moduleKey: CART_INTELLIGENCE_CONFIG_MODULE_KEY } },
    create: { shopId, moduleKey: CART_INTELLIGENCE_CONFIG_MODULE_KEY, enabled: next.enabled, config: next },
    update: { enabled: next.enabled, config: next },
  });
  console.info("[Cart Intelligence Settings] config saved", { shopId, moduleKey: CART_INTELLIGENCE_CONFIG_MODULE_KEY, configId: persisted.id });
  return next;
}

export async function getLoopDeskRuntimeConfig(shopId: string) {
  const [settings, cartIntelligence, promotions, delhivery, razorpay, shop] = await Promise.all([
    getLoopDeskMerchantSettings(shopId),
    getCartIntelligenceSettings(shopId),
    getCompiledPromotionRuntime(shopId),
    getDelhiveryRuntimeConfig(shopId),
    getRazorpayRuntimeConfig(shopId),
    db().shop.findUnique({ where: { id: shopId }, select: { shopName: true, shopDomain: true, primaryDomain: true, myshopifyDomain: true } }),
  ]);
  const audit = shop?.shopDomain ? await readShopifyFreeShipping({ shopDomain: shop.shopDomain }) : undefined;
  const cartIntelligenceRuntime = toCartIntelligencePublicRuntimeConfig(cartIntelligence, audit);
  return { ...toLoopDeskPublicRuntimeConfig(settings), cartIntelligence: cartIntelligenceRuntime, cart_intelligence_config: cartIntelligenceRuntime, promotions, delhivery, razorpay };
}
export const normalizeLoopDeskRuntimeConfig = normalizeLoopDeskMerchantSettings;
