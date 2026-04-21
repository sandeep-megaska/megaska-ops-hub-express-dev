import { normalizeShopDomain, resolveShopConfig } from "./shop-resolver";
const SHOPIFY_API_VERSION = "2026-01";

type StorefrontGraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export type CartBuyerIdentityInput = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
};

export type CartBuyerIdentityUpdateResult = {
  ok: boolean;
  cartId?: string;
  checkoutUrl?: string;
  buyerIdentity?: {
    email?: string | null;
    phone?: string | null;
    customerId?: string | null;
  };
  userErrors: Array<{ field?: string[] | null; message: string }>;
  apiErrors: Array<{ message?: string }>;
};

export type CartAttributeUpdateResult = {
  ok: boolean;
  cartId?: string;
  checkoutUrl?: string;
  userErrors: Array<{ field?: string[] | null; message: string }>;
  apiErrors: Array<{ message?: string }>;
};

function normalizeCartId(raw: string | null | undefined) {
  return String(raw || "").trim();
}

function normalizeCartToken(raw: string | null | undefined) {
  return String(raw || "").trim();
}

function buildCartIdFromToken(tokenRaw: string) {
  const token = normalizeCartToken(tokenRaw);
  if (!token) return "";
  if (token.startsWith("gid://shopify/Cart/")) return token;
  return `gid://shopify/Cart/${token}`;
}

function isConfigured() {
  return Boolean(String(process.env.SHOPIFY_STORE_DOMAIN || "").trim() && String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim());
}

type StorefrontRequestOptions = {
  shopDomain?: string | null;
};

