import { normalizeShopDomain, resolveShopConfig } from "./shop-resolver";
import { normalizeIndianPhoneToE164 } from "./admin";

const SHOPIFY_API_VERSION = "2026-01";

type ShopifyMoney = {
  amount?: string | null;
  currencyCode?: string | null;
};

type ShopifyMoneySet = {
  shopMoney?: ShopifyMoney | null;
};

type ShopifyAddress = {
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  phone?: string | null;
};

type ShopifyLineItemNode = {
  id: string;
  title?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  quantity?: number | null;
  originalUnitPriceSet?: ShopifyMoneySet | null;
  discountedTotalSet?: ShopifyMoneySet | null;
  discountedUnitPriceAfterAllDiscountsSet?: ShopifyMoneySet | null;
  image?: { url?: string | null } | null;
  product?: {
    id?: string | null;
    title?: string | null;
    productType?: string | null;
    vendor?: string | null;
    tags?: string[] | null;
    featuredImage?: { url?: string | null } | null;
  } | null;
  variant?: {
    id?: string | null;
    title?: string | null;
    sku?: string | null;
    selectedOptions?: Array<{ name?: string | null; value?: string | null }> | null;
    image?: { url?: string | null } | null;
    product?: {
      id?: string | null;
      title?: string | null;
    } | null;
  } | null;
};

