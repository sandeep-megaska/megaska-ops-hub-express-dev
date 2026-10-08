// Back-in-stock alerts on WhatsApp.
//
// A customer asks the AI assistant about a sold-out product, size or colour;
// the assistant offers to tell them when it is back and, when they agree,
// returns a restock request that is matched here to the exact Shopify product
// (and variant, when one is meant) and saved as a BackInStockRequest.
//
// The 15-minute cron then checks the waiting requests against Shopify and
// sends the back_in_stock template once, as soon as it can be bought again
// (9 am – 9 pm IST). Requests nobody could be told about within 60 days expire.

import type { MerchantWhatsAppAccountRow, WhatsAppSender } from "./sender.ts";

export const BACK_IN_STOCK_TEMPLATE = "back_in_stock";
export const BACK_IN_STOCK_TTL_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
const MAX_SENDS_PER_RUN = 60;
const MAX_PRODUCTS_PER_SHOP = 100;

export type RestockVariant = { id: string; size: string; color: string; available: boolean };
export type RestockProduct = { id?: string; title: string; url: string | null; variants?: RestockVariant[] };
export type RestockAsk = { product: string; size: string | null; color: string | null };

export type RestockTarget = {
  productId: string;
  variantId: string | null;
  key: string;
  productTitle: string;
  variantTitle: string | null;
  optionSize: string | null;
  optionColor: string | null;
  productUrl: string | null;
};

const norm = (value: string | null | undefined) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Matches what the assistant asked for to a product (and variant) it was shown.
// "in_stock" when what they want can already be bought (nothing to wait for).
export function resolveRestockTarget(ask: RestockAsk, products: RestockProduct[]): { kind: "target"; target: RestockTarget } | { kind: "in_stock" } | { kind: "unmatched" } {
  const wanted = norm(ask.product);
  if (!wanted) return { kind: "unmatched" };
  const product = products.find((entry) => norm(entry.title) === wanted)
    ?? products.find((entry) => norm(entry.title).includes(wanted) || wanted.includes(norm(entry.title)));
  if (!product?.id) return { kind: "unmatched" };
  const size = ask.size?.trim() || null;
  const color = ask.color?.trim() || null;
  const variants = product.variants ?? [];
  const matching = variants.filter((variant) => (!size || norm(variant.size) === norm(size)) && (!color || norm(variant.color) === norm(color)));
  if ((size || color) && variants.length && !matching.length) return { kind: "unmatched" };
  const pool = size || color ? matching : variants;
  if (pool.length && pool.some((variant) => variant.available)) return { kind: "in_stock" };
  const single = pool.length === 1 ? pool[0] : null;
  // Shop's own spelling ("XL", "Navy"), not the customer's.
  const shownSize = size ? (single?.size || matching[0]?.size || size) : null;
  const shownColor = color ? (single?.color || matching[0]?.color || color) : null;
  const label = [shownSize, shownColor].filter(Boolean).join(" / ");
  return {
    kind: "target",
    target: {
      productId: product.id,
      variantId: single?.id ?? null,
      key: single?.id ?? `${product.id}|${norm(size)}|${norm(color)}`,
      productTitle: product.title,
      variantTitle: label ? (shownSize && !shownColor ? `Size ${shownSize}` : label) : null,
      optionSize: single ? null : shownSize,
      optionColor: single ? null : shownColor,
      productUrl: product.url,
    },
  };
}

export function restockItemLabel(request: { productTitle: string; variantTitle: string | null }) {
  return request.variantTitle ? `${request.productTitle} (${request.variantTitle})` : request.productTitle;
}

// Product link that opens on the wanted variant, tagged for analytics.
export function restockLink(productUrl: string | null, variantId: string | null) {
  if (!productUrl) return null;
  try {
    const url = new URL(productUrl);
    const numeric = variantId?.match(/(\d+)$/)?.[1];
    if (numeric) url.searchParams.set("variant", numeric);
    url.searchParams.set("utm_source", "whatsapp");
    url.searchParams.set("utm_medium", "back_in_stock");
    return url.toString();
  } catch {
    return productUrl;
  }
}

