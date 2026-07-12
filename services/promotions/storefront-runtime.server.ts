import { prisma } from "../db/prisma";
import type { ResolvedShopConfig } from "../shopify/shop";

type CompiledPayload = {
  ruleId?: string;
  status?: string;
  priority?: number;
  trigger?: { minimumQuantity?: number; minimumCartSubtotal?: string | null; sourceGroups?: Array<{ productGids?: string[] }> };
  offer?: { productGid?: string; title?: string | null; imageUrl?: string | null };
  reward?: { type?: string; value?: string; maximumQuantity?: number };
  presentation?: { heading?: string | null; badgeText?: string | null; customerMessage?: string | null; ctaText?: string | null };
  schedule?: { startsAt?: string | null; endsAt?: string | null };
};

type PromotionRuntimeDb = { promotionRule: { findMany(args: object): Promise<Array<Record<string, unknown>>> } };

type Variant = { variantId: string; title: string; available: boolean; price: string | null; compareAtPrice: string | null };

function scheduled(payload: CompiledPayload, now = new Date()) {
  const starts = payload.schedule?.startsAt ? new Date(payload.schedule.startsAt) : null;
  const ends = payload.schedule?.endsAt ? new Date(payload.schedule.endsAt) : null;
  return (!starts || starts <= now) && (!ends || ends > now);
}

function asString(value: unknown) { return typeof value === "string" ? value : null; }
function asNumber(value: unknown) { return typeof value === "number" ? value : undefined; }

function benefit(type?: string, value?: string | number | null) {
  if (type === "PERCENTAGE_OFF") return `${Number(value || 0).toString()}% offer benefit`;
  if (type === "FIXED_AMOUNT_OFF") return `Save ${value}`;
  if (type === "FIXED_PRICE") return `Special price ${value}`;
  return "Offer discount available";
}

async function storefrontProduct(shop: ResolvedShopConfig, productGid: string): Promise<{ title: string | null; image: string | null; variants: Variant[] }> {
  if (!shop.shopDomain || !shop.storefrontAccessToken) return { title: null, image: null, variants: [] };
  const response = await fetch(`https://${shop.shopDomain}/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": shop.storefrontAccessToken },
    body: JSON.stringify({ query: `query LoopDeskPromotionProduct($id: ID!) { product(id: $id) { title featuredImage { url } variants(first: 100) { nodes { id title availableForSale price { amount } compareAtPrice { amount } } } } }`, variables: { id: productGid } }),
  });
  if (!response.ok) return { title: null, image: null, variants: [] };
  const json = await response.json().catch(() => null) as { data?: { product?: { title?: string; featuredImage?: { url?: string }; variants?: { nodes?: Array<{ id: string; title?: string; availableForSale?: boolean; price?: { amount?: string }; compareAtPrice?: { amount?: string } }> } } } } | null;
  const product = json?.data?.product;
  return {
    title: product?.title || null,
    image: product?.featuredImage?.url || null,
    variants: (product?.variants?.nodes || []).map((v) => ({ variantId: v.id, title: v.title || "Default", available: Boolean(v.availableForSale), price: v.price?.amount || null, compareAtPrice: v.compareAtPrice?.amount || null })),
  };
}

export async function getStorefrontPromotionRuntime(shop: ResolvedShopConfig) {
  if (!shop.id) return { rules: [] };
  const rows = await (prisma as unknown as PromotionRuntimeDb).promotionRule.findMany({
    where: { shopId: shop.id, status: "ACTIVE", archivedAt: null, currentCompilation: { is: { status: "READY" } } },
    include: { currentCompilation: true },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  const rules = [];
  for (const row of rows) {
    const currentCompilation = row.currentCompilation as { storefrontPayload?: unknown; version?: number } | null | undefined;
    const payload = currentCompilation?.storefrontPayload as CompiledPayload | null;
    if (!payload || !payload.ruleId || !payload.offer?.productGid || !scheduled(payload)) continue;
    const product = await storefrontProduct(shop, payload.offer.productGid);
    const productGids = [...new Set((payload.trigger?.sourceGroups || []).flatMap((g) => g.productGids || []))];
    if (!productGids.length || !product.variants.length) continue;
    rules.push({
      ruleId: payload.ruleId,
      compilationVersion: currentCompilation!.version,
      priority: payload.priority ?? asNumber(row.priority) ?? 0,
      status: payload.status,
      trigger: { minimumQuantity: payload.trigger?.minimumQuantity ?? 1, minimumCartSubtotal: payload.trigger?.minimumCartSubtotal ?? null, productGids },
      offer: { productGid: payload.offer.productGid, title: product.title || payload.offer.title || asString(row.offerProductTitle) || "Offer product", image: product.image || payload.offer.imageUrl || asString(row.offerProductImageUrl) || null, variants: product.variants },
      reward: { type: payload.reward?.type || asString(row.rewardType) || "PERCENTAGE_OFF", value: payload.reward?.value || String(row.rewardValue || ""), maximumQuantity: payload.reward?.maximumQuantity ?? asNumber(row.maximumRewardQuantity) ?? 1 },
      presentation: { heading: payload.presentation?.heading || asString(row.heading) || "Special offer unlocked", badge: payload.presentation?.badgeText || asString(row.badgeText) || "Offer", ctaLabel: payload.presentation?.ctaText || asString(row.ctaText) || "Add Offer", benefitText: payload.presentation?.customerMessage || asString(row.customerMessage) || benefit(payload.reward?.type || asString(row.rewardType) || undefined, payload.reward?.value || String(row.rewardValue || "")) },
    });
  }
  return { rules };
}