type ShopifyOrderNode = {
  id: string;
  name?: string | null;
  processedAt?: string | null;
  createdAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  statusPageUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  customer?: {
    id?: string | null;
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  currentTotalPriceSet?: ShopifyMoneySet | null;
  subtotalPriceSet?: ShopifyMoneySet | null;
  totalShippingPriceSet?: ShopifyMoneySet | null;
  totalTaxSet?: ShopifyMoneySet | null;
  shippingAddress?: ShopifyAddress | null;
  billingAddress?: ShopifyAddress | null;
  fulfillments?: Array<{
    id?: string | null;
    status?: string | null;
    createdAt?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: Array<{
      company?: string | null;
      number?: string | null;
      url?: string | null;
    }> | null;
  }> | null;
  lineItems?: { nodes?: ShopifyLineItemNode[] | null } | null;
};

type ShopifyCustomerNode = {
  id: string;
  email?: string | null;
  phone?: string | null;
  numberOfOrders?: string | number | null;
  defaultAddress?: ShopifyAddress | null;
  orders?: { nodes?: ShopifyOrderNode[] | null } | null;
};

export type MegaskaDashboardLineItem = {
  id: string;
  shopifyLineItemId: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  productTitle: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  fulfillableQuantity: number | null;
  refundableQuantity: number | null;
  currentSize: string | null;
  image: string | null;
  unitPrice: string | null;
  discountedTotal: string | null;
  currencyCode: string | null;
  productType: string | null;
  vendor: string | null;
  tags: string[];
};

export type MegaskaDashboardOrder = {
  id: string;
  shopifyOrderId: string;
  numericOrderId: string | null;
  name: string;
  processedAt: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  totalAmount: string | null;
  subtotalAmount: string | null;
  shippingAmount: string | null;
  taxAmount: string | null;
  currencyCode: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  email: string | null;
  phone: string | null;
  customerId: string | null;
  shippingAddress: ShopifyAddress | null;
  billingAddress: ShopifyAddress | null;
  fulfillments: ShopifyOrderNode["fulfillments"];
  lineItems: MegaskaDashboardLineItem[];
  displayTitle: string | null;
  displayImage: string | null;
  itemsCount: number;
  firstLineItemId: string | null;
  firstLineItemTitle: string | null;
  firstLineItemVariantTitle: string | null;
  firstLineItemSku: string | null;
};

export type MegaskaCustomerDashboardData = {
  email: string | null;
  phone: string | null;
  defaultAddress: ShopifyAddress | null;
  totalOrderCount: number;
  recentOrders: MegaskaDashboardOrder[];
  matchSource: "customer_id" | "order_search" | "none";
};

function getEnvTrimmed(name: string) {
  return String(process.env[name] || "").trim();
}

function hasRuntimeCredentialConfig() {
  return Boolean(getEnvTrimmed("SHOPIFY_API_KEY") && getEnvTrimmed("SHOPIFY_API_SECRET"));
}

let cachedRuntimeToken: string | null = null;
let cachedRuntimeTokenExpiresAt = 0;

async function getRuntimeAdminAccessToken(shopDomain: string) {
  const apiKey = getEnvTrimmed("SHOPIFY_API_KEY");
  const apiSecret = getEnvTrimmed("SHOPIFY_API_SECRET");
  if (!shopDomain || !apiKey || !apiSecret) {
    throw new Error("Shopify runtime admin authentication is not configured");
  }

  const now = Date.now();
  if (cachedRuntimeToken && cachedRuntimeTokenExpiresAt > now) {
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
    throw new Error(`Failed to obtain Shopify Admin access token (${response.status})`);
  }

  const expiresInSeconds = Number(payload.expires_in || 300);
  cachedRuntimeToken = payload.access_token;
  cachedRuntimeTokenExpiresAt = Date.now() + Math.max(30, expiresInSeconds - 60) * 1000;
  return cachedRuntimeToken;
}

async function dashboardGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: { shopDomain?: string | null }
): Promise<T> {
  const preferredShopDomain = normalizeShopDomain(options.shopDomain);
  const shopConfig = await resolveShopConfig(preferredShopDomain);
  const shopDomain = shopConfig.shopDomain;
  const defaultShopDomain = normalizeShopDomain(getEnvTrimmed("SHOPIFY_STORE_DOMAIN"));
  const runtimeConfigured = hasRuntimeCredentialConfig();

  let token = "";
  let tokenSource: "shop_stored_token" | "runtime_client_credentials" | "env_fallback" = "env_fallback";

 if (runtimeConfigured && (!preferredShopDomain || preferredShopDomain === defaultShopDomain)) {
  token = await getRuntimeAdminAccessToken(shopDomain);
  tokenSource = "runtime_client_credentials";
} else if (shopConfig.accessToken) {
  token = shopConfig.accessToken;
  tokenSource = "shop_stored_token";
} else {
  token = getEnvTrimmed("SHOPIFY_ADMIN_ACCESS_TOKEN");
  tokenSource = "env_fallback";
}

  if (!shopDomain || !token) {
    throw new Error("Shopify dashboard sync is not configured for this shop");
  }
console.log("[DASHBOARD SHOP SCOPE DEBUG]", {
  preferredShopDomain,
  resolvedShopDomain: shopDomain,
  resolvedShopId: shopConfig.id,
  hasStoredAccessToken: Boolean(shopConfig.accessToken),
  hasRuntimeConfig: runtimeConfigured,
  defaultShopDomain,
  tokenSource,
  tokenPrefix: String(token || "").slice(0, 10),
});
  console.log("[SHOPIFY DASHBOARD V2] admin graphql", {
    shopDomain,
    tokenSource,
    queryKind: query.includes("mutation") ? "mutation" : "query",
  });

  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
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
    throw new Error(`Shopify dashboard request failed (${response.status}) ${rawText}`.trim());
  }
  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join(", ") || "Shopify dashboard GraphQL error");
  }
  if (!payload?.data) {
    throw new Error("Shopify dashboard response missing data");
  }
  return payload.data;
}

function extractNumericId(gid: string | null | undefined, typeName: string) {
  const raw = String(gid || "").trim();
  if (!raw) return null;
  const match = raw.match(new RegExp(`${typeName}/(\\d+)$`));
  return match?.[1] || null;
}

function getOptionValue(line: ShopifyLineItemNode, names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const option = line.variant?.selectedOptions?.find((entry) =>
    normalizedNames.includes(String(entry?.name || "").trim().toLowerCase())
  );
  return String(option?.value || "").trim() || null;
}

