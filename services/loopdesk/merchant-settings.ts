import { prisma } from "../db/prisma";
import { getDelhiveryRuntimeConfig, type DelhiveryPublicRuntimeConfig } from "../delhivery/config";

export const LOOPDESK_RUNTIME_CONFIG_MODULE_KEY = "loopdesk_runtime_config";

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
  integrations: {
    razorpay: { status: IntegrationStatus; displayName: string };
    delhivery: { status: IntegrationStatus; displayName: string };
  };
  analytics: { enabled: boolean; anonymizeCustomerData: boolean };
};

export type LoopDeskPublicRuntimeConfig = Pick<
  LoopDeskMerchantSettings,
  "general" | "branding" | "labels" | "cart" | "checkout"
> & {
  enabled: boolean;
  cartOwnershipMode: DrawerMode;
  delhivery?: DelhiveryPublicRuntimeConfig;
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
      config: LoopDeskMerchantSettings;
    };
    update: { enabled: boolean; config: LoopDeskMerchantSettings };
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
function section(raw: Record<string, unknown>, name: string) {
  return isRecord(raw[name]) ? raw[name] : raw;
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
  const validateUrl = (value: unknown, label: string) => {
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
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
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
    enabled: settings.cart.drawerMode !== "theme",
    cartOwnershipMode: settings.cart.drawerMode,
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
export async function getLoopDeskRuntimeConfig(shopId: string) {
  const [settings, delhivery] = await Promise.all([
    getLoopDeskMerchantSettings(shopId),
    getDelhiveryRuntimeConfig(shopId),
  ]);
  return { ...toLoopDeskPublicRuntimeConfig(settings), delhivery };
}
export const normalizeLoopDeskRuntimeConfig = normalizeLoopDeskMerchantSettings;
