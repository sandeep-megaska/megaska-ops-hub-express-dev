import { prisma } from "../db/prisma";

export const LOOPDESK_RUNTIME_CONFIG_MODULE_KEY = "loopdesk_runtime_config";

type DrawerMode = "theme" | "loopdesk" | "auto";
type IntegrationStatus = "not_configured" | "configured" | "disabled";

export type LoopDeskMerchantSettings = {
  general: { merchantName: string; storeName: string; supportEmail: string; supportPhone: string; supportWhatsApp: string };
  branding: { merchantName: string; storeName: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; accentColor: string; textColor: string; surfaceColor: string; borderRadius: string; fontFamily: string; showPoweredBy: boolean; poweredByText: string };
  labels: { expressCheckoutText: string; viewCartText: string; continueShoppingText: string; loadingText: string; secureCheckoutText: string; otpContinueText: string };
  cart: { drawerMode: DrawerMode; openAfterAddToCart: boolean; expressCheckoutButtonEnabled: boolean; viewCartButtonEnabled: boolean; nativeDrawerDisabledRequiredMessage: string };
  checkout: { showSecureBadge: boolean; showTrustCopy: boolean };
  integrations: { razorpay: { status: IntegrationStatus; displayName: string }; delhivery: { status: IntegrationStatus; displayName: string } };
  analytics: { enabled: boolean; anonymizeCustomerData: boolean };
};

export type LoopDeskPublicRuntimeConfig = Pick<LoopDeskMerchantSettings, "branding" | "labels" | "cart" | "checkout"> & {
  enabled: boolean;
  cartOwnershipMode: DrawerMode;
};

type ShopModuleConfigDelegate = {
  findUnique(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; select: { config: true; enabled?: true } }): Promise<{ config: unknown; enabled?: boolean } | null>;
  upsert(args: { where: { shopId_moduleKey: { shopId: string; moduleKey: string } }; create: { shopId: string; moduleKey: string; enabled: boolean; config: LoopDeskMerchantSettings }; update: { enabled: boolean; config: LoopDeskMerchantSettings } }): Promise<{ id: string; config: unknown; enabled: boolean }>;
};

type ShopDelegate = { findUnique(args: { where: { id: string }; select: { shopName: true; shopDomain: true; primaryDomain: true; myshopifyDomain: true } }): Promise<{ shopName: string | null; shopDomain: string; primaryDomain: string | null; myshopifyDomain: string | null } | null> };

