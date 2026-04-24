import { normalizeShopDomain, resolveShopConfig } from "./shop-resolver";

const SHOPIFY_API_VERSION = "2026-01";

type ShopifyCustomerNode = {
  id: string;
  email?: string | null;
  phone?: string | null;
};

type ShopifyMoney = {
  amount: string;
  currencyCode: string;
};

type ShopifyMailingAddress = {
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
};

type ShopifyCustomerSyncInput = {
  fullName?: string | null;
  email?: string | null;
  phoneE164?: string | null;
};

type ShopifyCustomerSyncResult = {
  shopifyCustomerId: string;
  source: "existing" | "created";
  matchedBy?: "email" | "phone";
};

type ShopifyCustomerLookupInput = {
  shopDomain?: string | null;
  email?: string | null;
  phoneE164?: string | null;
};


export type OrderMegaskaIdentityInput = {
  orderId: string;
  verifiedPhone: string;
  phoneVerified: boolean;
  authSource: string;
  customerProfileId?: string | null;
  shopifyCustomerId?: string | null;
  verificationCompletedAt?: string | null;
  phoneMatchStatus?: "match" | "mismatch" | "missing_order_phone" | "missing_verified_phone";
  originalCheckoutPhone?: string | null;
  orderContactEmail?: string | null;
  mismatchDetected?: boolean;
  correctedOrderPhone?: string | null;
  phoneCorrected?: boolean;
  correctionAttempted?: boolean;
  correctionError?: string | null;
};
export async function findShopifyCustomerForSync(input: {
  shopDomain?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const normalizedEmail = String(input.email || "").trim().toLowerCase();
  const normalizedPhone = normalizeIndianPhoneToE164(input.phone);

  const searchTerms: string[] = [];
  if (normalizedEmail) searchTerms.push(`email:${normalizedEmail}`);
  if (normalizedPhone) searchTerms.push(`phone:${normalizedPhone}`);

  if (!searchTerms.length) {
    throw new Error("Missing phone or email for customer sync");
  }

  const queryString = searchTerms.join(" OR ");

  const data = await adminGraphql<{
    customers: {
      nodes: Array<{
        id: string;
        displayName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        defaultEmailAddress?: {
          emailAddress?: string | null;
        } | null;
        defaultPhoneNumber?: {
          phoneNumber?: string | null;
        } | null;
        defaultAddress?: {
          address1?: string | null;
          address2?: string | null;
          city?: string | null;
          province?: string | null;
          zip?: string | null;
          country?: string | null;
          phone?: string | null;
        } | null;
      }>;
    };
  }>(
    `
      query FindCustomerForSync($query: String!) {
        customers(first: 10, query: $query) {
          nodes {
            id
            displayName
            firstName
            lastName
            defaultEmailAddress {
              emailAddress
            }
            defaultPhoneNumber {
              phoneNumber
            }
            defaultAddress {
              address1
              address2
              city
              province
              zip
              country
              phone
            }
          }
        }
      }
    `,
    {
      query: queryString,
    },
    {
      shopDomain: input.shopDomain ?? null,
    }
  );

  return data.customers.nodes || [];
}
export type ShopifyRecentOrder = {
  id: string;
  shopifyOrderId: string;
  name: string;
  processedAt: string | null;
  deliveredAt: string | null;
  totalAmount: string | null;
  currencyCode: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  statusPageUrl: string | null;
  displayTitle?: string | null;
  displayImage?: string | null;
  itemsCount?: number | null;
  firstLineItemId?: string | null;
  firstLineItemTitle?: string | null;
  firstLineItemVariantTitle?: string | null;
  firstLineItemSku?: string | null;
};

export type ShopifyCustomerDashboardData = {
  email: string | null;
  phone: string | null;
  defaultAddress: ShopifyMailingAddress | null;
  totalOrderCount: number;
  recentOrders: ShopifyRecentOrder[];
};
export async function getShopifyCustomersForSync(input?: {
  shopDomain?: string | null;
  first?: number;
  after?: string | null;
}) {
  const data = await adminGraphql<{
    customers: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: Array<{
        id: string;
        displayName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        defaultEmailAddress?: {
          emailAddress?: string | null;
        } | null;
        defaultPhoneNumber?: {
          phoneNumber?: string | null;
        } | null;
        defaultAddress?: {
          address1?: string | null;
          address2?: string | null;
          city?: string | null;
          province?: string | null;
          zip?: string | null;
          country?: string | null;
          phone?: string | null;
        } | null;
      }>;
    };
  }>(
    `
      query CustomersSync($first: Int!, $after: String) {
        customers(first: $first, after: $after, sortKey: UPDATED_AT) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            displayName
            firstName
            lastName
            defaultEmailAddress {
              emailAddress
            }
            defaultPhoneNumber {
              phoneNumber
            }
            defaultAddress {
              address1
              address2
              city
              province
              zip
              country
              phone
            }
          }
        }
      }
    `,
    {
      first: input?.first ?? 100,
      after: input?.after ?? null,
    },
    {
      shopDomain: input?.shopDomain ?? null,
    }
  );

  return data.customers;
}
function splitName(fullNameRaw: string | null | undefined) {
  const normalized = String(fullNameRaw || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }

  const [firstName, ...rest] = normalized.split(" ");
  return {
    firstName: firstName || "",
    lastName: rest.join(" ").trim(),
  };
}