async function storefrontGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  options?: StorefrontRequestOptions
): Promise<StorefrontGraphqlEnvelope<T>> {
  const shopConfig = await resolveShopConfig(normalizeShopDomain(options?.shopDomain));
  const shopDomain = shopConfig.shopDomain;
  const token = shopConfig.storefrontAccessToken || String(process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || "").trim();

  if (!shopDomain || !token) {
    return {
      errors: [{ message: "Storefront API is not configured" }],
    };
  }

  const response = await fetch(`https://${shopDomain}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query,
      variables: variables || {},
    }),
  });

  if (!response.ok) {
    return {
      errors: [{ message: `Storefront API request failed (${response.status})` }],
    };
  }

  return (await response.json()) as StorefrontGraphqlEnvelope<T>;
}

export function isShopifyStorefrontConfigured() {
  return isConfigured();
}

export function resolveCartId(input: { cartId?: string | null; cartToken?: string | null }) {
  const directCartId = normalizeCartId(input.cartId);
  if (directCartId) return directCartId;
  return buildCartIdFromToken(input.cartToken || "");
}

export async function updateCartBuyerIdentity(input: {
  cartId?: string | null;
  cartToken?: string | null;
  buyerIdentity: CartBuyerIdentityInput;
  shopDomain?: string | null;
}): Promise<CartBuyerIdentityUpdateResult> {
  const resolvedCartId = resolveCartId({
    cartId: input.cartId,
    cartToken: input.cartToken,
  });

  if (!resolvedCartId) {
    return {
      ok: false,
      userErrors: [{ message: "Missing cart id/token for buyer identity update" }],
      apiErrors: [],
    };
  }

  const response = await storefrontGraphql<{
    cartBuyerIdentityUpdate?: {
      cart?: {
        id: string;
        checkoutUrl?: string | null;
        buyerIdentity?: {
          email?: string | null;
          phone?: string | null;
          customer?: {
            id?: string | null;
          } | null;
        } | null;
      } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    `
      mutation MegaskaCartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
        cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
          cart {
            id
            checkoutUrl
            buyerIdentity {
              email
              phone
              customer {
                id
              }
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
      cartId: resolvedCartId,
      buyerIdentity: {
        email: input.buyerIdentity.email || undefined,
        phone: input.buyerIdentity.phone || undefined,
        deliveryAddressPreferences: [
          {
            deliveryAddress: {
              firstName: input.buyerIdentity.firstName || undefined,
              lastName: input.buyerIdentity.lastName || undefined,
              address1: input.buyerIdentity.address1 || undefined,
              address2: input.buyerIdentity.address2 || undefined,
              city: input.buyerIdentity.city || undefined,
              province: input.buyerIdentity.province || undefined,
              zip: input.buyerIdentity.zip || undefined,
              country: input.buyerIdentity.country || undefined,
            },
          },
        ],
      },
    }
  , { shopDomain: input.shopDomain });

  return {
    ok: Boolean(
      response.data?.cartBuyerIdentityUpdate?.cart?.id &&
        !(response.data?.cartBuyerIdentityUpdate?.userErrors?.length || 0) &&
        !(response.errors?.length || 0)
    ),
    cartId: response.data?.cartBuyerIdentityUpdate?.cart?.id || resolvedCartId,
    checkoutUrl: response.data?.cartBuyerIdentityUpdate?.cart?.checkoutUrl || undefined,
    buyerIdentity: {
      email: response.data?.cartBuyerIdentityUpdate?.cart?.buyerIdentity?.email || null,
      phone: response.data?.cartBuyerIdentityUpdate?.cart?.buyerIdentity?.phone || null,
      customerId:
        response.data?.cartBuyerIdentityUpdate?.cart?.buyerIdentity?.customer?.id || null,
    },
    userErrors: response.data?.cartBuyerIdentityUpdate?.userErrors || [],
    apiErrors: response.errors || [],
  };
}

export async function updateCartAttributes(input: {
  cartId?: string | null;
  cartToken?: string | null;
  attributes: Array<{ key: string; value: string }>;
  shopDomain?: string | null;
}): Promise<CartAttributeUpdateResult> {
  const resolvedCartId = resolveCartId({
    cartId: input.cartId,
    cartToken: input.cartToken,
  });

  if (!resolvedCartId) {
    return {
      ok: false,
      userErrors: [{ message: "Missing cart id/token for cart attribute update" }],
      apiErrors: [],
    };
  }

  const attributes = (input.attributes || [])
    .map((entry) => ({
      key: String(entry?.key || "").trim(),
      value: String(entry?.value || "").trim(),
    }))
    .filter((entry) => entry.key);

  if (!attributes.length) {
    return {
      ok: true,
      cartId: resolvedCartId,
      userErrors: [],
      apiErrors: [],
    };
  }

  const response = await storefrontGraphql<{
    cartAttributesUpdate?: {
      cart?: {
        id: string;
        checkoutUrl?: string | null;
      } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    `
      mutation MegaskaCartAttributesUpdate($cartId: ID!, $attributes: [AttributeInput!]!) {
        cartAttributesUpdate(cartId: $cartId, attributes: $attributes) {
          cart {
            id
            checkoutUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      cartId: resolvedCartId,
      attributes,
    }
  , { shopDomain: input.shopDomain });

  return {
    ok: Boolean(
      response.data?.cartAttributesUpdate?.cart?.id &&
        !(response.data?.cartAttributesUpdate?.userErrors?.length || 0) &&
        !(response.errors?.length || 0)
    ),
    cartId: response.data?.cartAttributesUpdate?.cart?.id || resolvedCartId,
    checkoutUrl: response.data?.cartAttributesUpdate?.cart?.checkoutUrl || undefined,
    userErrors: response.data?.cartAttributesUpdate?.userErrors || [],
    apiErrors: response.errors || [],
  };
}


export type CartPricingSnapshot = {
  ok: boolean;
  cartId?: string;
  currencyCode: string;
  subtotalAmount: number;
  totalAmount: number;
  checkoutUrl?: string;
  error?: string;
};

export async function getCartPricingSnapshot(cartId: string): Promise<CartPricingSnapshot> {
  const resolvedCartId = resolveCartId({ cartId });
  if (!resolvedCartId) {
    return {
      ok: false,
      currencyCode: "INR",
      subtotalAmount: 0,
      totalAmount: 0,
      error: "Missing cart id",
    };
  }

  const response = await storefrontGraphql<{
    cart?: {
      id: string;
      checkoutUrl?: string | null;
      cost?: {
        subtotalAmount?: { amount: string; currencyCode: string } | null;
        totalAmount?: { amount: string; currencyCode: string } | null;
      } | null;
    } | null;
  }>(
    `
      query MegaskaCartPricing($cartId: ID!) {
        cart(id: $cartId) {
          id
          checkoutUrl
          cost {
            subtotalAmount {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
          }
        }
      }
    `,
    { cartId: resolvedCartId }
  );

  const cart = response.data?.cart;
  if (!cart?.id) {
    return {
      ok: false,
      currencyCode: "INR",
      subtotalAmount: 0,
      totalAmount: 0,
      error: response.errors?.[0]?.message || "Cart not found",
    };
  }

  const subtotal = Number.parseFloat(String(cart.cost?.subtotalAmount?.amount || "0"));
  const total = Number.parseFloat(String(cart.cost?.totalAmount?.amount || "0"));
  const currencyCode = String(cart.cost?.subtotalAmount?.currencyCode || cart.cost?.totalAmount?.currencyCode || "INR");

  return {
    ok: true,
    cartId: cart.id,
    checkoutUrl: cart.checkoutUrl || undefined,
    currencyCode,
    subtotalAmount: Math.max(0, Math.round(subtotal * 100)),
    totalAmount: Math.max(0, Math.round(total * 100)),
  };
}

export async function attachCartDiscountCodes(input: {
  cartId?: string | null;
  cartToken?: string | null;
  discountCodes: string[];
}): Promise<CartAttributeUpdateResult> {
  const resolvedCartId = resolveCartId({
    cartId: input.cartId,
    cartToken: input.cartToken,
  });

  if (!resolvedCartId) {
    return {
      ok: false,
      userErrors: [{ message: "Missing cart id/token for discount update" }],
      apiErrors: [],
    };
  }

  const discountCodes = (input.discountCodes || []).map((code) => String(code || "").trim()).filter(Boolean);

  const response = await storefrontGraphql<{
    cartDiscountCodesUpdate?: {
      cart?: {
        id: string;
        checkoutUrl?: string | null;
      } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(
    `
      mutation MegaskaCartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]) {
        cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
          cart {
            id
            checkoutUrl
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      cartId: resolvedCartId,
      discountCodes,
    }
  );

  return {
    ok: Boolean(
      response.data?.cartDiscountCodesUpdate?.cart?.id &&
      !(response.data?.cartDiscountCodesUpdate?.userErrors?.length || 0) &&
      !(response.errors?.length || 0)
    ),
    cartId: response.data?.cartDiscountCodesUpdate?.cart?.id || resolvedCartId,
    checkoutUrl: response.data?.cartDiscountCodesUpdate?.cart?.checkoutUrl || undefined,
    userErrors: response.data?.cartDiscountCodesUpdate?.userErrors || [],
    apiErrors: response.errors || [],
  };
}
