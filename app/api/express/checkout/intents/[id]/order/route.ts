import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";
import { normalizeShopDomain, resolveShopConfig } from "../../../../../../../services/shopify/shop";

export const runtime = "nodejs";

const SHOPIFY_API_VERSION = "2026-01";
const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED", "ORDER_CREATING"];

type JsonRecord = Record<string, unknown>;

type DraftOrderCompletePayload = {
  draftOrderComplete?: {
    draftOrder?: {
      id?: string | null;
      name?: string | null;
      order?: {
        id?: string | null;
        name?: string | null;
        displayFinancialStatus?: string | null;
        displayFulfillmentStatus?: string | null;
      } | null;
    } | null;
    userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
  } | null;
};

type DraftOrderCreatePayload = {
  draftOrderCreate?: {
    draftOrder?: {
      id?: string | null;
      name?: string | null;
    } | null;
    userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
  } | null;
};

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";

  return bearerToken || queryToken;
}

function paiseToAmount(paise: number) {
  return (Math.max(0, Math.round(Number(paise) || 0)) / 100).toFixed(2);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function getCartLines(cartSnapshot: unknown) {
  const snapshot = asRecord(cartSnapshot);
  const candidates = Array.isArray(cartSnapshot)
    ? cartSnapshot
    : Array.isArray(snapshot?.lineItems)
      ? snapshot.lineItems
      : Array.isArray(snapshot?.items)
        ? snapshot.items
        : Array.isArray(snapshot?.lines)
          ? snapshot.lines
          : [];

  return candidates
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;

      const rawVariantId = String(
        record.variantId || record.shopifyVariantId || record.merchandiseId || ""
      ).trim();
      const quantity = Math.max(0, Math.floor(Number(record.quantity || 0)));

      if (!rawVariantId || quantity <= 0) return null;

      const variantId = rawVariantId.startsWith("gid://shopify/ProductVariant/")
        ? rawVariantId
        : `gid://shopify/ProductVariant/${rawVariantId.replace(/\D/g, "")}`;

      if (!variantId.endsWith(rawVariantId.replace(/\D/g, "")) && !rawVariantId.startsWith("gid://")) {
        return null;
      }

      return { variantId, quantity };
    })
    .filter(Boolean) as Array<{ variantId: string; quantity: number }>;
}

