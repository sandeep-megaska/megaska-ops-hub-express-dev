// Shop in chat: the WhatsApp catalog → a real Shopify cart.
//
// With the store's Meta catalog connected to its WhatsApp number (and "Shop in
// chat" on), customers browse products inside WhatsApp, add sizes to the
// WhatsApp cart and tap "Place order". Meta sends that cart as an `order`
// message. Here each catalog item is matched to its Shopify variant (Meta
// catalogs synced by Shopify use retailer ids like shopify_IN_<product>_<variant>;
// plain variant ids and SKUs work too), checked for stock, and the customer gets
// one reply with the signed bag link (/apps/loopd2c/checkout/bag): it opens the
// store with exactly those items in the Shopify cart and the bag drawer open, to
// pay online or choose Cash on Delivery. Orders placed from it carry the cart
// attribute loopd2c_source=whatsapp_cart.
//
// The AI assistant can also open the catalog in the chat (a catalog message)
// when a customer wants to browse.

export const CART_LINK_SENT_EVENT = "WHATSAPP_CART_LINK_SENT";
const MAX_ITEMS = 20;
const MAX_QUANTITY = 10;

export type CatalogOrderItem = { product_retailer_id?: string; quantity?: number | string; item_price?: number | string; currency?: string };

// Shopify variant id from a Meta catalog retailer id, or null when it is not
// one (then it may be a SKU).
export function variantIdFromRetailerId(retailerId: string | null | undefined): number | null {
  const value = String(retailerId || "").trim();
  if (!value) return null;
  const shopifyFeed = value.match(/^shopify_[a-z]{2}_\d+_(\d+)$/i);
  const gid = value.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
  const digits = /^\d{6,20}$/.test(value) ? value : null;
  const id = Number(shopifyFeed?.[1] ?? gid?.[1] ?? digits ?? NaN);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// One line per catalog item, quantities added up, capped.
export function cartLinesFromOrder(items: CatalogOrderItem[]) {
  const lines = new Map<string, number>();
  for (const item of items.slice(0, 50)) {
    const retailerId = String(item?.product_retailer_id || "").trim();
    const quantity = Math.floor(Number(item?.quantity) || 0);
    if (!retailerId || quantity <= 0) continue;
    lines.set(retailerId, Math.min(MAX_QUANTITY, (lines.get(retailerId) ?? 0) + quantity));
  }
  return [...lines.entries()].slice(0, MAX_ITEMS).map(([retailerId, quantity]) => ({ retailerId, quantity }));
}

export type ResolvedLine = { retailerId: string; variantId: number; quantity: number; title: string; available: boolean };

export function cartReplyText(input: { lines: ResolvedLine[]; unmatched: number; link: string }) {
  const ready = input.lines.filter((line) => line.available);
  const soldOut = input.lines.filter((line) => !line.available);
  const parts = [
    "Your bag is ready 🛍️",
    "",
    ...ready.map((line) => `• ${line.title}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`),
  ];
  if (soldOut.length) parts.push("", `Sorry, sold out right now: ${soldOut.map((line) => line.title).join(", ")}. Reply here if you'd like us to tell you when it's back.`);
  if (input.unmatched) parts.push("", `${input.unmatched === 1 ? "One item" : `${input.unmatched} items`} could not be added; our team will check.`);
  parts.push("", "Tap to check out on our website. You can pay online or choose Cash on Delivery:", input.link);
  return parts.join("\n");
}

export function bagLink(host: string, token: string) {
  return `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}/apps/loopd2c/checkout/bag?t=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// I/O

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type VariantNode = { id?: string | null; title?: string | null; sku?: string | null; availableForSale?: boolean | null; product?: { title?: string | null; status?: string | null } | null };

const VARIANTS_QUERY = `query WhatsAppCartVariants($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id title sku availableForSale product { title status } } }
}`;
const SKU_QUERY = `query WhatsAppCartSkus($query: String!) {
  productVariants(first: 20, query: $query) { nodes { id title sku availableForSale product { title status } } }
}`;

const numericId = (gid: string | null | undefined) => Number(String(gid || "").match(/(\d+)$/)?.[1] ?? NaN);
const lineTitle = (node: VariantNode) => {
  const product = node.product?.title || "Item";
  return node.title && node.title !== "Default Title" ? `${product} (${node.title})` : product;
};

export async function resolveCartLines(shopDomain: string, lines: Array<{ retailerId: string; quantity: number }>, graphql: Graphql) {
  const byId = lines.map((line) => ({ ...line, variantId: variantIdFromRetailerId(line.retailerId) }));
  const ids = byId.filter((line) => line.variantId).map((line) => `gid://shopify/ProductVariant/${line.variantId}`);
  const skus = byId.filter((line) => !line.variantId).map((line) => line.retailerId);
  const nodes: VariantNode[] = [];
  if (ids.length) nodes.push(...((await graphql<{ nodes?: Array<VariantNode | null> }>(VARIANTS_QUERY, { ids }, { shopDomain })).nodes ?? []).filter((node): node is VariantNode => Boolean(node?.id)));
  if (skus.length) {
    const query = skus.map((sku) => `sku:"${sku.replace(/["\\]/g, "")}"`).join(" OR ");
    nodes.push(...((await graphql<{ productVariants?: { nodes?: VariantNode[] } }>(SKU_QUERY, { query }, { shopDomain })).productVariants?.nodes ?? []));
  }
  const resolved: ResolvedLine[] = [];
  let unmatched = 0;
  for (const line of byId) {
    const node = line.variantId ? nodes.find((entry) => numericId(entry.id) === line.variantId) : nodes.find((entry) => entry.sku && entry.sku === line.retailerId);
    if (!node?.id) { unmatched += 1; continue; }
    resolved.push({ retailerId: line.retailerId, variantId: numericId(node.id), quantity: line.quantity, title: lineTitle(node), available: Boolean(node.availableForSale) && (!node.product?.status || node.product.status === "ACTIVE") });
  }
  return { resolved, unmatched };
}

