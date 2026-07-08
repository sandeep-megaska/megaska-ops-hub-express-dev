import type { PromotionRule, PromotionRulesConfig } from "./config";

export type PromotionRuntimeCartItem = {
  id?: string | number;
  product_id?: string | number;
  product_gid?: string;
  productGid?: string;
  variant_id?: string | number;
  variant_gid?: string;
  variantGid?: string;
  product_type?: string;
  productType?: string;
  type?: string;
  collections?: Array<string | number> | string;
  collection_ids?: Array<string | number> | string;
  collectionGids?: Array<string | number> | string;
  tags?: string[] | string;
  product_tags?: string[] | string;
  productTags?: string[] | string;
};

export type PromotionRuntimeCart = { total_price?: number; item_count?: number; items?: PromotionRuntimeCartItem[] };
export type PromotionRuntimePlacement = "drawer" | "cart_page" | "checkout";
export type PromotionRuntimeResult = { eligibleRules: PromotionRule[]; skippedMetadataTriggers: string[] };

function idTail(value: unknown) { return String(value || "").split("/").pop() || ""; }
function sameShopifyId(left: unknown, right: unknown) { return Boolean(left && right && (String(left) === String(right) || idTail(left) === idTail(right))); }
function list(value: unknown) { return Array.isArray(value) ? value.map(String) : typeof value === "string" && value.trim() ? value.split(",").map((part) => part.trim()) : null; }
function cartItems(cart: PromotionRuntimeCart) { return Array.isArray(cart.items) ? cart.items : []; }
function containsProduct(cart: PromotionRuntimeCart, productGid: unknown) { return cartItems(cart).some((item) => sameShopifyId(item.product_id, productGid) || sameShopifyId(item.product_gid, productGid) || sameShopifyId(item.productGid, productGid)); }
function containsVariant(cart: PromotionRuntimeCart, variantGid: unknown) { return cartItems(cart).some((item) => sameShopifyId(item.variant_id, variantGid) || sameShopifyId(item.variant_gid, variantGid) || sameShopifyId(item.variantGid, variantGid) || sameShopifyId(item.id, variantGid)); }

function metadataMatch(cart: PromotionRuntimeCart, names: Array<keyof PromotionRuntimeCartItem>, expected: unknown) {
  let available = false;
  const matched = cartItems(cart).some((item) => {
    const values = names.map((name) => list(item[name])).find(Boolean);
    if (!values) return false;
    available = true;
    return values.some((value) => sameShopifyId(value, expected) || value.toLowerCase() === String(expected || "").toLowerCase());
  });
  return { matched, available };
}

function productTypeMatch(cart: PromotionRuntimeCart, expected: unknown) {
  let available = false;
  const matched = cartItems(cart).some((item) => {
    const value = item.product_type || item.productType || item.type;
    if (!value) return false;
    available = true;
    return String(value).toLowerCase() === String(expected || "").toLowerCase();
  });
  return { matched, available };
}

function scheduled(rule: PromotionRule, now: Date) {
  if (rule.schedule.alwaysActive !== false) return true;
  const time = now.getTime();
  const start = rule.schedule.startAt ? Date.parse(rule.schedule.startAt) : NaN;
  const end = rule.schedule.endAt ? Date.parse(rule.schedule.endAt) : NaN;
  return (!Number.isFinite(start) || time >= start) && (!Number.isFinite(end) || time <= end);
}

export function getEligiblePromotionRules(params: { cart: PromotionRuntimeCart; config: PromotionRulesConfig; placement: PromotionRuntimePlacement; now?: Date }): PromotionRuntimeResult {
  const skippedMetadataTriggers: string[] = [];
  if (!params.config.enabled) return { eligibleRules: [], skippedMetadataTriggers };
  const now = params.now || new Date();
  const eligibleRules = params.config.rules.filter((rule) => {
    const placement = rule.display.placement || "drawer";
    const triggers = rule.eligibility.triggers.length ? rule.eligibility.triggers : [{ type: "always" as const }];
    const matches = triggers.map((trigger) => {
      const value = trigger.value || trigger.productGid || trigger.variantGid || trigger.collectionGid || trigger.productType || trigger.tag || trigger.subtotalGte || trigger.quantityGte;
      if (trigger.type === "always") return true;
      if (trigger.type === "cart_contains_product") return containsProduct(params.cart, trigger.productGid || value);
      if (trigger.type === "cart_contains_variant") return containsVariant(params.cart, trigger.variantGid || value);
      if (trigger.type === "cart_contains_collection") { const result = metadataMatch(params.cart, ["collections", "collection_ids", "collectionGids"], trigger.collectionGid || value); if (!result.available) skippedMetadataTriggers.push(trigger.type); return result.matched; }
      if (trigger.type === "cart_contains_product_type") { const result = productTypeMatch(params.cart, trigger.productType || value); if (!result.available) skippedMetadataTriggers.push(trigger.type); return result.matched; }
      if (trigger.type === "cart_contains_tag") { const result = metadataMatch(params.cart, ["tags", "product_tags", "productTags"], trigger.tag || value); if (!result.available) skippedMetadataTriggers.push(trigger.type); return result.matched; }
      if (trigger.type === "cart_subtotal_gte") return Number(params.cart.total_price || 0) >= Number(trigger.subtotalGte || value || 0);
      if (trigger.type === "cart_quantity_gte") return Number(params.cart.item_count || 0) >= Number(trigger.quantityGte || value || 0);
      return false;
    });
    const matched = rule.eligibility.match === "all" ? matches.every(Boolean) : matches.some(Boolean);
    return rule.enabled && rule.status === "active" && (placement === params.placement || placement === "both") && Boolean(rule.reward.productGid && rule.reward.variantGid) && scheduled(rule, now) && !(rule.display.hideIfOfferProductAlreadyInCart && (containsProduct(params.cart, rule.reward.productGid) || containsVariant(params.cart, rule.reward.variantGid))) && matched;
  }).sort((a, b) => a.priority - b.priority).slice(0, params.config.maxVisibleOffers);
  return { eligibleRules, skippedMetadataTriggers: Array.from(new Set(skippedMetadataTriggers)) };
}