async function shopifyAdminGraphql<T>(shopDomain: string, query: string, variables: JsonRecord) {
  const shopConfig = await resolveShopConfig(shopDomain);
  const normalizedShopDomain = normalizeShopDomain(shopConfig.shopDomain || shopDomain);
  const accessToken = shopConfig.accessToken;

  if (!normalizedShopDomain || !accessToken) {
    throw new Error("Shopify Admin API is not configured");
  }

  const response = await fetch(
    `https://${normalizedShopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const rawText = await response.text().catch(() => "");
  const payload = rawText ? (JSON.parse(rawText) as { data?: T; errors?: Array<{ message?: string }> }) : null;

  if (!response.ok) throw new Error(`Shopify Admin API failed (${response.status})`);
  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join(", "));
  }
  if (!payload?.data) throw new Error("Shopify Admin API response missing data");

  return payload.data;
}

function userErrorMessage(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  return errors?.map((error) => error.message).filter(Boolean).join(", ") || "Shopify draft order error";
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const auth = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);

  if ("error" in auth) {
    return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  }

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) {
    return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });
  }

  const intent = await prisma.expressCheckoutIntent.findFirst({
    where: { shopId: shop.shopId, id: intentId, customerProfileId },
    include: {
      discounts: { orderBy: { createdAt: "desc" } },
      orderLink: true,
    },
  });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });

  if (intent.orderLink) {
    return jsonWithCors(req, { ok: true, intent, orderLink: intent.orderLink, shopifyOrder: null });
  }
  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot create order` }, { status: 409 });
  }
  if (intent.expiresAt && intent.expiresAt <= new Date()) {
    return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });
  }

  if (intent.selectedPaymentMethod !== "COD" && intent.selectedPaymentMethod !== "PREPAID") {
    return jsonWithCors(req, { ok: false, error: "Payment method required" }, { status: 400 });
  }

  if (intent.selectedPaymentMethod === "PREPAID") {
    if (intent.status !== "PAYMENT_CONFIRMED") {
      return jsonWithCors(req, { ok: false, error: "Payment confirmation required" }, { status: 409 });
    }

    const confirmedPayment = await prisma.expressCheckoutPayment.findFirst({
      where: { shopId: shop.shopId, intentId, method: "PREPAID", status: "CONFIRMED", intent: { customerProfileId } },
      orderBy: { createdAt: "desc" },
    });

    if (!confirmedPayment) {
      return jsonWithCors(req, { ok: false, error: "Confirmed prepaid payment required" }, { status: 409 });
    }
  }

  const address = await prisma.expressCheckoutAddressSnapshot.findFirst({
    where: { shopId: shop.shopId, intentId, customerProfileId },
    orderBy: { createdAt: "desc" },
  });

  if (!address) return jsonWithCors(req, { ok: false, error: "Address required" }, { status: 400 });

  const lineItems: JsonRecord[] = getCartLines(intent.cartSnapshot);
  if (!lineItems.length) {
    return jsonWithCors(req, { ok: false, error: "Cart line items required" }, { status: 400 });
  }

  if (intent.selectedPaymentMethod === "COD" && intent.codFeeAmountPaise > 0) {
    lineItems.push({ title: "COD Handling Charge", quantity: 1, originalUnitPrice: paiseToAmount(intent.codFeeAmountPaise) });
  }

  const discountAmount = Math.max(0, intent.discounts.reduce((sum, discount) => sum + discount.discountAmountPaise, 0));
  const shippingAddress = {
    firstName: address.name,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    country: address.country,
    zip: address.zip,
    phone: address.phone,
  };
  const customAttributes = [
    { key: "megaska_express_intent_id", value: intent.id },
    { key: "megaska_customer_profile_id", value: customerProfileId },
    { key: "megaska_payment_method", value: intent.selectedPaymentMethod },
    { key: "megaska_discount_snapshot", value: JSON.stringify(intent.discounts) },
  ];
  const draftOrderInput: JsonRecord = {
    lineItems,
    email: address.email || auth.customer.email || undefined,
    phone: address.phone || auth.customer.phoneE164 || undefined,
    shippingAddress,
    billingAddress: shippingAddress,
    customerId: auth.customer.shopifyCustomerId || undefined,
    note: `Megaska Express Checkout intent ${intent.id}`,
    tags: ["Megaska Express Checkout"],
    customAttributes,
    shippingLine: intent.shippingAmountPaise > 0 ? { title: "Shipping", price: paiseToAmount(intent.shippingAmountPaise) } : undefined,
    appliedDiscount:
      discountAmount > 0
        ? { title: "Express checkout discount", value: paiseToAmount(discountAmount), valueType: "FIXED_AMOUNT" }
        : undefined,
  };

  const lockResult = await prisma.expressCheckoutIntent.updateMany({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
      status: intent.status,
    },
    data: { status: "ORDER_CREATING" },
  });

  if (lockResult.count !== 1) {
    const existingLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });

    if (existingLink) {
      const refreshedIntent = await prisma.expressCheckoutIntent.findFirst({
        where: { shopId: shop.shopId, id: intentId, customerProfileId },
        include: { discounts: { orderBy: { createdAt: "desc" } }, orderLink: true },
      });

      return jsonWithCors(req, { ok: true, intent: refreshedIntent, orderLink: existingLink, shopifyOrder: null });
    }

    return jsonWithCors(req, { ok: false, error: "Order creation already in progress" }, { status: 409 });
  }

  try {
    const created = await shopifyAdminGraphql<DraftOrderCreatePayload>(
      shop.shopDomain,
      `mutation DraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name }
          userErrors { field message }
        }
      }`,
      { input: draftOrderInput }
    );

    const createResult = created.draftOrderCreate;
    if (createResult?.userErrors?.length || !createResult?.draftOrder?.id) {
      throw new Error(userErrorMessage(createResult?.userErrors));
    }

    const completed = await shopifyAdminGraphql<DraftOrderCompletePayload>(
      shop.shopDomain,
      `mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) {
        draftOrderComplete(id: $id, paymentPending: $paymentPending) {
          draftOrder {
            id
            name
            order { id name displayFinancialStatus displayFulfillmentStatus }
          }
          userErrors { field message }
        }
      }`,
      { id: createResult.draftOrder.id, paymentPending: intent.selectedPaymentMethod === "COD" }
    );

    const completeResult = completed.draftOrderComplete;
    if (completeResult?.userErrors?.length || !completeResult?.draftOrder?.order?.id) {
      throw new Error(userErrorMessage(completeResult?.userErrors));
    }

    const order = completeResult.draftOrder.order;
    let orderLink;
    let updatedIntent;

    try {
      const written = await prisma.$transaction(async (tx) => {
        const link = await tx.expressCheckoutOrderLink.create({
          data: {
            shopId: shop.shopId,
            intentId,
            draftOrderId: completeResult.draftOrder?.id || createResult.draftOrder?.id || null,
            draftOrderName: completeResult.draftOrder?.name || createResult.draftOrder?.name || null,
            shopifyOrderId: order.id || null,
            shopifyOrderName: order.name || null,
            financialStatus: order.displayFinancialStatus || (intent.selectedPaymentMethod === "COD" ? "PENDING" : "PAID"),
            fulfillmentStatus: order.displayFulfillmentStatus || null,
          },
        });
        await tx.expressCheckoutIntent.updateMany({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
          data: { status: "ORDER_CREATED" },
        });
        const refreshedIntent = await tx.expressCheckoutIntent.findFirst({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
        });

        return { link, refreshedIntent };
      });
      orderLink = written.link;
      updatedIntent = written.refreshedIntent;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "P2002") throw error;
      orderLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });
      updatedIntent = await prisma.expressCheckoutIntent.findFirst({
        where: { shopId: shop.shopId, id: intentId, customerProfileId },
      });
    }

    return jsonWithCors(req, { ok: true, intent: updatedIntent, orderLink, shopifyOrder: order }, { status: 201 });
  } catch (error) {
    await prisma.expressCheckoutIntent.updateMany({
      where: { shopId: shop.shopId, id: intentId, customerProfileId, status: "ORDER_CREATING" },
      data: { status: intent.status },
    });

    const message = error instanceof Error ? error.message : "Order creation failed";
    return jsonWithCors(req, { ok: false, error: message }, { status: 502 });
  }
}