type OrderDb = {
  whatsAppConversation: { findFirst(args: unknown): Promise<{ id: string; shopId: string; contactPhone: string; contactName: string | null } | null>; update(args: unknown): Promise<unknown> };
  merchantWhatsAppAccount: { findUnique(args: unknown): Promise<{ enabled: boolean; shopInChatEnabled?: boolean } | null> };
  shop: { findUnique(args: unknown): Promise<{ id: string; shopDomain: string; primaryDomain: string | null } | null> };
  auditEvent: { create(args: unknown): Promise<unknown> };
};

export type CartOrderResult = { outcome: "link_sent" | "all_sold_out" | "unmatched" | "disabled" | "not_configured" | "conversation_missing" | "failed"; items?: number };

export async function handleWhatsAppCatalogOrder(
  input: { shopId: string; conversationId: string; waMessageId: string; items: CatalogOrderItem[]; now?: Date },
  deps: {
    db?: OrderDb;
    graphql?: Graphql;
    secret?: string | null;
    sendText?: (input: { shopId: string; conversationId: string; text: string }) => Promise<unknown>;
    alert?: (input: { shopId: string; subject: string; text: string }) => Promise<unknown>;
  } = {},
): Promise<CartOrderResult> {
  const now = input.now ?? new Date();
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as OrderDb);
  const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId: input.shopId } });
  if (!account?.enabled || !account.shopInChatEnabled) return { outcome: "disabled" };
  const conversation = await db.whatsAppConversation.findFirst({ where: { id: input.conversationId, shopId: input.shopId } });
  const shop = await db.shop.findUnique({ where: { id: input.shopId }, select: { id: true, shopDomain: true, primaryDomain: true } });
  if (!conversation || !shop) return { outcome: "conversation_missing" };
  const secret = deps.secret !== undefined ? deps.secret : (await import("../checkout-recovery/prepaid-cod-recovery.ts")).signingSecret();
  const sendText = deps.sendText ?? (async (send) => (await import("./inbox.ts")).sendConversationText({ ...send, sentByAi: true }));
  const flagForTeam = async (reason: string) => {
    await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { needsHuman: true, handoffKind: "SOFT", handoffReason: reason.slice(0, 200) } });
    await (deps.alert ?? (async (alert) => (await import("../notifications/email.ts")).sendOpsAlert({ shopId: alert.shopId, eventType: "GENERAL", subject: alert.subject, text: alert.text })))({
      shopId: input.shopId,
      subject: `WhatsApp: ${conversation.contactName || `+${conversation.contactPhone}`} sent a cart that needs a look`,
      text: `${reason}\n\nOpen the chat in LoopD2C → WhatsApp Inbox.`,
    }).catch(() => undefined);
  };
  if (!secret) {
    console.error("[WHATSAPP SHOP] signing_secret_missing", { shopId: input.shopId });
    await flagForTeam("Customer placed a WhatsApp catalog cart, but bag links cannot be signed (CHECKOUT_RECOVERY_SIGNING_SECRET is not set).");
    return { outcome: "not_configured" };
  }

  const lines = cartLinesFromOrder(input.items);
  const graphql = deps.graphql ?? (async (query, variables, options) => ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options));
  let resolved: ResolvedLine[] = [];
  let unmatched = lines.length;
  try {
    ({ resolved, unmatched } = await resolveCartLines(shop.shopDomain, lines, graphql));
  } catch (error) {
    console.error("[WHATSAPP SHOP] variant_lookup_failed", { shopId: input.shopId, error: error instanceof Error ? error.message : String(error) });
  }
  console.info("[WHATSAPP SHOP] catalog_cart", { conversationId: conversation.id, retailerIds: lines.map((line) => line.retailerId).slice(0, 10), matched: resolved.length, unmatched });

  const available = resolved.filter((line) => line.available);
  if (!resolved.length) {
    await sendText({ shopId: input.shopId, conversationId: conversation.id, text: "Thanks for your order! Our team will check your cart and reply here shortly." }).catch(() => undefined);
    await flagForTeam(`WhatsApp catalog cart could not be matched to Shopify products (catalog ids: ${lines.map((line) => line.retailerId).join(", ").slice(0, 150)}).`);
    return { outcome: "unmatched" };
  }
  if (!available.length) {
    await sendText({ shopId: input.shopId, conversationId: conversation.id, text: `Sorry, ${resolved.map((line) => line.title).join(", ")} ${resolved.length === 1 ? "is" : "are"} sold out right now. Reply here and we'll suggest something similar, or tell you when it's back.` });
    return { outcome: "all_sold_out" };
  }

  const { createCodRecoveryToken } = await import("../checkout-recovery/prepaid-cod-recovery.ts");
  const token = createCodRecoveryToken({ shopId: input.shopId, checkoutId: `wa:${input.waMessageId}`, items: available.map((line) => ({ variantId: line.variantId, quantity: line.quantity })), now }, secret);
  const link = bagLink(shop.primaryDomain || shop.shopDomain, token);
  try {
    await sendText({ shopId: input.shopId, conversationId: conversation.id, text: cartReplyText({ lines: resolved, unmatched, link }) });
  } catch (error) {
    console.error("[WHATSAPP SHOP] link_send_failed", { conversationId: conversation.id, error: error instanceof Error ? error.message : String(error) });
    await flagForTeam("Customer placed a WhatsApp catalog cart, but the bag link could not be sent.");
    return { outcome: "failed" };
  }
  if (unmatched) await flagForTeam(`Part of a WhatsApp catalog cart could not be matched (${unmatched} item${unmatched === 1 ? "" : "s"}); the rest was sent as a bag link.`);
  await db.auditEvent.create({ data: { actorType: "system", eventType: CART_LINK_SENT_EVENT, entityType: "WhatsAppConversation", entityId: conversation.id, payload: { shopId: input.shopId, waMessageId: input.waMessageId, items: available.map((line) => ({ variantId: line.variantId, quantity: line.quantity, title: line.title })), soldOut: resolved.length - available.length, unmatched } } }).catch(() => undefined);
  return { outcome: "link_sent", items: available.length };
}