type WaitingRequest = {
  id: string; shopId: string; phone: string; customerName: string | null; productId: string; variantId: string | null;
  optionSize: string | null; optionColor: string | null; productTitle: string; variantTitle: string | null; productUrl: string | null; createdAt: Date;
};
export type ShopifyProductStock = {
  id?: string | null; status?: string | null; onlineStoreUrl?: string | null;
  variants?: { nodes?: Array<{ id?: string | null; availableForSale?: boolean | null; selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null }> | null } | null;
};

const optionValue = (options: Array<{ name?: string | null; value?: string | null }> | null | undefined, pattern: RegExp) =>
  (options ?? []).find((option) => pattern.test(option?.name || ""))?.value || "";

export function isBackInStock(request: Pick<WaitingRequest, "variantId" | "optionSize" | "optionColor">, product: ShopifyProductStock | null | undefined) {
  if (!product || (product.status && product.status !== "ACTIVE")) return false;
  return (product.variants?.nodes ?? []).some((variant) => {
    if (!variant?.availableForSale) return false;
    if (request.variantId) return variant.id === request.variantId;
    if (request.optionSize && norm(optionValue(variant.selectedOptions, /size/i)) !== norm(request.optionSize)) return false;
    if (request.optionColor && norm(optionValue(variant.selectedOptions, /colou?r/i)) !== norm(request.optionColor)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Saving a request (from the AI assistant)

type RequestDb = {
  backInStockRequest: {
    upsert(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<WaitingRequest[]>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function saveBackInStockRequest(input: { shopId: string; phone: string; customerName: string | null; target: RestockTarget; source?: string }, db?: RequestDb) {
  const client = db ?? ((await import("../db/prisma.ts")).prisma as unknown as RequestDb);
  const phone = input.phone.replace(/\D/g, "");
  const data = {
    customerName: input.customerName,
    productId: input.target.productId,
    variantId: input.target.variantId,
    productTitle: input.target.productTitle.slice(0, 300),
    variantTitle: input.target.variantTitle?.slice(0, 120) ?? null,
    optionSize: input.target.optionSize,
    optionColor: input.target.optionColor,
    productUrl: input.target.productUrl,
    source: input.source ?? "WHATSAPP_AI",
  };
  // Asking again after an earlier alert (or expiry) starts a new wait.
  await client.backInStockRequest.upsert({
    where: { shopId_phone_key: { shopId: input.shopId, phone, key: input.target.key } },
    create: { shopId: input.shopId, phone, key: input.target.key, ...data },
    update: { ...data, status: "WAITING", notifiedAt: null, messageId: null },
  });
}

// ---------------------------------------------------------------------------
// Cron: tell waiting customers when their item is back

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type SendTemplate = (input: { sender: WhatsAppSender; shopId: string; toPhone: string; templateName: string; languageCode: string; variables: string[] }) => Promise<{ success: boolean; messageId?: string | null }>;
type CronDb = RequestDb & { shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string }>> } };

const STOCK_QUERY = `query BackInStock($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product { id status onlineStoreUrl variants(first: 100) { nodes { id availableForSale selectedOptions { name value } } } }
  }
}`;

// 9 am – 9 pm in India.
export function withinRestockHours(now: Date) {
  const minutesIst = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return minutesIst >= 9 * 60 && minutesIst < 21 * 60;
}

export type BackInStockSummary = { shops: number; waiting: number; sent: number; expired: number; skippedOptOut: number; skippedQuietHours: boolean; failed: number };

export async function runWhatsAppBackInStock(
  input: { now?: Date } = {},
  deps: {
    db?: CronDb;
    graphql?: Graphql;
    listAccounts?: () => Promise<MerchantWhatsAppAccountRow[]>;
    senderFor?: (account: MerchantWhatsAppAccountRow) => WhatsAppSender | null | Promise<WhatsAppSender | null>;
    sendTemplate?: SendTemplate;
    isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>;
  } = {},
): Promise<BackInStockSummary> {
  const now = input.now ?? new Date();
  const summary: BackInStockSummary = { shops: 0, waiting: 0, sent: 0, expired: 0, skippedOptOut: 0, skippedQuietHours: false, failed: 0 };
  if (!withinRestockHours(now)) { summary.skippedQuietHours = true; return summary; }
  const accounts = await (deps.listAccounts ?? (async () => (await import("./sender.ts")).listWhatsAppAccountsWith("backInStockEnabled")))();
  if (!accounts.length) return summary;
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as CronDb);
  const graphql = deps.graphql ?? (async (query, variables, options) => ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options));
  const resolveSender = deps.senderFor ?? (async (account: MerchantWhatsAppAccountRow) => (await import("./sender.ts")).merchantSender(account));
  const sendTemplate: SendTemplate = deps.sendTemplate ?? (async (send) => (await import("./index.ts")).sendTemplateMessage({ ...send, recoveryType: "BACK_IN_STOCK" }));
  const isOptedOut = deps.isOptedOut ?? (async (phone: string, senderId: string) => (await import("./consent.ts")).isWhatsAppOptedOut(phone, senderId));
  let budget = MAX_SENDS_PER_RUN;

  const shops = await db.shop.findMany({ where: { id: { in: accounts.map((account) => account.shopId) } }, select: { id: true, shopDomain: true } });
  for (const shop of shops) {
    const account = accounts.find((row) => row.shopId === shop.id);
    const sender = account ? await resolveSender(account) : null;
    if (!sender) { summary.failed += 1; continue; }
    summary.shops += 1;

    const expired = await db.backInStockRequest.updateMany({ where: { shopId: shop.id, status: "WAITING", createdAt: { lt: new Date(now.getTime() - BACK_IN_STOCK_TTL_DAYS * DAY) } }, data: { status: "EXPIRED" } });
    summary.expired += expired.count;
    const waiting = await db.backInStockRequest.findMany({ where: { shopId: shop.id, status: "WAITING" }, orderBy: { createdAt: "asc" }, take: 500 });
    if (!waiting.length) continue;
    summary.waiting += waiting.length;

    const productIds = [...new Set(waiting.map((request) => request.productId))].slice(0, MAX_PRODUCTS_PER_SHOP);
    let products: ShopifyProductStock[] = [];
    try {
      products = ((await graphql<{ nodes?: Array<ShopifyProductStock | null> }>(STOCK_QUERY, { ids: productIds }, { shopDomain: shop.shopDomain })).nodes ?? []).filter((node): node is ShopifyProductStock => Boolean(node?.id));
    } catch (error) {
      console.error("[BACK IN STOCK] stock_read_failed", { shopId: shop.id, error: error instanceof Error ? error.message : String(error) });
      summary.failed += 1;
      continue;
    }

    const toldThisRun = new Set<string>();
    for (const request of waiting) {
      if (budget <= 0) break;
      if (toldThisRun.has(request.phone)) continue; // one message per customer per run; the next item goes 15 minutes later
      const product = products.find((node) => node.id === request.productId);
      if (!isBackInStock(request, product)) continue;
      if (await isOptedOut(request.phone, sender.phoneNumberId)) {
        summary.skippedOptOut += 1;
        await db.backInStockRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
        continue;
      }
      const link = restockLink(product?.onlineStoreUrl || request.productUrl, request.variantId);
      if (!link) continue;
      budget -= 1;
      toldThisRun.add(request.phone);
      const firstName = (request.customerName || "").trim().split(/\s+/)[0] || "there";
      try {
        const result = await sendTemplate({ sender, shopId: shop.id, toPhone: request.phone, templateName: BACK_IN_STOCK_TEMPLATE, languageCode: sender.languageCode, variables: [firstName, restockItemLabel(request), link] });
        if (!result.success) { summary.failed += 1; continue; }
        await db.backInStockRequest.update({ where: { id: request.id }, data: { status: "NOTIFIED", notifiedAt: now, messageId: result.messageId ?? null } });
        summary.sent += 1;
      } catch (error) {
        console.error("[BACK IN STOCK] send_failed", { shopId: shop.id, requestId: request.id, error: error instanceof Error ? error.message : String(error) });
        summary.failed += 1;
      }
    }
  }
  return summary;
}
