import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";
import {
  attachAddressSnapshotToIntent,
  customerProfileToExpressAddress,
  latestCustomerAddressSnapshot,
  saveCustomerProfileAddress,
} from "../../../../../../../services/express-checkout/address";
import {
  ShopifyAdminConfigError,
  shopifyAdminGraphql,
} from "../../../../../../../services/express-checkout/shopify-admin";
import { CHECKOUT_INTENT_STATUSES, CheckoutStateDb, transitionCheckoutIntent } from "../../../../../../../lib/express-checkout/state-machine";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED", "ORDER_COMPLETED"];

type JsonRecord = Record<string, unknown>;

const INDIAN_STATE_CODES: Record<string, string> = {
  KL: "Kerala",
};

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


const COD_STATE_ORDER = [
  "INITIATED",
  "SESSION_VERIFIED",
  "ADDRESS_COMPLETED",
  "DELIVERY_VALIDATED",
  "PAYMENT_SELECTED",
  "DRAFT_ORDER_CREATED",
  "ORDER_COMPLETED",
] as const;
const COD_LEGACY_STATUS_EQUIVALENTS: Record<string, (typeof COD_STATE_ORDER)[number]> = {
  CREATED: "INITIATED",
  CUSTOMER_AUTHENTICATED: "SESSION_VERIFIED",
  CART_SNAPSHOT_LOCKED: "SESSION_VERIFIED",
  ADDRESS_CAPTURED: "ADDRESS_COMPLETED",
  DISCOUNT_APPLIED: "ADDRESS_COMPLETED",
  PAYMENT_METHOD_SELECTED: "PAYMENT_SELECTED",
  ORDER_CREATED: "ORDER_COMPLETED",
};

async function transitionCodIntent(input: { intent: { id: string; shopId: string; status: string }; toStatus: (typeof COD_STATE_ORDER)[number]; reason: string; metadata?: Record<string, unknown> }) {
  const effectiveStatus = COD_LEGACY_STATUS_EQUIVALENTS[input.intent.status] || input.intent.status;
  const fromIndex = COD_STATE_ORDER.indexOf(effectiveStatus as (typeof COD_STATE_ORDER)[number]);
  const toIndex = COD_STATE_ORDER.indexOf(input.toStatus);

  if (input.intent.status === "EXPIRED") {
    return { ok: false as const, fromStatus: input.intent.status, toStatus: input.toStatus, reason: "terminal_state" as const };
  }

  if (fromIndex >= toIndex && fromIndex >= 0) {
    console.info("[CHECKOUT STATE] cod_transition_already_satisfied", { shopId: input.intent.shopId, intentId: input.intent.id, fromStatus: input.intent.status, effectiveStatus, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata || {} });
    return { ok: true as const, fromStatus: input.intent.status, toStatus: input.toStatus, changed: false };
  }

  if (!CHECKOUT_INTENT_STATUSES.includes(input.intent.status as (typeof CHECKOUT_INTENT_STATUSES)[number])) {
    return { ok: false as const, fromStatus: input.intent.status, toStatus: input.toStatus, reason: "invalid_transition" as const };
  }

  if (effectiveStatus !== input.intent.status) {
    console.info("[CHECKOUT STATE] cod_legacy_status_normalized", { shopId: input.intent.shopId, intentId: input.intent.id, fromStatus: input.intent.status, effectiveStatus, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata || {} });
    await (prisma as unknown as CheckoutStateDb).expressCheckoutIntent.updateMany({
      where: { id: input.intent.id, shopId: input.intent.shopId, status: input.intent.status },
      data: { status: effectiveStatus },
    });
    return transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: { ...input.intent, status: effectiveStatus }, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata });
  }

  return transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: input.intent, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata });
}

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function checkoutPerfLog(event: string, details: { shopId?: string; intentId?: string; customerProfileId?: string; selectedPaymentMethod?: unknown; durationMs?: number | null }) {
  console.info(`[CHECKOUT PERF] ${event}`, {
    shopId: details.shopId || null,
    intentId: details.intentId || null,
    customerProfileId: details.customerProfileId || null,
    selectedPaymentMethod: details.selectedPaymentMethod || null,
    durationMs: typeof details.durationMs === "number" ? Math.round(details.durationMs) : null,
  });
}