// Opens the shop's WhatsApp catalog in the chat (only inside the 24-hour window).
export async function sendCatalogMessage(input: { shopId: string; conversationId: string; text?: string }, deps: { send?: (input: { shopId: string; conversationId: string; interactive: Record<string, unknown>; inboxBody: string; sentByAi?: boolean }) => Promise<unknown> } = {}) {
  const body = (input.text || "Browse our collection here. Pick your size, add to cart and tap Place order. We'll send you a link to check out.").slice(0, 1024);
  const send = deps.send ?? (async (message) => (await import("./inbox.ts")).sendConversationInteractive(message));
  return send({
    shopId: input.shopId,
    conversationId: input.conversationId,
    interactive: { type: "catalog_message", body: { text: body }, action: { name: "catalog_message" } },
    inboxBody: "🛍️ Catalog sent",
    sentByAi: true,
  });
}

// ---------------------------------------------------------------------------
// Product cards: the products the assistant recommends, sent as a WhatsApp
// product list (photo, price, add to cart) instead of text links.

// Meta catalogs synced by Shopify's Facebook & Instagram channel identify each
// variant as shopify_<country>_<product id>_<variant id>.
export function retailerIdFor(productGid: string, variantGid: string, country = "IN") {
  const product = String(productGid).match(/(\d+)$/)?.[1];
  const variant = String(variantGid).match(/(\d+)$/)?.[1];
  return product && variant ? `shopify_${country}_${product}_${variant}` : null;
}

