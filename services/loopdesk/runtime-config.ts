import { prisma } from "../db/prisma";

export const LOOPDESK_RUNTIME_CONFIG_MODULE_KEY = "loopdesk_runtime_config";

export type LoopDeskRuntimeConfig = {
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
    drawerMode: "theme" | "loopdesk" | "auto";
    openAfterAddToCart: boolean;
    expressCheckoutButtonEnabled: boolean;
    viewCartButtonEnabled: boolean;
    nativeDrawerDisabledRequiredMessage: string;
  };
  checkout: {
    showSecureBadge: boolean;
    showTrustCopy: boolean;
  };
};

type ShopModuleConfigDelegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; select: { config: true } }): Promise<{ config: unknown } | null>;
};

type ShopDelegate = {
  findUnique(args: { where: { id: string }; select: { shopName: true; shopDomain: true; primaryDomain: true; myshopifyDomain: true } }): Promise<{ shopName: string | null; shopDomain: string; primaryDomain: string | null; myshopifyDomain: string | null } | null>;
};

function db() {
  return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate; shop: ShopDelegate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback: string) {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function nullableText(value: unknown) {
  const next = typeof value === "string" ? value.trim() : "";
  return next || null;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function color(value: unknown, fallback: string) {
  const next = typeof value === "string" ? value.trim() : "";
  return /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([0-9.,%\s-]+\)|hsla?\([0-9.,%\s-]+\))$/i.test(next) ? next : fallback;
}

function radius(value: unknown, fallback: string) {
  const next = typeof value === "string" ? value.trim() : "";
  return /^(?:0|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|rem|em|%))$/i.test(next) ? next : fallback;
}

function drawerMode(value: unknown, fallback: "theme" | "loopdesk" | "auto") {
  return value === "theme" || value === "loopdesk" || value === "auto" ? value : fallback;
}

export function normalizeLoopDeskRuntimeConfig(input: unknown, shopDefaults?: { shopName?: string | null; shopDomain?: string | null }): LoopDeskRuntimeConfig {
  const raw = isRecord(input) ? input : {};
  const branding = isRecord(raw.branding) ? raw.branding : raw;
  const labels = isRecord(raw.labels) ? raw.labels : raw;
  const cart = isRecord(raw.cart) ? raw.cart : raw;
  const checkout = isRecord(raw.checkout) ? raw.checkout : raw;
  const storeName = text(branding.storeName, shopDefaults?.shopName || shopDefaults?.shopDomain || "LoopDesk");
  const merchantName = text(branding.merchantName, storeName);

  return {
    branding: {
      merchantName,
      storeName,
      logoUrl: nullableText(branding.logoUrl),
      primaryColor: color(branding.primaryColor, "#111827"),
      secondaryColor: color(branding.secondaryColor, "#374151"),
      accentColor: color(branding.accentColor, "#2563eb"),
      textColor: color(branding.textColor, "#111827"),
      surfaceColor: color(branding.surfaceColor, "#ffffff"),
      borderRadius: radius(branding.borderRadius, "16px"),
      fontFamily: text(branding.fontFamily, "inherit"),
      showPoweredBy: bool(branding.showPoweredBy, true),
      poweredByText: text(branding.poweredByText, "Powered by LoopDesk"),
    },
    labels: {
      expressCheckoutText: text(labels.expressCheckoutText ?? labels.buttonText ?? labels.checkoutButtonText, "Express Checkout"),
      viewCartText: text(labels.viewCartText, "View Cart"),
      continueShoppingText: text(labels.continueShoppingText, "Continue Shopping"),
      loadingText: text(labels.loadingText, "Loading..."),
      secureCheckoutText: text(labels.secureCheckoutText, "Secure checkout"),
      otpContinueText: text(labels.otpContinueText, "Continue"),
    },
    cart: {
      drawerMode: drawerMode(cart.drawerMode ?? cart.cartDrawerMode, "auto"),
      openAfterAddToCart: bool(cart.openAfterAddToCart, false),
      expressCheckoutButtonEnabled: bool(cart.expressCheckoutButtonEnabled, true),
      viewCartButtonEnabled: bool(cart.viewCartButtonEnabled, true),
      nativeDrawerDisabledRequiredMessage: text(cart.nativeDrawerDisabledRequiredMessage, "To use LoopDesk Enhanced Drawer, set your theme cart type to Page in Shopify theme settings."),
    },
    checkout: {
      showSecureBadge: bool(checkout.showSecureBadge, true),
      showTrustCopy: bool(checkout.showTrustCopy, true),
    },
  };
}

export async function getLoopDeskRuntimeConfig(shopId: string) {
  const [shop, stored] = await Promise.all([
    db().shop.findUnique({ where: { id: shopId }, select: { shopName: true, shopDomain: true, primaryDomain: true, myshopifyDomain: true } }),
    db().shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } }, select: { config: true } }),
  ]);

  return normalizeLoopDeskRuntimeConfig(stored?.config, {
    shopName: shop?.shopName || shop?.primaryDomain || null,
    shopDomain: shop?.shopDomain || shop?.myshopifyDomain || null,
  });
}
