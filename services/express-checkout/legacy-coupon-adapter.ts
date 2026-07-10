import type { ExpressCheckoutDiscountDefinition } from "./discounts";

const MEGASKA_SHOP_IDS = new Set(
  String(process.env.MEGASKA_LEGACY_COUPON_SHOP_IDS || "")
    .split(",")
    .map((shopId) => shopId.trim())
    .filter(Boolean)
);
const MEGASKA_SHOP_DOMAINS = new Set([
  "megaska.myshopify.com",
  "www.megaska.com",
  "megaska.com",
  ...String(process.env.MEGASKA_LEGACY_COUPON_SHOP_DOMAINS || "")
    .split(",")
    .map((shopDomain) => shopDomain.trim().toLowerCase())
    .filter(Boolean),
]);

function normalizedCode(code: string | null | undefined) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function normalizedDomain(shopDomain: string | null | undefined) {
  return typeof shopDomain === "string" ? shopDomain.trim().toLowerCase() : "";
}

function isMegaskaShop(shopId: string, shopDomain?: string | null) {
  return MEGASKA_SHOP_IDS.has(shopId) || MEGASKA_SHOP_DOMAINS.has(normalizedDomain(shopDomain));
}

export function resolveLegacyExpressCheckoutCoupon(input: {
  shopId: string;
  shopDomain?: string | null;
  code: string;
}): ExpressCheckoutDiscountDefinition | null {
  // TODO(CONFIG-3A): Remove after Megaska coupon rules are migrated into persistent LoopDesk configuration.
  if (!isMegaskaShop(input.shopId, input.shopDomain) || normalizedCode(input.code) !== "MEGA15") return null;

  return {
    code: "MEGA15",
    title: "15% OFF",
    type: "PERCENTAGE",
    value: 15,
    valueUnit: "PERCENT",
    source: "LEGACY_COMPATIBILITY",
  };
}
