export type PromotionEmbeddedContext = {
  shop?: string | string[];
  shopify_shop?: string | string[];
  host?: string | string[];
  embedded?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function add(params: URLSearchParams, key: string, value: string | string[] | undefined) {
  const v = first(value);
  if (v) params.set(key, v);
}

export function buildPromotionAdminUrl(path: string, context: PromotionEmbeddedContext, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  add(params, "shop", context.shop);
  add(params, "shopify_shop", context.shopify_shop);
  add(params, "host", context.host);
  add(params, "embedded", context.embedded);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function promotionEmbeddedContext(params: PromotionEmbeddedContext, canonicalShopDomain?: string): PromotionEmbeddedContext {
  return {
    shop: canonicalShopDomain || first(params.shop),
    shopify_shop: first(params.shopify_shop),
    host: first(params.host),
    embedded: first(params.embedded),
  };
}

export function verifyPromotionActionTenant(claimedShopId: string, resolvedShopId: string) {
  return Boolean(resolvedShopId) && (!claimedShopId || claimedShopId === resolvedShopId);
}
