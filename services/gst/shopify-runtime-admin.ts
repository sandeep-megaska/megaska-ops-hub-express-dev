import { normalizeShopDomain, resolveShopConfig } from "../shopify/shop-resolver";

const SHOPIFY_API_VERSION = "2026-01";

type ShopifyMoney = {
  amount?: string | null;
  currencyCode?: string | null;
};

type ShopifyMoneySet = {
  shopMoney?: ShopifyMoney | null;
};

type GstSyncOrderNode = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  subtotalPriceSet?: ShopifyMoneySet | null;
  totalTaxSet?: ShopifyMoneySet | null;
  totalPriceSet?: ShopifyMoneySet | null;
  shippingAddress?: { provinceCode?: string | null; province?: string | null } | null;
  billingAddress?: { provinceCode?: string | null; province?: string | null } | null;
  lineItems?: {
    nodes?: Array<{
      id: string;
      title?: string | null;
      sku?: string | null;
      quantity?: number | null;
      discountedUnitPriceAfterAllDiscountsSet?: ShopifyMoneySet | null;
      product?: { id?: string | null } | null;
      variant?: { id?: string | null } | null;
    }>;
  } | null;
};

function getEnvTrimmed(name: string) {
  return String(process.env[name] || "").trim();
}

function maskToken(token: string) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${"*".repeat(trimmed.length)}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

let cachedRuntimeToken: string | null = null;
let cachedRuntimeTokenExpiresAt = 0;
let cachedRuntimeTokenShopDomain = "";

async function getRuntimeAdminAccessToken(shopDomain: string) {
  const apiKey = getEnvTrimmed("SHOPIFY_API_KEY");
  const apiSecret = getEnvTrimmed("SHOPIFY_API_SECRET");
  if (!shopDomain || !apiKey || !apiSecret) {
    throw new Error("Shopify runtime admin authentication is not configured for GST sync");
  }

  const now = Date.now();
  if (cachedRuntimeToken && cachedRuntimeTokenExpiresAt > now && cachedRuntimeTokenShopDomain === shopDomain) {
    return cachedRuntimeToken;
  }

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "client_credentials",
    }),
  });

  const rawText = await response.text().catch(() => "");
  let payload: { access_token?: string; expires_in?: number | string } | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as { access_token?: string; expires_in?: number | string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    throw new Error(`Failed to obtain Shopify Admin runtime token (${response.status})`);
  }

  const expiresInSeconds = Number(payload.expires_in || 300);
  cachedRuntimeToken = payload.access_token;
  cachedRuntimeTokenExpiresAt = Date.now() + Math.max(30, expiresInSeconds - 60) * 1000;
  cachedRuntimeTokenShopDomain = shopDomain;
  return cachedRuntimeToken;
}

async function gstRuntimeAdminGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: { shopDomain?: string | null }
): Promise<T> {
  const preferredShopDomain = normalizeShopDomain(options.shopDomain);
  const shopConfig = await resolveShopConfig(preferredShopDomain);
  const shopDomain = shopConfig.shopDomain;

  const runtimeToken = await getRuntimeAdminAccessToken(shopDomain);

  console.log("[GST SHOPIFY RUNTIME] admin graphql", {
    shopDomain,
    tokenSource: "runtime_client_credentials",
    tokenPrefix: maskToken(runtimeToken).slice(0, 9),
    queryKind: query.includes("mutation") ? "mutation" : "query",
  });

  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": runtimeToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const rawText = await response.text().catch(() => "");
  let payload: { data?: T; errors?: Array<{ message?: string }> } | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as { data?: T; errors?: Array<{ message?: string }> }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`Shopify admin request failed (${response.status}) ${rawText}`.trim());
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join(", ") || "Shopify GraphQL error");
  }

  if (!payload?.data) {
    throw new Error("Shopify response missing data");
  }

  return payload.data;
}

function extractShopifyEntityId(gid: string | null | undefined): string {
  const raw = String(gid || "").trim();
  if (!raw) return "";
  if (!raw.includes("/")) return raw;
  return raw.split("/").pop() || raw;
}