export type CardProduct = { id?: string; title: string; variants?: Array<{ id: string; size: string; color: string; available: boolean }> };

const clipText = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

// One section per product with its in-stock variants (sizes / colours), so the
// size is chosen by the item added; at most 10 sections and 30 items.
export function productListMessage(input: { catalogId: string; header: string; products: CardProduct[]; country?: string }) {
  const sections: Array<{ title: string; product_items: Array<{ product_retailer_id: string }> }> = [];
  let items = 0;
  for (const product of input.products.slice(0, 10)) {
    if (!product.id) continue;
    const retailerIds = (product.variants ?? []).filter((variant) => variant.available)
      .map((variant) => retailerIdFor(product.id as string, variant.id, input.country))
      .filter((id): id is string => Boolean(id))
      .slice(0, 30 - items);
    if (!retailerIds.length) continue;
    items += retailerIds.length;
    sections.push({ title: clipText(product.title, 24), product_items: retailerIds.map((id) => ({ product_retailer_id: id })) });
    if (items >= 30) break;
  }
  if (!sections.length) return null;
  return {
    type: "product_list",
    header: { type: "text", text: clipText(input.header || "Our picks for you", 60) },
    body: { text: "Tap a product for photos and price, pick your size, add to cart and tap Place order. We'll send you a link to check out." },
    action: { catalog_id: input.catalogId, sections },
  };
}

// The catalog connected to the WhatsApp Business Account.
export async function resolveCatalogId(input: { wabaId: string; accessToken: string }, fetcher: typeof fetch = fetch) {
  const version = String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0").trim();
  const response = await fetcher(`https://graph.facebook.com/${version}/${encodeURIComponent(input.wabaId)}/product_catalogs`, { headers: { Authorization: `Bearer ${input.accessToken}` }, cache: "no-store" });
  const data = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }>; error?: { message?: string } } | null;
  const id = data?.data?.[0]?.id;
  if (!response.ok || !id) throw new Error(`No catalog found for the WhatsApp Business Account: ${data?.error?.message || `HTTP ${response.status}`}`);
  return String(id);
}

type CardsDb = { merchantWhatsAppAccount: { findUnique(args: unknown): Promise<{ shopId: string; enabled: boolean; phoneNumberId: string; accessTokenEncrypted: string; businessAccountId: string | null; catalogId?: string | null; templateLanguage: string } | null>; update(args: unknown): Promise<unknown> } };
type SendInteractive = (input: { shopId: string; conversationId: string; interactive: Record<string, unknown>; inboxBody: string; sentByAi?: boolean }) => Promise<unknown>;

// Sends product cards; when they cannot be sent (no catalog id, products not in
// the Meta catalog) falls back to opening the whole catalog.
export async function sendProductCards(
  input: { shopId: string; conversationId: string; header: string; products: CardProduct[] },
  deps: { db?: CardsDb; send?: SendInteractive; fetcher?: typeof fetch; decrypt?: (value: string) => string | null } = {},
): Promise<"cards" | "catalog" | "failed"> {
  const send: SendInteractive = deps.send ?? (async (message) => (await import("./inbox.ts")).sendConversationInteractive(message));
  try {
    const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as CardsDb);
    const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId: input.shopId } });
    let catalogId = account?.catalogId || null;
    if (!catalogId && account?.businessAccountId) {
      const { merchantSender } = await import("./sender.ts");
      const sender = merchantSender(account as never, deps.decrypt);
      if (sender) {
        catalogId = await resolveCatalogId({ wabaId: account.businessAccountId, accessToken: sender.accessToken }, deps.fetcher);
        await db.merchantWhatsAppAccount.update({ where: { shopId: input.shopId }, data: { catalogId } });
      }
    }
    const message = catalogId ? productListMessage({ catalogId, header: input.header, products: input.products }) : null;
    if (message) {
      await send({ shopId: input.shopId, conversationId: input.conversationId, interactive: message, inboxBody: `🛍️ Product cards: ${input.products.map((product) => product.title).join(", ").slice(0, 300)}`, sentByAi: true });
      return "cards";
    }
  } catch (error) {
    console.warn("[WHATSAPP SHOP] product_cards_failed", { conversationId: input.conversationId, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
  }
  try {
    await sendCatalogMessage({ shopId: input.shopId, conversationId: input.conversationId }, { send });
    return "catalog";
  } catch (error) {
    console.error("[WHATSAPP SHOP] catalog_fallback_failed", { conversationId: input.conversationId, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    return "failed";
  }
}