function db() { return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate; shop: ShopDelegate }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function stripHtml(value: string) { return value.replace(/[<>]/g, "").replace(/javascript:/gi, ""); }
function text(value: unknown, fallback: string, max = 120) { const next = typeof value === "string" ? stripHtml(value.trim()).slice(0, max) : ""; return next || fallback; }
function nullableText(value: unknown, max = 500) { const next = typeof value === "string" ? stripHtml(value.trim()).slice(0, max) : ""; return next || null; }
function bool(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }
function color(value: unknown, fallback: string) { const next = typeof value === "string" ? value.trim() : ""; return /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)|hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\))$/i.test(next) ? next : fallback; }
function radius(value: unknown, fallback: string) { const next = typeof value === "string" ? value.trim() : ""; return /^(?:0|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|rem|em|%))$/i.test(next) ? next : fallback; }
function url(value: unknown) { const next = nullableText(value, 800); if (!next) return null; if (/^data:image\/(png|gif|jpe?g|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(next)) return next; try { const parsed = new URL(next); return parsed.protocol === "http:" || parsed.protocol === "https:" ? next : null; } catch { return null; } }
function email(value: unknown) { const next = text(value, "", 254); return !next || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(next) ? next : ""; }
function drawerMode(value: unknown, fallback: DrawerMode): DrawerMode { return value === "theme" || value === "loopdesk" || value === "auto" ? value : fallback; }
function status(value: unknown, fallback: IntegrationStatus): IntegrationStatus { return value === "configured" || value === "disabled" || value === "not_configured" ? value : fallback; }
function section(raw: Record<string, unknown>, name: string) { return isRecord(raw[name]) ? raw[name] : raw; }

export function normalizeLoopDeskMerchantSettings(input: unknown, shopDefaults?: { shopName?: string | null; shopDomain?: string | null }): LoopDeskMerchantSettings {
  const raw = isRecord(input) ? input : {};
  const general = section(raw, "general"); const branding = section(raw, "branding"); const labels = section(raw, "labels"); const cart = section(raw, "cart"); const checkout = section(raw, "checkout");
  const integrations = isRecord(raw.integrations) ? raw.integrations : {}; const razorpay = isRecord(integrations.razorpay) ? integrations.razorpay : {}; const delhivery = isRecord(integrations.delhivery) ? integrations.delhivery : {}; const analytics = isRecord(raw.analytics) ? raw.analytics : {};
  const storeName = text(general.storeName ?? branding.storeName, shopDefaults?.shopName || shopDefaults?.shopDomain || "LoopDesk");
  const merchantName = text(general.merchantName ?? branding.merchantName, storeName);
  return {
    general: { merchantName, storeName, supportEmail: email(general.supportEmail), supportPhone: text(general.supportPhone, "", 40), supportWhatsApp: text(general.supportWhatsApp, "", 40) },
    branding: { merchantName, storeName, logoUrl: url(branding.logoUrl), primaryColor: color(branding.primaryColor, "#111827"), secondaryColor: color(branding.secondaryColor, "#374151"), accentColor: color(branding.accentColor, "#2563eb"), textColor: color(branding.textColor, "#111827"), surfaceColor: color(branding.surfaceColor, "#ffffff"), borderRadius: radius(branding.borderRadius, "16px"), fontFamily: text(branding.fontFamily, "inherit", 80), showPoweredBy: bool(branding.showPoweredBy, true), poweredByText: text(branding.poweredByText, "Powered by LoopDesk", 80) },
    labels: { expressCheckoutText: text(labels.expressCheckoutText ?? labels.buttonText ?? labels.checkoutButtonText, "Express Checkout", 80), viewCartText: text(labels.viewCartText, "View Cart", 80), continueShoppingText: text(labels.continueShoppingText, "Continue Shopping", 80), loadingText: text(labels.loadingText, "Loading...", 80), secureCheckoutText: text(labels.secureCheckoutText, "Secure checkout", 80), otpContinueText: text(labels.otpContinueText, "Continue", 80) },
    cart: { drawerMode: drawerMode(cart.drawerMode ?? cart.cartDrawerMode, "auto"), openAfterAddToCart: bool(cart.openAfterAddToCart, false), expressCheckoutButtonEnabled: bool(cart.expressCheckoutButtonEnabled, true), viewCartButtonEnabled: bool(cart.viewCartButtonEnabled, true), nativeDrawerDisabledRequiredMessage: text(cart.nativeDrawerDisabledRequiredMessage, "To use LoopDesk Enhanced Drawer, set your theme cart type to Page in Shopify theme settings.", 220) },
    checkout: { showSecureBadge: bool(checkout.showSecureBadge, true), showTrustCopy: bool(checkout.showTrustCopy, true) },
    integrations: { razorpay: { status: status(razorpay.status, "not_configured"), displayName: text(razorpay.displayName, "Razorpay", 80) }, delhivery: { status: status(delhivery.status, "not_configured"), displayName: text(delhivery.displayName, "Delhivery", 80) } },
    analytics: { enabled: bool(analytics.enabled, false), anonymizeCustomerData: bool(analytics.anonymizeCustomerData, true) },
  };
}

export function mergeLoopDeskMerchantSettings(current: LoopDeskMerchantSettings, patch: unknown) {
  const raw = isRecord(patch) ? patch : {};
  return normalizeLoopDeskMerchantSettings({ ...current, ...raw, general: { ...current.general, ...(isRecord(raw.general) ? raw.general : {}) }, branding: { ...current.branding, ...(isRecord(raw.branding) ? raw.branding : {}) }, labels: { ...current.labels, ...(isRecord(raw.labels) ? raw.labels : {}) }, cart: { ...current.cart, ...(isRecord(raw.cart) ? raw.cart : {}) }, checkout: { ...current.checkout, ...(isRecord(raw.checkout) ? raw.checkout : {}) }, integrations: current.integrations, analytics: current.analytics });
}

export function toLoopDeskPublicRuntimeConfig(settings: LoopDeskMerchantSettings): LoopDeskPublicRuntimeConfig { return { branding: settings.branding, labels: settings.labels, cart: settings.cart, checkout: settings.checkout, enabled: settings.cart.drawerMode !== "theme", cartOwnershipMode: settings.cart.drawerMode }; }

async function shopDefaults(shopId: string) { const shop = await db().shop.findUnique({ where: { id: shopId }, select: { shopName: true, shopDomain: true, primaryDomain: true, myshopifyDomain: true } }); return { shopName: shop?.shopName || shop?.primaryDomain || null, shopDomain: shop?.shopDomain || shop?.myshopifyDomain || null }; }
export async function getLoopDeskMerchantSettings(shopId: string) { const [defaults, stored] = await Promise.all([shopDefaults(shopId), db().shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } }, select: { config: true, enabled: true } })]); return normalizeLoopDeskMerchantSettings(stored?.config, defaults); }
export async function updateLoopDeskMerchantSettings(shopId: string, patch: unknown) { const current = await getLoopDeskMerchantSettings(shopId); const next = mergeLoopDeskMerchantSettings(current, patch); await db().shopModuleConfig.upsert({ where: { shopId_moduleKey: { shopId, moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } }, create: { shopId, moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY, enabled: true, config: next }, update: { enabled: true, config: next } }); return next; }
export async function getLoopDeskRuntimeConfig(shopId: string) { return toLoopDeskPublicRuntimeConfig(await getLoopDeskMerchantSettings(shopId)); }
export const normalizeLoopDeskRuntimeConfig = normalizeLoopDeskMerchantSettings;