function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

function paiseToAmount(paise: number) {
  return (Math.max(0, Math.round(Number(paise) || 0)) / 100).toFixed(2);
}

function paiseToRupeeDisplay(paise: number) {
  const amount = Math.max(0, Math.round(Number(paise) || 0)) / 100;
  return `₹${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function cartSnapshotLines(cartSnapshot: unknown) {
  const snapshot = asRecord(cartSnapshot);
  if (Array.isArray(cartSnapshot)) return cartSnapshot;
  if (Array.isArray(snapshot?.lineItems) && snapshot.lineItems.length > 0) return snapshot.lineItems;
  if (Array.isArray(snapshot?.items) && snapshot.items.length > 0) return snapshot.items;
  if (Array.isArray(snapshot?.lines) && snapshot.lines.length > 0) return snapshot.lines;
  return [];
}

function normalizeVariantId(value: unknown) {
  const rawVariantId = String(value || "").trim();
  if (!rawVariantId) return "";

  const numericVariantId = rawVariantId.replace(/\D/g, "");
  if (rawVariantId.startsWith("gid://shopify/ProductVariant/")) return rawVariantId;
  return numericVariantId ? `gid://shopify/ProductVariant/${numericVariantId}` : "";
}

function toShopifyCustomerGid(customerId?: string | null) {
  if (!customerId) {
    return undefined;
  }

  if (customerId.startsWith("gid://shopify/Customer/")) {
    return customerId;
  }

  if (/^\d+$/.test(customerId)) {
    return `gid://shopify/Customer/${customerId}`;
  }

  return undefined;
}

function getCartLines(cartSnapshot: unknown) {
  const dedupedByVariantId = new Map<string, { variantId: string; quantity: number }>();

  for (const item of cartSnapshotLines(cartSnapshot)) {
    const record = asRecord(item);
    if (!record) continue;

    const variantId = normalizeVariantId(
      record.variantId || record.shopifyVariantId || record.merchandiseId || record.variant_id
    );
    const quantity = Math.max(0, Math.floor(Number(record.quantity || 0)));

    if (!variantId || quantity <= 0) continue;

    const existing = dedupedByVariantId.get(variantId);
    dedupedByVariantId.set(variantId, { variantId, quantity: (existing?.quantity || 0) + quantity });
  }

  return Array.from(dedupedByVariantId.values());
}

function normalizeShopifyUserErrors(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  return (errors || [])
    .map((error) => ({
      field: Array.isArray(error.field) ? error.field : undefined,
      message: String(error.message || "").trim(),
    }))
    .filter((error) => error.message);
}

function userErrorMessage(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  const normalized = normalizeShopifyUserErrors(errors);
  return normalized.map((error) => error.message).join(", ") || "Shopify draft order error";
}

function nameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || fullName.trim(), lastName: undefined };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
}

function normalizeProvince(province: string | null | undefined) {
  const value = String(province || "").trim();
  return INDIAN_STATE_CODES[value.toUpperCase()] || value;
}

