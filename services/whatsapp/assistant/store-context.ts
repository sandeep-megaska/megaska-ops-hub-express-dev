// Store facts for the WhatsApp assistant, read live from Shopify for each
// question: the shop name and domain, its policies (when the app may read
// them), catalog products matching the conversation (ranked locally over the
// cached catalog), and the recent orders of
// the customer behind this WhatsApp number. Every part is best-effort: a
// failed read just leaves that section empty, and the assistant then hands
// the question to the team instead of guessing.

import { catalogOverview, rankCatalog, type CatalogItem, type StoreContext } from "./policy.ts";

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

const SHOP_QUERY = `query AssistantShop { shop { name primaryDomain { url } } }`;
// Needs read_legal_policies; skipped quietly when the app was not granted it.
const POLICIES_QUERY = `query AssistantPolicies { shop { shopPolicies { type title body } } }`;
// The whole active catalog (titles, types, tags, colour options), cached per
// shop for 10 minutes and ranked locally: Shopify's product search matches
// words too literally ("swimsuits" misses "swimsuit", colours live in options).
const CATALOG_QUERY = `query AssistantCatalog($after: String) {
  products(first: 100, after: $after, query: "status:active") {
    nodes { id title productType tags options { name optionValues { name } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const PRODUCT_DETAILS_QUERY = `query AssistantProductDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id title handle onlineStoreUrl description
      priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      variants(first: 40) { nodes { title availableForSale selectedOptions { name value } } }
    }
  }
}`;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const CATALOG_MAX_PAGES = 5;
const catalogCache = new Map<string, { at: number; items: CatalogItem[] }>();

type CatalogNode = { id?: string | null; title?: string | null; productType?: string | null; tags?: string[] | null; options?: Array<{ name?: string | null; optionValues?: Array<{ name?: string | null }> | null }> | null };

export function catalogItemFromNode(node: CatalogNode): CatalogItem | null {
  if (!node?.id || !node.title) return null;
  const colors = (node.options ?? []).filter((option) => /colou?r/i.test(option?.name || "")).flatMap((option) => (option.optionValues ?? []).map((value) => value?.name || "")).filter(Boolean);
  return { id: node.id, title: node.title, productType: node.productType || "", tags: node.tags ?? [], colors };
}

async function loadCatalog(shopDomain: string, graphql: Graphql, now = Date.now()): Promise<CatalogItem[]> {
  const cached = catalogCache.get(shopDomain);
  if (cached && now - cached.at < CATALOG_TTL_MS) return cached.items;
  const items: CatalogItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const data: { products?: { nodes?: CatalogNode[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } } = await graphql(CATALOG_QUERY, { after }, { shopDomain });
    for (const node of data.products?.nodes ?? []) {
      const item = catalogItemFromNode(node);
      if (item) items.push(item);
    }
    if (!data.products?.pageInfo?.hasNextPage) break;
    after = data.products.pageInfo.endCursor ?? null;
  }
  catalogCache.set(shopDomain, { at: now, items });
  return items;
}

const ORDERS_QUERY = `query AssistantOrders($query: String!) {
  customers(first: 1, query: $query) {
    nodes {
      orders(first: 3, reverse: true) {
        nodes {
          name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 5) { nodes { title quantity variantTitle } }
          fulfillments(first: 3) { displayStatus estimatedDeliveryAt deliveredAt trackingInfo(first: 1) { number url company } }
        }
      }
    }
  }
}`;

type Money = { amount?: string | null; currencyCode?: string | null } | null | undefined;
type ProductNode = {
  title?: string | null;
  handle?: string | null;
  onlineStoreUrl?: string | null;
  description?: string | null;
  totalInventory?: number | null;
  priceRangeV2?: { minVariantPrice?: Money; maxVariantPrice?: Money } | null;
  variants?: { nodes?: Array<{ title?: string | null; availableForSale?: boolean | null; selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null }> | null } | null;
};
type OrderNode = {
  name?: string | null;
  createdAt?: string | null;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  paymentGatewayNames?: string[] | null;
  totalPriceSet?: { shopMoney?: Money } | null;
  lineItems?: { nodes?: Array<{ title?: string | null; quantity?: number | null; variantTitle?: string | null }> | null } | null;
  fulfillments?: Array<{ displayStatus?: string | null; estimatedDeliveryAt?: string | null; deliveredAt?: string | null; trackingInfo?: Array<{ number?: string | null; url?: string | null; company?: string | null }> | null }> | null;
};

const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

function rupees(money: Money) {
  const amount = Number(money?.amount);
  if (!Number.isFinite(amount)) return "";
  const symbol = !money?.currencyCode || money.currencyCode === "INR" ? "₹" : `${money.currencyCode} `;
  return `${symbol}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function humanize(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/_/g, " ").trim();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function stripHtml(html: string | null | undefined) {
  return String(html || "")
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function productFromNode(node: ProductNode, storeUrl: string | null): StoreContext["products"][number] | null {
  if (!node?.title) return null;
  const min = rupees(node.priceRangeV2?.minVariantPrice);
  const max = rupees(node.priceRangeV2?.maxVariantPrice);
  const sizes: string[] = [];
  const colors: string[] = [];
  for (const variant of node.variants?.nodes ?? []) {
    if (!variant?.availableForSale) continue;
    const options = variant.selectedOptions ?? [];
    const color = options.find((option) => /colou?r/i.test(option?.name || ""))?.value || "";
    if (color && !colors.includes(color)) colors.push(color);
    const size = options.find((option) => /size/i.test(option?.name || ""))?.value || (options.length ? "" : variant.title) || "";
    if (size && size !== "Default Title" && !sizes.includes(size)) sizes.push(size);
  }
  const inStock = (node.variants?.nodes ?? []).some((variant) => variant?.availableForSale);
  const url = node.onlineStoreUrl || (storeUrl && node.handle ? `${storeUrl.replace(/\/$/, "")}/products/${node.handle}` : null);
  return { title: node.title, url, price: min && max && min !== max ? `${min}–${max}` : min, sizes: sizes.join(", "), ...(colors.length ? { colors: colors.join(", ") } : {}), inStock, description: stripHtml(node.description).slice(0, 300) };
}

export function orderFromNode(node: OrderNode): StoreContext["orders"][number] | null {
  if (!node?.name) return null;
  const fulfillment = (node.fulfillments ?? [])[0];
  const tracking = fulfillment?.trackingInfo?.[0];
  let status = node.cancelledAt ? "cancelled" : humanize(fulfillment?.displayStatus || node.displayFulfillmentStatus) || "being prepared";
  if (fulfillment?.deliveredAt) status = `delivered on ${shortDate(fulfillment.deliveredAt)}`;
  else if (fulfillment?.estimatedDeliveryAt) status += `, expected by ${shortDate(fulfillment.estimatedDeliveryAt)}`;
  const cod = (node.paymentGatewayNames ?? []).some((name) => /cash on delivery|cod/i.test(name));
  return {
    name: node.name,
    placedOn: shortDate(node.createdAt),
    status,
    payment: cod ? "cash on delivery" : humanize(node.displayFinancialStatus) || "unknown",
    items: (node.lineItems?.nodes ?? []).map((line) => `${line?.quantity ?? 1}× ${line?.title}${line?.variantTitle ? ` (${line.variantTitle})` : ""}`).join(", "),
    tracking: tracking?.url || (tracking?.number ? `${tracking.company ? `${tracking.company} ` : ""}${tracking.number}` : null),
    total: rupees(node.totalPriceSet?.shopMoney),
  };
}

export async function loadStoreContext(
  input: { shopDomain: string; contactPhone: string; searchTerms: string[]; merchantNotes: string | null },
  graphql: Graphql = defaultGraphql,
): Promise<StoreContext> {
  const options = { shopDomain: input.shopDomain };
  const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await run(); } catch (error) {
      console.warn("[WHATSAPP ASSISTANT] store_context_read_failed", { shopDomain: input.shopDomain, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      return fallback;
    }
  };

  const [shop, policies, products, orders] = await Promise.all([
    safe(async () => (await graphql<{ shop?: { name?: string; primaryDomain?: { url?: string } } }>(SHOP_QUERY, {}, options)).shop ?? null, null),
    safe(async () => {
      const data = await graphql<{ shop?: { shopPolicies?: Array<{ title?: string; body?: string }> } }>(POLICIES_QUERY, {}, options);
      return (data.shop?.shopPolicies ?? []).map((policy) => ({ title: policy.title || "Policy", body: stripHtml(policy.body) })).filter((policy) => policy.body);
    }, [] as StoreContext["policies"]),
    safe(async () => {
      const catalog = await loadCatalog(input.shopDomain, graphql);
      const ids = rankCatalog(catalog, input.searchTerms);
      const details = ids.length ? (await graphql<{ nodes?: Array<ProductNode & { id?: string } | null> }>(PRODUCT_DETAILS_QUERY, { ids }, options)).nodes ?? [] : [];
      return { overview: catalogOverview(catalog), nodes: ids.map((id) => details.find((node) => node?.id === id)).filter((node): node is ProductNode => Boolean(node)) };
    }, { overview: [] as string[], nodes: [] as ProductNode[] }),
    safe(async () => {
      const data = await graphql<{ customers?: { nodes?: Array<{ orders?: { nodes?: OrderNode[] } }> } }>(ORDERS_QUERY, { query: `phone:+${input.contactPhone.replace(/\D/g, "")}` }, options);
      return data.customers?.nodes?.[0]?.orders?.nodes ?? [];
    }, [] as OrderNode[]),
  ]);

  const storeUrl = shop?.primaryDomain?.url || null;
  return {
    storeName: shop?.name || input.shopDomain.replace(/\.myshopify\.com$/, ""),
    storeUrl,
    policies,
    merchantNotes: input.merchantNotes,
    products: products.nodes.map((node) => productFromNode(node, storeUrl)).filter((product): product is StoreContext["products"][number] => Boolean(product)),
    catalogOverview: products.overview,
    orders: orders.map(orderFromNode).filter((order): order is StoreContext["orders"][number] => Boolean(order)),
  };
}