function mapOrder(order: ShopifyOrderNode): MegaskaDashboardOrder {
  const lineItems = (order.lineItems?.nodes || []).map((line) => {
    const productTitle = line.product?.title || line.variant?.product?.title || line.title || null;
    const variantTitle = line.variant?.title || line.variantTitle || null;
    const image = line.variant?.image?.url || line.image?.url || line.product?.featuredImage?.url || null;
    const unitMoney = line.discountedUnitPriceAfterAllDiscountsSet?.shopMoney || line.originalUnitPriceSet?.shopMoney || null;
    const totalMoney = line.discountedTotalSet?.shopMoney || null;

    return {
      id: line.id,
      shopifyLineItemId: line.id,
      productId: line.product?.id || line.variant?.product?.id || null,
      variantId: line.variant?.id || null,
      title: String(line.title || productTitle || "Item").trim(),
      productTitle,
      variantTitle,
      sku: line.variant?.sku || line.sku || null,
      quantity: Number(line.quantity || 0),
      fulfillableQuantity: null,
      refundableQuantity: null,
      currentSize: getOptionValue(line, ["size", "Size"]),
      image,
      unitPrice: unitMoney?.amount || null,
      discountedTotal: totalMoney?.amount || null,
      currencyCode: unitMoney?.currencyCode || totalMoney?.currencyCode || null,
      productType: line.product?.productType || null,
      vendor: line.product?.vendor || null,
      tags: Array.isArray(line.product?.tags) ? line.product?.tags || [] : [],
    };
  });

  const firstLine = lineItems[0] || null;
  const deliveredAt = (order.fulfillments || []).find((fulfillment) => fulfillment?.deliveredAt)?.deliveredAt || null;

  return {
    id: order.id,
    shopifyOrderId: order.id,
    numericOrderId: extractNumericId(order.id, "Order"),
    name: String(order.name || "").trim(),
    processedAt: order.processedAt || null,
    createdAt: order.createdAt || null,
    deliveredAt: deliveredAt || order.processedAt || null,
    closedAt: order.closedAt || null,
    cancelledAt: order.cancelledAt || null,
    cancelReason: order.cancelReason || null,
    totalAmount: order.currentTotalPriceSet?.shopMoney?.amount || null,
    subtotalAmount: order.subtotalPriceSet?.shopMoney?.amount || null,
    shippingAmount: order.totalShippingPriceSet?.shopMoney?.amount || null,
    taxAmount: order.totalTaxSet?.shopMoney?.amount || null,
    currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode || null,
    financialStatus: order.displayFinancialStatus || null,
    fulfillmentStatus: order.displayFulfillmentStatus || null,
    statusPageUrl: order.statusPageUrl || null,
    email: order.email || order.customer?.email || null,
    phone: order.phone || order.shippingAddress?.phone || order.customer?.phone || null,
    customerId: order.customer?.id || null,
    shippingAddress: order.shippingAddress || null,
    billingAddress: order.billingAddress || null,
    fulfillments: order.fulfillments || [],
    lineItems,
    displayTitle: firstLine?.productTitle || firstLine?.title || order.name || "Order",
    displayImage: firstLine?.image || null,
    itemsCount: lineItems.length,
    firstLineItemId: firstLine?.shopifyLineItemId || null,
    firstLineItemTitle: firstLine?.productTitle || firstLine?.title || null,
    firstLineItemVariantTitle: firstLine?.variantTitle || null,
    firstLineItemSku: firstLine?.sku || null,
  };
}

const ORDER_FRAGMENT = `
  id
  name
  processedAt
  createdAt
  closedAt
  cancelledAt
  cancelReason
  displayFinancialStatus
  displayFulfillmentStatus
  statusPageUrl
  email
  phone
  customer {
    id
    email
    phone
    firstName
    lastName
  }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  totalTaxSet { shopMoney { amount currencyCode } }
  shippingAddress {
    firstName
    lastName
    address1
    address2
    city
    province
    provinceCode
    zip
    country
    countryCodeV2
    phone
  }
  billingAddress {
    firstName
    lastName
    address1
    address2
    city
    province
    provinceCode
    zip
    country
    countryCodeV2
    phone
  }
  fulfillments(first: 10) {
    id
    status
    createdAt
    deliveredAt
    trackingInfo {
      company
      number
      url
    }
  }
  lineItems(first: 50) {
    nodes {
      id
      title
      variantTitle
      sku
      quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      discountedTotalSet { shopMoney { amount currencyCode } }
      discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
      image { url }
      product {
        id
        title
        productType
        vendor
        tags
        featuredImage { url }
      }
      variant {
        id
        title
        sku
        selectedOptions { name value }
        image { url }
        product { id title }
      }
    }
  }
`;