function orderDiagnostic(input: { shopId: string; intentId: string; customerProfileId: string; intent?: { selectedPaymentMethod?: unknown; cartSnapshot?: unknown; subtotalAmountPaise?: number; discountAmountPaise?: number; shippingAmountPaise?: number; codFeeAmountPaise?: number; totalAmountPaise?: number; currency?: string } | null; lineItemCount?: number; hasAddressSnapshot?: boolean }) {
  const snapshot = asRecord(input.intent?.cartSnapshot);
  const fallbackCount = Array.isArray(snapshot?.lineItems) ? snapshot.lineItems.length : Array.isArray(snapshot?.items) ? snapshot.items.length : Array.isArray(snapshot?.lines) ? snapshot.lines.length : Array.isArray(input.intent?.cartSnapshot) ? input.intent.cartSnapshot.length : 0;
  return {
    shopId: input.shopId,
    intentId: input.intentId,
    customerProfileId: input.customerProfileId,
    selectedPaymentMethod: input.intent?.selectedPaymentMethod || null,
    lineItemCount: input.lineItemCount ?? fallbackCount,
    hasAddressSnapshot: Boolean(input.hasAddressSnapshot),
    subtotalAmountPaise: input.intent?.subtotalAmountPaise ?? null,
    discountAmountPaise: input.intent?.discountAmountPaise ?? null,
    shippingAmountPaise: input.intent?.shippingAmountPaise ?? null,
    codFeeAmountPaise: input.intent?.codFeeAmountPaise ?? null,
    totalAmountPaise: input.intent?.totalAmountPaise ?? null,
    currency: input.intent?.currency || null,
  };
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const totalStartedAt = Date.now();
  let perfContext: { shopId?: string; intentId?: string; customerProfileId?: string; selectedPaymentMethod?: unknown } = {};
  checkoutPerfLog("order_create_start", perfContext);

  const sessionStartedAt = Date.now();
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  perfContext.shopId = shop.shopId;

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);
  checkoutPerfLog("session_validation_ms", { ...perfContext, durationMs: elapsedMs(sessionStartedAt) });

  if ("error" in auth) {
    return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  }

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();
  perfContext = { ...perfContext, intentId, customerProfileId };

  if (!intentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) {
    return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });
  }

  const intentLoadStartedAt = Date.now();
  const intent = await prisma.expressCheckoutIntent.findFirst({
    where: { shopId: shop.shopId, id: intentId, customerProfileId },
    include: {
      discounts: { orderBy: { createdAt: "desc" } },
      orderLink: true,
    },
  });

  checkoutPerfLog("intent_load_ms", { ...perfContext, selectedPaymentMethod: intent?.selectedPaymentMethod, durationMs: elapsedMs(intentLoadStartedAt) });
  perfContext.selectedPaymentMethod = intent?.selectedPaymentMethod;

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });

  if (intent.status === "ORDER_COMPLETED") {
    console.info("[CHECKOUT STATE] draft_order_blocked_completed_intent", { shopId: shop.shopId, intentId, customerProfileId, hasOrderLink: Boolean(intent.orderLink) });
    if (intent.orderLink) return jsonWithCors(req, { ok: true, intent, orderLink: intent.orderLink, shopifyOrder: null });
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot create order` }, { status: 409 });
  }
  if (intent.status === "EXPIRED") {
    return jsonWithCors(req, { ok: false, error: "Checkout session expired. Please start checkout again." }, { status: 409 });
  }
  if (intent.orderLink?.draftOrderId) {
    console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: intent.orderLink.draftOrderId, hasShopifyOrder: Boolean(intent.orderLink.shopifyOrderId) });
    if (intent.orderLink.shopifyOrderId) return jsonWithCors(req, { ok: true, intent, orderLink: intent.orderLink, shopifyOrder: null });
  }
  if (intent.orderLink && !intent.orderLink.draftOrderId) {
    if (intent.selectedPaymentMethod === "COD") console.info("[CHECKOUT STATE] cod_duplicate_completion_ignored", { shopId: shop.shopId, intentId, customerProfileId, status: intent.status });
    return jsonWithCors(req, { ok: true, intent, orderLink: intent.orderLink, shopifyOrder: null });
  }
  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot create order` }, { status: 409 });
  }
  if (intent.expiresAt && intent.expiresAt <= new Date()) {
    return jsonWithCors(req, { ok: false, error: "Checkout session expired. Please start checkout again." }, { status: 409 });
  }

  if (intent.selectedPaymentMethod === "COD" && intent.status === "EXPIRED") {
    return jsonWithCors(req, { ok: false, error: "Checkout session expired. Please start checkout again." }, { status: 409 });
  }

  if (intent.selectedPaymentMethod !== "COD" && intent.selectedPaymentMethod !== "PREPAID") {
    return jsonWithCors(req, { ok: false, error: "Payment method required" }, { status: 400 });
  }

  if (!Number.isFinite(intent.totalAmountPaise) || intent.totalAmountPaise < 0) {
    return jsonWithCors(req, { ok: false, error: "Invalid order amount" }, { status: 400 });
  }

  if (intent.selectedPaymentMethod === "COD") {
    let status = intent.status;
    for (const [toStatus, reason] of [["SESSION_VERIFIED", "cod_session_verified"], ["ADDRESS_COMPLETED", "cod_address_completed"], ["DELIVERY_VALIDATED", "cod_delivery_validated"], ["PAYMENT_SELECTED", "cod_payment_selected"]] as const) {
      const transition = await transitionCodIntent({ intent: { id: intent.id, shopId: intent.shopId, status }, toStatus, reason, metadata: { source: "order_create" } });
      if (!transition.ok) return jsonWithCors(req, { ok: false, error: transition.reason === "terminal_state" ? "Checkout session expired. Please start checkout again." : `Intent status ${transition.fromStatus} cannot create order` }, { status: 409 });
      if (COD_STATE_ORDER.indexOf(status as (typeof COD_STATE_ORDER)[number]) < COD_STATE_ORDER.indexOf(toStatus)) status = toStatus;
    }
  }

  const paymentMethodStartedAt = Date.now();
  if (intent.selectedPaymentMethod === "PREPAID") {
    if (intent.status !== "PAYMENT_CONFIRMED") {
      return jsonWithCors(req, { ok: false, error: "Payment confirmation required" }, { status: 409 });
    }

    const confirmedPayment = await prisma.expressCheckoutPayment.findFirst({
      where: { shopId: shop.shopId, intentId, method: "PREPAID", status: "CONFIRMED" },
      orderBy: { createdAt: "desc" },
    });

    if (!confirmedPayment) {
      return jsonWithCors(req, { ok: false, error: "Confirmed prepaid payment required" }, { status: 409 });
    }
  }

  checkoutPerfLog("payment_method_ms", { ...perfContext, durationMs: elapsedMs(paymentMethodStartedAt) });

  const addressStartedAt = Date.now();
  let address = await prisma.expressCheckoutAddressSnapshot.findFirst({
    where: { shopId: shop.shopId, intentId, customerProfileId },
    orderBy: { createdAt: "desc" },
  });

  if (!address) {
    const customerAddress = customerProfileToExpressAddress(auth.customer);
    const fallbackAddress = customerAddress || await latestCustomerAddressSnapshot(prisma, { shopId: shop.shopId, customerProfileId });

    if (fallbackAddress) {
      address = await prisma.$transaction(async (tx) => {
        const snapshot = await attachAddressSnapshotToIntent(tx, {
          shopId: shop.shopId,
          intentId,
          customerProfileId,
          address: fallbackAddress,
        });
        if (!customerAddress) {
          await saveCustomerProfileAddress(tx, { shopId: shop.shopId, customerProfileId, address: fallbackAddress });
        }
        return snapshot;
      });
    }
  }

  checkoutPerfLog("address_snapshot_ms", { ...perfContext, durationMs: elapsedMs(addressStartedAt) });

  if (!address) return jsonWithCors(req, { ok: false, error: "Address required" }, { status: 400 });
  const missingAddressFields = [
    ["fullName", address.name],
    ["phone", address.phone],
    ["addressLine1", address.address1],
    ["city", address.city],
    ["state", address.province],
    ["postalCode", address.zip],
    ["country", address.country],
  ].filter(([, value]) => !String(value || "").trim()).map(([field]) => field);
  if (missingAddressFields.length) {
    return jsonWithCors(req, { ok: false, error: "Please complete the delivery address.", missingFields: missingAddressFields }, { status: 400 });
  }

  const lineItems: JsonRecord[] = getCartLines(intent.cartSnapshot);
  if (!lineItems.length) {
    return jsonWithCors(req, { ok: false, error: "Cart line items required", reason: "intent.cartSnapshot must include lineItems/items/lines with variantId or variant_id and quantity" }, { status: 400 });
  }

  // Keep COD fees in Megaska totals only for now. Shopify draftOrderCreate receives
  // only real product variants so draft creation can succeed reliably.

  const inputBuildStartedAt = Date.now();
  const discountAmount = Math.max(0, Math.min(intent.subtotalAmountPaise, intent.discountAmountPaise));
  const diagnostic = orderDiagnostic({ shopId: shop.shopId, intentId, customerProfileId, intent, lineItemCount: lineItems.length, hasAddressSnapshot: Boolean(address) });
  console.info("[EXPRESS CHECKOUT ORDER] creating draft order", diagnostic);
  const { firstName, lastName } = nameParts(address.name);
  const shippingAddress = {
    firstName,
    lastName,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: normalizeProvince(address.province),
    country: address.country,
    zip: address.zip,
    phone: address.phone,
  };
  const customAttributes = [
    { key: "megaska_express_intent_id", value: intent.id },
    { key: "megaska_customer_profile_id", value: customerProfileId },
    { key: "megaska_payment_method", value: intent.selectedPaymentMethod },
    { key: "megaska_discount_snapshot", value: JSON.stringify(intent.discounts) },
    ...(intent.selectedPaymentMethod === "COD" && intent.codFeeAmountPaise > 0
      ? [
          { key: "COD fee", value: paiseToRupeeDisplay(intent.codFeeAmountPaise) },
          { key: "COD payable total", value: paiseToRupeeDisplay(intent.totalAmountPaise) },
        ]
      : []),
  ];
  const email = address.email || auth.customer.email || undefined;
  const phone = address.phone || auth.customer.phoneE164 || undefined;
  const discount =
    discountAmount > 0
      ? { title: "Express checkout discount", value: paiseToAmount(discountAmount), valueType: "FIXED_AMOUNT" }
      : undefined;
  const rawCustomerId = auth.customer.shopifyCustomerId || undefined;
  const resolvedCustomerGid = toShopifyCustomerGid(rawCustomerId);
  const draftOrderInput: JsonRecord = {
    lineItems,
    email,
    phone,
    shippingAddress,
    billingAddress: shippingAddress,
    note: intent.selectedPaymentMethod === "COD" && intent.codFeeAmountPaise > 0
      ? `Megaska Express Checkout intent ${intent.id} | COD fee: ${paiseToRupeeDisplay(intent.codFeeAmountPaise)} | COD payable total: ${paiseToRupeeDisplay(intent.totalAmountPaise)}`
      : `Megaska Express Checkout intent ${intent.id}`,
    tags: ["Megaska Express Checkout"],
    customAttributes,
    shippingLine: intent.shippingAmountPaise > 0 ? { title: "Shipping", price: paiseToAmount(intent.shippingAmountPaise) } : undefined,
    appliedDiscount: discount,
  };

  if (resolvedCustomerGid) {
    draftOrderInput.customerId = resolvedCustomerGid;
  }
  checkoutPerfLog("draft_order_input_build_ms", { ...perfContext, durationMs: elapsedMs(inputBuildStartedAt) });

  try {
    const shopifyStartedAt = Date.now();
    const latestIntent = await prisma.expressCheckoutIntent.findFirst({
      where: { shopId: shop.shopId, id: intentId, customerProfileId },
      include: { orderLink: true },
    });
    if (!latestIntent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
    if (latestIntent.status === "ORDER_COMPLETED") {
      console.info("[CHECKOUT STATE] draft_order_blocked_completed_intent", { shopId: shop.shopId, intentId, customerProfileId, hasOrderLink: Boolean(latestIntent.orderLink) });
      if (latestIntent.orderLink) return jsonWithCors(req, { ok: true, intent: latestIntent, orderLink: latestIntent.orderLink, shopifyOrder: null });
      return jsonWithCors(req, { ok: false, error: `Intent status ${latestIntent.status} cannot create order` }, { status: 409 });
    }
    if (latestIntent.status === "EXPIRED") {
      return jsonWithCors(req, { ok: false, error: "Checkout session expired. Please start checkout again." }, { status: 409 });
    }
    let createResult: NonNullable<DraftOrderCreatePayload["draftOrderCreate"]> | null = null;
    let reusedDraftOrder = false;
    if (latestIntent.orderLink?.draftOrderId && latestIntent.orderLink.shopifyOrderId) {
      console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: latestIntent.orderLink.draftOrderId, hasShopifyOrder: Boolean(latestIntent.orderLink.shopifyOrderId) });
      return jsonWithCors(req, { ok: true, intent: latestIntent, orderLink: latestIntent.orderLink, shopifyOrder: null });
    }
    if (latestIntent.orderLink?.draftOrderId) {
      console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: latestIntent.orderLink.draftOrderId, hasShopifyOrder: false });
      createResult = { draftOrder: { id: latestIntent.orderLink.draftOrderId, name: latestIntent.orderLink.draftOrderName }, userErrors: [] };
      reusedDraftOrder = true;
    }

    if (!createResult) {
      console.info("[SHOPIFY CUSTOMER ID]", { rawCustomerId, resolvedCustomerGid });
      console.info("[SHOPIFY DRAFT ORDER INPUT]", { ...diagnostic, hasCustomerId: Boolean(resolvedCustomerGid), customAttributeCount: customAttributes.length });

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

      console.info("[SHOPIFY DRAFT ORDER RESPONSE]", JSON.stringify(created, null, 2));

      createResult = created.draftOrderCreate || null;
    }
    if (createResult?.userErrors?.length || !createResult?.draftOrder?.id) {
      const message = userErrorMessage(createResult?.userErrors);
      const userErrors = normalizeShopifyUserErrors(createResult?.userErrors);
      console.error("[SHOPIFY DRAFT ORDER USER ERRORS]", JSON.stringify(userErrors, null, 2));
      console.error("[EXPRESS CHECKOUT ORDER] Shopify draftOrderCreate userErrors", { ...diagnostic, shopifyUserErrors: userErrors, errorName: "ShopifyUserError", errorMessage: message });
      return jsonWithCors(
        req,
        { ok: false, error: "We could not place your order right now. Please try again." },
        { status: 422 }
      );
    }

    let draftOrderLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });
    if (!draftOrderLink) {
      try {
        draftOrderLink = await prisma.expressCheckoutOrderLink.create({
          data: {
            shopId: shop.shopId,
            intentId,
            draftOrderId: createResult.draftOrder.id,
            draftOrderName: createResult.draftOrder.name || null,
          },
        });
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        if (code !== "P2002") throw error;
        draftOrderLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });
      }
    }
    if (draftOrderLink?.draftOrderId !== createResult.draftOrder.id) {
      console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: draftOrderLink?.draftOrderId || null, hasShopifyOrder: Boolean(draftOrderLink?.shopifyOrderId) });
      const refreshedIntent = await prisma.expressCheckoutIntent.findFirst({ where: { shopId: shop.shopId, id: intentId, customerProfileId } });
      return jsonWithCors(req, { ok: true, intent: refreshedIntent, orderLink: draftOrderLink, shopifyOrder: null });
    }

    if (intent.selectedPaymentMethod === "COD" && !reusedDraftOrder) {
      const draftTransition = await transitionCodIntent({
        intent: { id: intent.id, shopId: intent.shopId, status: "PAYMENT_SELECTED" },
        toStatus: "DRAFT_ORDER_CREATED",
        reason: "cod_draft_order_created",
        metadata: { draftOrderId: createResult.draftOrder.id, draftOrderName: createResult.draftOrder.name || null },
      });
      if (!draftTransition.ok) return jsonWithCors(req, { ok: false, error: `Intent status ${draftTransition.fromStatus} cannot create order` }, { status: 409 });
    }
    if (!reusedDraftOrder) console.info("[CHECKOUT STATE] draft_order_created", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: createResult.draftOrder.id, draftOrderName: createResult.draftOrder.name || null });

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

    checkoutPerfLog("shopify_admin_api_ms", { ...perfContext, durationMs: elapsedMs(shopifyStartedAt) });

    const completeResult = completed.draftOrderComplete;
    if (completeResult?.userErrors?.length || !completeResult?.draftOrder?.order?.id) {
      const message = userErrorMessage(completeResult?.userErrors);
      const shopifyUserErrors = normalizeShopifyUserErrors(completeResult?.userErrors);
      console.error("[EXPRESS CHECKOUT ORDER] Shopify draftOrderComplete userErrors", { ...diagnostic, shopifyUserErrors, errorName: "ShopifyUserError", errorMessage: message });
      return jsonWithCors(req, { ok: false, error: "We could not place your order right now. Please try again." }, { status: 422 });
    }

    const order = completeResult.draftOrder.order;
    let orderLink;
    let updatedIntent;

    try {
      const persistStartedAt = Date.now();
      const written = await prisma.$transaction(async (tx) => {
        const link = await tx.expressCheckoutOrderLink.upsert({
          where: { shopId_intentId: { shopId: shop.shopId, intentId } },
          create: {
            shopId: shop.shopId,
            intentId,
            draftOrderId: completeResult.draftOrder?.id || createResult.draftOrder?.id || null,
            draftOrderName: completeResult.draftOrder?.name || createResult.draftOrder?.name || null,
            shopifyOrderId: order.id || null,
            shopifyOrderName: order.name || null,
            financialStatus: order.displayFinancialStatus || (intent.selectedPaymentMethod === "COD" ? "PENDING" : "PAID"),
            fulfillmentStatus: order.displayFulfillmentStatus || null,
          },
          update: {
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
          data: intent.selectedPaymentMethod === "COD" ? {} : { status: "ORDER_CREATED" },
        });
        const refreshedIntent = await tx.expressCheckoutIntent.findFirst({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
        });

        return { link, refreshedIntent };
      });
      orderLink = written.link;
      if (intent.selectedPaymentMethod === "COD") {
        const completeTransition = await transitionCodIntent({
          intent: { id: intent.id, shopId: intent.shopId, status: "DRAFT_ORDER_CREATED" },
          toStatus: "ORDER_COMPLETED",
          reason: "cod_order_completed",
          metadata: { shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, draftOrderId: completeResult.draftOrder?.id || createResult.draftOrder?.id || null },
        });
        if (!completeTransition.ok) return jsonWithCors(req, { ok: false, error: `Intent status ${completeTransition.fromStatus} cannot complete order` }, { status: 409 });
        updatedIntent = await prisma.expressCheckoutIntent.findFirst({ where: { shopId: shop.shopId, id: intentId, customerProfileId } });
      } else {
        updatedIntent = written.refreshedIntent;
      }
      checkoutPerfLog("order_persist_ms", { ...perfContext, durationMs: elapsedMs(persistStartedAt) });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "P2002") throw error;
      orderLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });
      updatedIntent = await prisma.expressCheckoutIntent.findFirst({
        where: { shopId: shop.shopId, id: intentId, customerProfileId },
      });
    }

    checkoutPerfLog("order_create_total_ms", { ...perfContext, durationMs: elapsedMs(totalStartedAt) });
    return jsonWithCors(req, { ok: true, intent: updatedIntent, orderLink, shopifyOrder: order }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order creation failed";
    const name = error instanceof Error ? error.name : "UnknownError";
    const stack = error instanceof Error ? error.stack : undefined;
    const status = error instanceof ShopifyAdminConfigError ? error.status : 502;
    console.error("[SHOPIFY DRAFT ORDER EXCEPTION]", {
      name,
      message,
      stack,
    });
    console.error("[EXPRESS CHECKOUT ORDER] draft order failed", { ...diagnostic, errorName: name, errorMessage: message, errorStack: stack });
    return jsonWithCors(
      req,
      status === 502
        ? { ok: false, error: "We could not place your order right now. Please try again." }
        : { ok: false, error: "We could not place your order right now. Please try again." },
      { status }
    );
  }
}