function normalizeEmail(emailRaw: string | null | undefined) {
  const value = String(emailRaw || "").trim().toLowerCase();
  return value || "";
}

function normalizePhone(phoneRaw: string | null | undefined) {
  return String(phoneRaw || "").trim();
}

function parseCustomerId(gidOrId: string) {
  const trimmed = String(gidOrId || "").trim();
  const gidMatch = trimmed.match(/Customer\/(\d+)$/);
  return gidMatch?.[1] || trimmed;
}

function resolveOrderGid(orderId: string) {
  const trimmed = String(orderId || "").trim();
  if (trimmed.startsWith("gid://shopify/Order/")) return trimmed;
  return `gid://shopify/Order/${trimmed}`;
}

function resolveCustomerGid(customerId: string) {
  const trimmed = String(customerId || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("gid://shopify/Customer/")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Customer/${trimmed}`;
  return "";
}

export function normalizeIndianPhoneToE164(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return null;
}

function maskToken(token: string) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${"*".repeat(trimmed.length)}`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

let cachedRuntimeToken: string | null = null;
let cachedRuntimeTokenExpiresAt = 0;

type RuntimeAdminTokenResult = {
  accessToken: string;
  expiresAt: number;
};

function getEnvTrimmed(name: string) {
  return String(process.env[name] || "").trim();
}

function hasRuntimeCredentialConfig() {
  return Boolean(getEnvTrimmed("SHOPIFY_API_KEY") && getEnvTrimmed("SHOPIFY_API_SECRET"));
}

async function getRuntimeAdminAccessToken(shopDomain: string): Promise<RuntimeAdminTokenResult> {
  const apiKey = getEnvTrimmed("SHOPIFY_API_KEY");
  const apiSecret = getEnvTrimmed("SHOPIFY_API_SECRET");

  if (!shopDomain || !apiKey || !apiSecret) {
    throw new Error("Shopify runtime admin authentication is not configured");
  }

  const now = Date.now();
  if (cachedRuntimeToken && cachedRuntimeTokenExpiresAt > now) {
    console.log("[SHOPIFY AUTH SERVER] reusing cached runtime admin access token", {
      shopDomain,
      expiresInSecApprox: Math.max(0, Math.floor((cachedRuntimeTokenExpiresAt - now) / 1000)),
    });

    return {
      accessToken: cachedRuntimeToken,
      expiresAt: cachedRuntimeTokenExpiresAt,
    };
  }

  console.log("[SHOPIFY AUTH SERVER] fetching runtime admin access token", {
    shopDomain,
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecret),
  });

  let response: Response;
  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
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
  } catch {
    throw new Error("Failed to obtain Shopify Admin access token");
  }

  const rawText = await response.text().catch(() => "");
  let payload: { access_token?: string; expires_in?: number | string } | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as { access_token?: string; expires_in?: number | string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error("[SHOPIFY AUTH SERVER] runtime admin token fetch failed", {
      shopDomain,
      status: response.status,
      responsePreview: rawText.slice(0, 200),
    });
    throw new Error(`Failed to obtain Shopify Admin access token (${response.status})`);
  }

  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Failed to obtain Shopify Admin access token");
  }

  const expiresInSecondsRaw = Number(payload?.expires_in);
  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0 ? expiresInSecondsRaw : 300;
  const refreshEarlySeconds = 60;
  const cacheTtlSeconds = Math.max(30, expiresInSeconds - refreshEarlySeconds);
  const expiresAt = Date.now() + cacheTtlSeconds * 1000;

  cachedRuntimeToken = accessToken;
  cachedRuntimeTokenExpiresAt = expiresAt;

  return { accessToken, expiresAt };
}