async function fetchCustomerDashboard(input: { customerGid: string; shopDomain?: string | null }) {
  return dashboardGraphql<{
    customer: ShopifyCustomerNode | null;
  }>(
    `
      query MegaskaCustomerDashboardV2($id: ID!) {
        customer(id: $id) {
          id
          email
          phone
          numberOfOrders
          defaultAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            provinceCode
            zip
            country
            countryCodeV2
            phone
          }
          orders(first: 25, sortKey: PROCESSED_AT, reverse: true) {
            nodes {
              ${ORDER_FRAGMENT}
            }
          }
        }
      }
    `,
    { id: input.customerGid },
    { shopDomain: input.shopDomain }
  );
}

async function searchOrdersByIdentity(input: { shopDomain?: string | null; email?: string | null; phoneE164?: string | null }) {
  const searchTerms: string[] = [];
  const email = String(input.email || "").trim().toLowerCase();
  const phone = normalizeIndianPhoneToE164(input.phoneE164) || String(input.phoneE164 || "").trim();
  if (email) searchTerms.push(`email:${email}`);
  if (phone) searchTerms.push(`phone:${phone}`);
  if (!searchTerms.length) return [];

  const data = await dashboardGraphql<{
    orders: { nodes?: ShopifyOrderNode[] | null };
  }>(
    `
      query MegaskaOrdersByIdentity($query: String!) {
        orders(first: 25, query: $query, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            ${ORDER_FRAGMENT}
          }
        }
      }
    `,
    { query: searchTerms.join(" OR ") },
    { shopDomain: input.shopDomain }
  );

  return data.orders.nodes || [];
}

function resolveCustomerGid(customerId: string | null | undefined) {
  const trimmed = String(customerId || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://shopify/Customer/")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Customer/${trimmed}`;
  return "";
}

export async function getMegaskaCustomerDashboardData(input: {
  shopDomain?: string | null;
  customerId?: string | null;
  email?: string | null;
  phoneE164?: string | null;
}): Promise<MegaskaCustomerDashboardData | null> {
  const customerGid = resolveCustomerGid(input.customerId);
  let customer: ShopifyCustomerNode | null = null;
  let customerOrders: ShopifyOrderNode[] = [];

  if (customerGid) {
    const customerData = await fetchCustomerDashboard({ customerGid, shopDomain: input.shopDomain });
    customer = customerData.customer;
    customerOrders = customer?.orders?.nodes || [];
  }

  let orderSearchNodes: ShopifyOrderNode[] = [];
  if (!customerOrders.length) {
    orderSearchNodes = await searchOrdersByIdentity({
      shopDomain: input.shopDomain,
      email: input.email || customer?.email || null,
      phoneE164: input.phoneE164 || customer?.phone || null,
    });
  }

  const byId = new Map<string, ShopifyOrderNode>();
  [...customerOrders, ...orderSearchNodes].forEach((order) => {
    if (order?.id && !byId.has(order.id)) byId.set(order.id, order);
  });

  const recentOrders = Array.from(byId.values()).map(mapOrder);
  const totalOrderCountRaw = customer?.numberOfOrders;
  const totalOrderCount = Math.max(
    typeof totalOrderCountRaw === "number"
      ? totalOrderCountRaw
      : Number.parseInt(String(totalOrderCountRaw || "0"), 10) || 0,
    recentOrders.length
  );

  console.log("[SHOPIFY DASHBOARD V2] result", {
    shopDomain: input.shopDomain || null,
    customerGid: customerGid || null,
    foundCustomer: Boolean(customer),
    customerOrdersCount: customerOrders.length,
    orderSearchCount: orderSearchNodes.length,
    mappedOrdersCount: recentOrders.length,
    totalOrderCount,
  });

  return {
    email: customer?.email || recentOrders[0]?.email || input.email || null,
    phone: customer?.phone || recentOrders[0]?.phone || input.phoneE164 || null,
    defaultAddress: customer?.defaultAddress || recentOrders[0]?.shippingAddress || null,
    totalOrderCount,
    recentOrders,
    matchSource: customerOrders.length ? "customer_id" : orderSearchNodes.length ? "order_search" : customer ? "customer_id" : "none",
  };
}