function normalizeGstSyncOrder(node: GstSyncOrderNode) {
  return {
    id: extractShopifyEntityId(node.id),
    name: String(node.name || "").trim() || extractShopifyEntityId(node.id),
    createdAt: node.createdAt || new Date().toISOString(),
    currency: String(node.subtotalPriceSet?.shopMoney?.currencyCode || "INR"),
    subtotalPrice: Number(node.subtotalPriceSet?.shopMoney?.amount || 0),
    totalTax: Number(node.totalTaxSet?.shopMoney?.amount || 0),
    totalPrice: Number(node.totalPriceSet?.shopMoney?.amount || 0),
    shippingStateCode: node.shippingAddress?.provinceCode || node.shippingAddress?.province || null,
    billingStateCode: node.billingAddress?.provinceCode || node.billingAddress?.province || null,
    lines: (node.lineItems?.nodes || []).map((line) => ({
      id: extractShopifyEntityId(line.id),
      productId: extractShopifyEntityId(line.product?.id || ""),
      variantId: extractShopifyEntityId(line.variant?.id || ""),
      title: String(line.title || "Item"),
      sku: line.sku || null,
      quantity: Number(line.quantity || 0),
      price: Number(line.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount || 0),
      discount: 0,
    })),
  };
}

export async function getShopifyOrdersForGstSync(input: {
  from: Date;
  to: Date;
  financialStatus?: string[];
  fulfillmentStatus?: string[];
  shopDomain?: string;
}) {
  const filters = [`created_at:>=${input.from.toISOString()}`, `created_at:<=${input.to.toISOString()}`];
  if ((input.financialStatus || []).length) {
    filters.push(`(financial_status:${input.financialStatus?.map((status) => status.toLowerCase()).join(" OR financial_status:")})`);
  }
  if ((input.fulfillmentStatus || []).length) {
    filters.push(`(fulfillment_status:${input.fulfillmentStatus?.map((status) => status.toLowerCase()).join(" OR fulfillment_status:")})`);
  }

  const data = await gstRuntimeAdminGraphql<{ orders: { nodes: GstSyncOrderNode[] } }>(
    `
      query GstOrdersForSync($query: String!) {
        orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $query) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            subtotalPriceSet { shopMoney { amount currencyCode } }
            totalTaxSet { shopMoney { amount } }
            totalPriceSet { shopMoney { amount } }
            shippingAddress { provinceCode province }
            billingAddress { provinceCode province }
            lineItems(first: 100) {
              nodes {
                id
                title
                sku
                quantity
                discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
                product { id }
                variant { id }
              }
            }
          }
        }
      }
    `,
    { query: filters.join(" ") },
    { shopDomain: input.shopDomain }
  );

  return (data.orders.nodes || []).map(normalizeGstSyncOrder);
}

export async function getSingleShopifyOrderForGstSync(input: { orderNameOrNumber: string; shopDomain?: string }) {
  const key = String(input.orderNameOrNumber || "").trim();
  if (!key) return null;

  const query = key.startsWith("#") ? `name:${key}` : `name:#${key.replace(/^#/, "")}`;
  const data = await gstRuntimeAdminGraphql<{ orders: { nodes: GstSyncOrderNode[] } }>(
    `
      query GstSingleOrderForSync($query: String!) {
        orders(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) {
          nodes {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            subtotalPriceSet { shopMoney { amount currencyCode } }
            totalTaxSet { shopMoney { amount } }
            totalPriceSet { shopMoney { amount } }
            shippingAddress { provinceCode province }
            billingAddress { provinceCode province }
            lineItems(first: 100) {
              nodes {
                id
                title
                sku
                quantity
                discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
                product { id }
                variant { id }
              }
            }
          }
        }
      }
    `,
    { query },
    { shopDomain: input.shopDomain }
  );

  const node = data.orders.nodes[0];
  return node ? normalizeGstSyncOrder(node) : null;
}