type AdminRequestOptions = {
  shopDomain?: string | null;
};

async function adminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  options?: AdminRequestOptions
): Promise<T> {
  const preferredShopDomain = normalizeShopDomain(options?.shopDomain);
  const shopConfig = await resolveShopConfig(preferredShopDomain);
  const shopDomain = shopConfig.shopDomain;
  const staticFallbackToken = shopConfig.accessToken || getEnvTrimmed("SHOPIFY_ADMIN_ACCESS_TOKEN");
  const runtimeConfigured = hasRuntimeCredentialConfig();
  const defaultShopDomain = normalizeShopDomain(getEnvTrimmed("SHOPIFY_STORE_DOMAIN"));

 /* let token = "";
  let tokenSource: "runtime_client_credentials" | "env_fallback" = "runtime_client_credentials";
  if (runtimeConfigured) {
  token = await getRuntimeAdminAccessToken(shopDomain);
  tokenSource = "runtime_client_credentials";
} else if (shopConfig.accessToken) {
  token = shopConfig.accessToken;
  tokenSource = "shop_stored_token";
} else {
  token = getEnvTrimmed("SHOPIFY_ADMIN_ACCESS_TOKEN");
  tokenSource = "env_fallback";
}
  let token = "";
let tokenSource: "shop_stored_token" | "runtime_client_credentials" | "env_fallback" = "env_fallback";

if (runtimeConfigured && (!preferredShopDomain || preferredShopDomain === defaultShopDomain)) {
  const runtimeToken = await getRuntimeAdminAccessToken(shopDomain);
  token = runtimeToken.accessToken;
  tokenSource = "runtime_client_credentials";
} else if (shopConfig.accessToken) {
  token = shopConfig.accessToken;
  tokenSource = "shop_stored_token";
} else {
  token = staticFallbackToken;
  tokenSource = "env_fallback";
}

  if (!shopDomain || !token) {
    throw new Error("Shopify admin sync is not configured (missing store domain or admin access token)");
  }

  console.log("[SHOPIFY AUTH SERVER] calling admin graphql", {
    shopDomain,
    apiVersion: SHOPIFY_API_VERSION,
    tokenSource,
    tokenMasked: maskToken(token),
    tokenPrefix: String(token || "").slice(0, 6),
    queryKind: query.includes("mutation") ? "mutation" : "query",
  });

  const response = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  const rawText = await response.text().catch(() => "");
  let payload: {
    data?: T;
    errors?: Array<{ message?: string }>;
  } | null = null;

  try {
    payload = rawText
      ? (JSON.parse(rawText) as {
          data?: T;
          errors?: Array<{ message?: string }>;
        })
      : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(`Shopify admin request failed (${response.status}) ${rawText || ""}`.trim());
  }

  if (payload?.errors?.length) {
    const message = payload.errors.map((error) => error.message).filter(Boolean).join(", ");
    throw new Error(message || "Shopify admin GraphQL error");
  }

  if (!payload?.data) {
    throw new Error("Shopify admin response missing data");
  }

  return payload.data;
}

export function isShopifyAdminConfigured() {
  return Boolean(getEnvTrimmed("SHOPIFY_STORE_DOMAIN") && (hasRuntimeCredentialConfig() || getEnvTrimmed("SHOPIFY_ADMIN_ACCESS_TOKEN")));
}


export async function debugShopifyAdminAuth(options?: AdminRequestOptions) {
  return adminGraphql<{
    shop: {
      name: string;
      myshopifyDomain: string;
    } | null;
  }>(
    `
      query DebugShopifyAdminAuth {
        shop {
          name
          myshopifyDomain
        }
      }
    `,
    {},
    options
  );
}
async function findCustomerByQuery(
  query: string,
  options?: AdminRequestOptions
): Promise<ShopifyCustomerNode | null> {
  const data = await adminGraphql<{
    customers: {
      edges: Array<{ node: ShopifyCustomerNode }>;
    };
  }>(
    `
      query FindCustomer($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              email
              phone
            }
          }
        }
      }
    `,
    { query },
    options
  );

  return data.customers.edges[0]?.node || null;
}

export async function findShopifyCustomerIdByIdentity(
  input: ShopifyCustomerLookupInput
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  const phone = normalizeIndianPhoneToE164(input.phoneE164);
  const options: AdminRequestOptions = {
    shopDomain: input.shopDomain ?? null,
  };

  if (phone) {
    const customer = await findCustomerByQuery(`phone:${phone}`, options);
    if (customer?.id) {
      return parseCustomerId(customer.id);
    }
  }

  if (email) {
    const customer = await findCustomerByQuery(`email:${email}`, options);
    if (customer?.id) {
      return parseCustomerId(customer.id);
    }
  }

  return null;
}
async function createCustomer(input: ShopifyCustomerSyncInput) {
  const { firstName, lastName } = splitName(input.fullName);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phoneE164);

  const data = await adminGraphql<{
    customerCreate: {
      customer?: ShopifyCustomerNode | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `
      mutation CreateCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            email
            phone
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      input: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        phone: phone || undefined,
      },
    }
  );

  const errorMessage = data.customerCreate.userErrors[0]?.message;
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  if (!data.customerCreate.customer?.id) {
    throw new Error("Shopify did not return a customer id");
  }

  return data.customerCreate.customer;
}

async function setOrderTags(input: { orderId: string; tags: string[] }, options?: AdminRequestOptions) {
  const tags = Array.from(new Set((input.tags || []).map((tag) => String(tag || "").trim()).filter(Boolean)));

  if (!tags.length) {
    return {
      node: {
        id: resolveOrderGid(input.orderId),
        tags: [] as string[],
      },
      userErrors: [] as Array<{ message: string; field?: string[] }>,
    };
  }

  const data = await adminGraphql<{
    tagsAdd: {
      node?: { id: string; tags: string[] } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation AddOrderTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            ... on Order {
              id
              tags
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      id: resolveOrderGid(input.orderId),
      tags,
    },
    options
  );

  return data.tagsAdd;
}

export async function updateOrderPhone(
  input: { orderId: string; phone: string },
  options?: AdminRequestOptions
) {
  const data = await adminGraphql<{
    orderUpdate: {
      order?: { id: string; phone?: string | null } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation UpdateOrderPhone($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            phone
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: {
        id: resolveOrderGid(input.orderId),
        phone: String(input.phone || "").trim(),
      },
    },
    options
  );

  return data.orderUpdate;
}

export async function updateShopifyOrderEmail(
  orderGid: string,
  email: string,
  options?: AdminRequestOptions
) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Missing order email");
  }

  const data = await adminGraphql<{
    orderUpdate: {
      order?: { id: string; email?: string | null } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation UpdateOrderEmail($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            email
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: {
        id: resolveOrderGid(orderGid),
        email: normalizedEmail,
      },
    },
    options
  );

  return data.orderUpdate;
}

export async function getShopifyCustomerDashboardData(input: {
  customerId: string;
  shopDomain?: string | null;
}): Promise<ShopifyCustomerDashboardData | null> {
  const customerId = String(input.customerId || "").trim();
  const customerGid = resolveCustomerGid(customerId);
  if (!customerGid) return null;

  const options: AdminRequestOptions = {
    shopDomain: input.shopDomain ?? null,
  };

  console.log("[SHOPIFY DASHBOARD] fetch customer dashboard", {
    inputCustomerId: customerId,
    customerGid,
    shopDomain: input.shopDomain || null,
  });

  const data = await adminGraphql<{
    customer: {
      email?: string | null;
      phone?: string | null;
      numberOfOrders?: string | number | null;
      defaultAddress?: ShopifyMailingAddress | null;
      orders?: {
        nodes: Array<{
          id: string;
          name?: string | null;
          processedAt?: string | null;
          displayFinancialStatus?: string | null;
          displayFulfillmentStatus?: string | null;
          statusPageUrl?: string | null;
          currentTotalPriceSet?: {
            shopMoney?: ShopifyMoney | null;
          } | null;
          lineItems?: {
            nodes?: Array<{
              id: string;
              title?: string | null;
              variantTitle?: string | null;
              sku?: string | null;
              quantity?: number | null;
              image?: {
                url?: string | null;
              } | null;
              product?: {
                title?: string | null;
                featuredImage?: {
                  url?: string | null;
                } | null;
              } | null;
              variant?: {
                title?: string | null;
                sku?: string | null;
                image?: {
                  url?: string | null;
                } | null;
              } | null;
            }>;
          } | null;
        }>;
      } | null;
    } | null;
  }>(
    `
      query MegaskaCustomerDashboard($id: ID!) {
        customer(id: $id) {
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
            zip
            country
            phone
          }
          orders(first: 5, sortKey: PROCESSED_AT, reverse: true) {
            nodes {
              id
              name
              processedAt
              displayFinancialStatus
              displayFulfillmentStatus
              statusPageUrl
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              lineItems(first: 5) {
                nodes {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  image {
                    url
                  }
                  product {
                    title
                    featuredImage {
                      url
                    }
                  }
                  variant {
                    title
                    sku
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    { id: customerGid },
    options
  );

  console.log("[SHOPIFY DASHBOARD] raw customer result", {
    customerGid,
    shopDomain: input.shopDomain || null,
    foundCustomer: Boolean(data.customer),
    email: data.customer?.email || null,
    phone: data.customer?.phone || null,
    numberOfOrders: data.customer?.numberOfOrders ?? null,
    recentOrdersCount: data.customer?.orders?.nodes?.length ?? null,
  });

  const customer = data.customer;
  if (!customer) return null;

  const totalOrderCountRaw = customer.numberOfOrders;
  const totalOrderCount =
    typeof totalOrderCountRaw === "number"
      ? totalOrderCountRaw
      : Number.parseInt(String(totalOrderCountRaw || "0"), 10) || 0;

  const mappedRecentOrders = (customer.orders?.nodes || []).map((order) => {
    const firstLine = order.lineItems?.nodes?.[0] || null;
    const productTitle =
      firstLine?.product?.title ||
      firstLine?.title ||
      order.name ||
      "Order";
    const variantTitle =
      firstLine?.variant?.title ||
      firstLine?.variantTitle ||
      null;
    const sku = firstLine?.variant?.sku || firstLine?.sku || null;
    const image =
      firstLine?.variant?.image?.url ||
      firstLine?.image?.url ||
      firstLine?.product?.featuredImage?.url ||
      null;

    return {
      id: order.id,
      shopifyOrderId: order.id,
      name: String(order.name || "").trim(),
      processedAt: order.processedAt || null,
      totalAmount: order.currentTotalPriceSet?.shopMoney?.amount || null,
      currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode || null,
      financialStatus: order.displayFinancialStatus || null,
      fulfillmentStatus: order.displayFulfillmentStatus || null,
      deliveredAt: order.processedAt || null,
      statusPageUrl: order.statusPageUrl || null,
      displayTitle: String(productTitle || "Order").trim() || "Order",
      displayImage: image,
      itemsCount: order.lineItems?.nodes?.length || null,
      firstLineItemId: firstLine?.id || null,
      firstLineItemTitle: productTitle || null,
      firstLineItemVariantTitle: variantTitle,
      firstLineItemSku: sku,
    };
  });

  console.log("[DEBUG ORDERS RAW]", {
    customerGid,
    totalOrderCount,
    mappedRecentOrdersCount: mappedRecentOrders.length,
    firstOrder: mappedRecentOrders[0] || null,
  });

  return {
    email: customer.email || null,
    phone: customer.phone || null,
    defaultAddress: customer.defaultAddress || null,
    totalOrderCount,
    recentOrders: mappedRecentOrders,
  };
}
export async function findOrCreateShopifyCustomer(
  input: ShopifyCustomerSyncInput
): Promise<ShopifyCustomerSyncResult> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phoneE164);

  if (email) {
    const existingByEmail = await findCustomerByQuery(`email:${email}`);
    if (existingByEmail?.id) {
      return {
        shopifyCustomerId: parseCustomerId(existingByEmail.id),
        source: "existing",
        matchedBy: "email",
      };
    }
  }

  if (phone) {
    const existingByPhone = await findCustomerByQuery(`phone:${phone}`);
    if (existingByPhone?.id) {
      return {
        shopifyCustomerId: parseCustomerId(existingByPhone.id),
        source: "existing",
        matchedBy: "phone",
      };
    }
  }

  const created = await createCustomer({
    fullName: input.fullName,
    email,
    phoneE164: phone,
  });

  return {
    shopifyCustomerId: parseCustomerId(created.id),
    source: "created",
  };
}

type GstSyncOrderNode = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  subtotalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;
  totalTaxSet?: { shopMoney?: { amount?: string | null } | null } | null;
  totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
  customer?: { firstName?: string | null; lastName?: string | null } | null;
  shippingAddress?: { provinceCode?: string | null } | null;
  billingAddress?: { provinceCode?: string | null } | null;
  lineItems?: {
    nodes?: Array<{
      id: string;
      title?: string | null;
      sku?: string | null;
      quantity?: number | null;
      discountedUnitPriceAfterAllDiscountsSet?: { shopMoney?: { amount?: string | null } | null } | null;
      product?: { id?: string | null } | null;
      variant?: { id?: string | null } | null;
    }>;
  } | null;
};

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
    financialStatus: String(node.displayFinancialStatus || "").trim() || null,
    fulfillmentStatus: String(node.displayFulfillmentStatus || "").trim() || null,
    currency: String(node.subtotalPriceSet?.shopMoney?.currencyCode || "INR"),
    subtotalPrice: Number(node.subtotalPriceSet?.shopMoney?.amount || 0),
    totalTax: Number(node.totalTaxSet?.shopMoney?.amount || 0),
    totalPrice: Number(node.totalPriceSet?.shopMoney?.amount || 0),
    shippingStateCode: node.shippingAddress?.provinceCode || null,
    billingStateCode: node.billingAddress?.provinceCode || null,
    customerName: [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(" ").trim() || null,
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
}) {
  const filters = [`created_at:>=${input.from.toISOString()}`, `created_at:<=${input.to.toISOString()}`];
  if ((input.financialStatus || []).length) {
    filters.push(`(financial_status:${input.financialStatus?.map((s) => s.toLowerCase()).join(" OR financial_status:")})`);
  }
  if ((input.fulfillmentStatus || []).length) {
    filters.push(`(fulfillment_status:${input.fulfillmentStatus?.map((s) => s.toLowerCase()).join(" OR fulfillment_status:")})`);
  }

  const data = await adminGraphql<{ orders: { nodes: GstSyncOrderNode[] } }>(
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
            customer { firstName lastName }
            shippingAddress { provinceCode }
            billingAddress { provinceCode }
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
    { query: filters.join(" ") }
  );

  return (data.orders.nodes || []).map(normalizeGstSyncOrder);
}

export async function getSingleShopifyOrderForGstSync(orderNameOrNumber: string) {
  const key = String(orderNameOrNumber || "").trim();
  if (!key) return null;
  const query = key.startsWith("#") ? `name:${key}` : `name:#${key.replace(/^#/, "")}`;
  const data = await adminGraphql<{ orders: { nodes: GstSyncOrderNode[] } }>(
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
            customer { firstName lastName }
            shippingAddress { provinceCode }
            billingAddress { provinceCode }
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
    { query }
  );

  const node = data.orders.nodes[0];
  return node ? normalizeGstSyncOrder(node) : null;
}

export async function setOrderMegaskaIdentityMetafields(
  input: OrderMegaskaIdentityInput,
  options?: AdminRequestOptions
) {
  const ownerId = resolveOrderGid(input.orderId);

  const entries = [
    { key: "verified_phone", value: String(input.verifiedPhone || "").trim() },
    { key: "phone_verified", value: input.phoneVerified ? "true" : "false" },
    { key: "auth_source", value: String(input.authSource || "otp").trim() },
    { key: "customer_profile_id", value: String(input.customerProfileId || "").trim() },
    { key: "shopify_customer_id", value: String(input.shopifyCustomerId || "").trim() },
    {
      key: "verification_completed_at",
      value: String(input.verificationCompletedAt || "").trim(),
    },
    { key: "phone_match_status", value: String(input.phoneMatchStatus || "").trim() },
    { key: "original_checkout_phone", value: String(input.originalCheckoutPhone || "").trim() },
    { key: "corrected_order_phone", value: String(input.correctedOrderPhone || "").trim() },
    {
      key: "phone_corrected",
      value: typeof input.phoneCorrected === "boolean" ? (input.phoneCorrected ? "true" : "false") : "",
    },
    { key: "order_contact_email", value: String(input.orderContactEmail || "").trim() },
    {
      key: "mismatch_detected",
      value: typeof input.mismatchDetected === "boolean" ? (input.mismatchDetected ? "true" : "false") : "",
    },
    {
      key: "correction_attempted",
      value: typeof input.correctionAttempted === "boolean" ? (input.correctionAttempted ? "true" : "false") : "",
    },
    { key: "correction_error", value: String(input.correctionError || "").trim() },
  ].filter((entry) => entry.value);

  const metafields = entries.map((entry) => ({
    ownerId,
    namespace: "megaska",
    key: entry.key,
    type: "single_line_text_field",
    value: entry.value,
  }));

  const data = await adminGraphql<{
    metafieldsSet: {
      metafields: Array<{ id: string; key: string; namespace: string }>;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation SetMegaskaOrderIdentity($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { metafields },
    options
  );

  const tagsToAdd: string[] = [];
  if (input.phoneMatchStatus === "match") {
    tagsToAdd.push("MEGASKA_PHONE_VERIFIED");
  }
  if (input.mismatchDetected) {
    tagsToAdd.push("MEGASKA_PHONE_MISMATCH");
  }
  if (input.phoneCorrected) {
    tagsToAdd.push("MEGASKA_PHONE_CORRECTED");
  }

  const tagsResult = await setOrderTags({
    orderId: input.orderId,
    tags: tagsToAdd,
  }, options);

  return {
    metafields: data.metafieldsSet.metafields,
    userErrors: [...data.metafieldsSet.userErrors, ...tagsResult.userErrors],
    tags: tagsResult.node?.tags || [],
  };
}


export async function createWalletReservationDiscountCode(input: {
  reservationId: string;
  amountMinor: number;
  currency: string;
  customerProfileId: string;
  endsAt: Date;
}) {
  const amount = (Math.max(0, input.amountMinor) / 100).toFixed(2);
  const code = `MWR-${input.reservationId.slice(0, 8).toUpperCase()}`;
  const startsAt = new Date().toISOString();
  const basicCodeDiscount = {
    title: `Megaska Wallet ${input.reservationId}`,
    code,
    startsAt,
    endsAt: input.endsAt.toISOString(),
    context: {
      all: "ALL",
    },
    customerGets: {
      value: {
        discountAmount: {
          amount,
          appliesOnEachItem: false,
        },
      },
      items: {
        all: true,
      },
    },
    appliesOncePerCustomer: true,
    usageLimit: 1,
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: true,
      shippingDiscounts: false,
    },
  };

  console.log("[SHOPIFY ADMIN] wallet discount create input", {
    reservationId: input.reservationId,
    customerProfileId: input.customerProfileId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    code,
    startsAt,
    endsAt: input.endsAt.toISOString(),
    context: "ALL",
  });

  console.log("[SHOPIFY ADMIN] wallet discount amount semantics", {
    reservationId: input.reservationId,
    amountMinor: input.amountMinor,
    computedAmountString: amount,
    currency: input.currency,
    customerGetsValueShape: "discountAmount",
    appliesOnEachItem: false,
    itemsScope: "all",
  });

  console.log("[SHOPIFY ADMIN] wallet discount payload summary", {
    title: basicCodeDiscount.title,
    code: basicCodeDiscount.code,
    startsAt: basicCodeDiscount.startsAt,
    endsAt: basicCodeDiscount.endsAt,
    context: basicCodeDiscount.context,
    customerGets: basicCodeDiscount.customerGets,
    appliesOncePerCustomer: basicCodeDiscount.appliesOncePerCustomer,
    usageLimit: basicCodeDiscount.usageLimit,
    combinesWith: basicCodeDiscount.combinesWith,
  });

  const data = await adminGraphql<{
    discountCodeBasicCreate: {
      codeDiscountNode?: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation CreateMegaskaWalletDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      basicCodeDiscount,
    }
  );

  if (data.discountCodeBasicCreate.userErrors.length) {
    console.error("[SHOPIFY ADMIN] wallet discount create userErrors", {
      reservationId: input.reservationId,
      code,
      userErrors: data.discountCodeBasicCreate.userErrors,
    });
  }

  const error = data.discountCodeBasicCreate.userErrors[0]?.message;
  if (error) throw new Error(error);

  const nodeId = String(data.discountCodeBasicCreate.codeDiscountNode?.id || "").trim();
  if (!nodeId) throw new Error("Shopify wallet discount creation failed");

  console.log("[SHOPIFY ADMIN] wallet discount create success", {
    reservationId: input.reservationId,
    discountNodeId: nodeId,
    code,
    computedAmountString: amount,
  });

  return {
    code,
    discountNodeId: nodeId,
  };
}

export async function disableWalletReservationDiscountCode(discountNodeId: string) {
  const id = String(discountNodeId || "").trim();
  if (!id) return { ok: true, skipped: true };

  const data = await adminGraphql<{
    discountCodeDeactivate: {
      codeDiscountNode?: { id: string } | null;
      userErrors: Array<{ message: string; field?: string[] }>;
    };
  }>(
    `
      mutation DisableMegaskaWalletDiscount($id: ID!) {
        discountCodeDeactivate(id: $id) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { id }
  );

  if (data.discountCodeDeactivate.userErrors.length) {
    console.error("[SHOPIFY ADMIN] wallet discount deactivate userErrors", {
      discountNodeId: id,
      userErrors: data.discountCodeDeactivate.userErrors,
    });
  }

  const error = data.discountCodeDeactivate.userErrors[0]?.message;
  if (error) throw new Error(error);

  return {
    ok: true,
    id: data.discountCodeDeactivate.codeDiscountNode?.id || id,
  };
}
