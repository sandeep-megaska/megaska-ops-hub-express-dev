import crypto from "crypto";
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
import { CHECKOUT_INTENT_EXPIRY_MESSAGE, markCheckoutIntentExpiredIfNeeded } from "../../../../../../../lib/express-checkout/expiry";
import { consumeStoreCreditReservationForOrder, getActiveStoreCreditReservation, releaseStoreCreditReservation } from "../../../../../../../services/express-checkout/store-credit";

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

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


type ExpressOrderLinkWriteClient = {
  expressCheckoutOrderLink: {
    findFirst(args: unknown): Promise<{ id: string; shopifyOrderId?: string | null } | null>;
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
};

async function writeExpressCheckoutOrderLink(client: ExpressOrderLinkWriteClient, input: {
  shopId: string;
  intentId: string;
  data: Record<string, unknown>;
}) {
  const where = { shopId: input.shopId, intentId: input.intentId };
  const existing = await client.expressCheckoutOrderLink.findFirst({ where });
  if (existing?.shopifyOrderId) return existing;
  if (existing) {
    return client.expressCheckoutOrderLink.update({
      where: { id: existing.id },
      data: input.data,
    });
  }

  try {
    return await client.expressCheckoutOrderLink.create({
      data: {
        shopId: input.shopId,
        intentId: input.intentId,
        ...input.data,
      },
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;

    const raced = await client.expressCheckoutOrderLink.findFirst({ where });
    if (raced?.shopifyOrderId) return raced;
    if (raced) {
      return client.expressCheckoutOrderLink.update({
        where: { id: raced.id },
        data: input.data,
      });
    }
    throw error;
  }
}

function databaseUrlFingerprint() {
  const value = process.env.DATABASE_URL || "";
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function logCheckoutConflictDiagnostics(context: { shopId: string; intentId: string; customerProfileId: string; phase: string }) {
  const deployment = {
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    nodeEnv: process.env.NODE_ENV || null,
  };
  try {
    const dbRows = await prisma.$queryRaw<Array<{ database: string; schema: string; serverAddress: string | null; serverPort: number | null; userName: string; dbUrlFingerprint: string | null }>>`
      SELECT current_database() AS "database", current_schema() AS "schema", inet_server_addr()::text AS "serverAddress", inet_server_port() AS "serverPort", current_user AS "userName", ${databaseUrlFingerprint()} AS "dbUrlFingerprint"
    `;
    const indexRows = await prisma.$queryRaw<Array<{ tableName: string; indexName: string; indexDefinition: string }>>`
      SELECT tablename AS "tableName", indexname AS "indexName", indexdef AS "indexDefinition"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('ExpressCheckoutOrderLink', 'WalletTransaction', 'WalletAccount')
      ORDER BY tablename, indexname
    `;
    console.info("[ORDER LINK WRITE] runtime_database_and_indexes", { ...context, deployment, database: dbRows[0] || null, indexes: indexRows });
  } catch (error) {
    console.error("[ORDER LINK WRITE] runtime_database_and_indexes_failed", { ...context, deployment, dbUrlFingerprint: databaseUrlFingerprint(), error: error instanceof Error ? error.message : String(error) });
  }
}

function logOrderLinkWriteAttempt(context: { shopId: string; intentId: string; customerProfileId: string; table: string; conflictTarget: string[]; operation: string; phase: string }) {
  console.info("[ORDER LINK WRITE] explicit_find_update_create", context);
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

function paiseToAmountNumber(paise: number) {
  return Math.max(0, Math.round(Number(paise) || 0)) / 100;
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

function hasAlreadyPaidUserError(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  return normalizeShopifyUserErrors(errors).some((error) => /order has been paid/i.test(error.message));
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
    if (intent.orderLink) return jsonWithCors(req, { ok: false, intentId, error: "Order already completed for this checkout intent; a fresh completion was not performed.", code: "stale_order_link", freshCompletion: false, recovery: true }, { status: 409 });
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot create order` }, { status: 409 });
  }
  if (intent.status === "EXPIRED" || await markCheckoutIntentExpiredIfNeeded(intent)) {
    return jsonWithCors(req, { ok: false, error: CHECKOUT_INTENT_EXPIRY_MESSAGE }, { status: 409 });
  }
  if (intent.orderLink?.draftOrderId) {
    console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: intent.orderLink.draftOrderId, hasShopifyOrder: Boolean(intent.orderLink.shopifyOrderId) });
    if (intent.orderLink.shopifyOrderId) return jsonWithCors(req, { ok: false, intentId, error: "Order already exists for this checkout intent; a fresh completion was not performed.", code: "stale_order_link", freshCompletion: false, recovery: true }, { status: 409 });
  }
  if (intent.orderLink && !intent.orderLink.draftOrderId) {
    if (intent.selectedPaymentMethod === "COD") console.info("[CHECKOUT STATE] cod_duplicate_completion_ignored", { shopId: shop.shopId, intentId, customerProfileId, status: intent.status });
    return jsonWithCors(req, { ok: false, intentId, error: "Order link exists without a fresh completion; please retry checkout.", code: "stale_order_link", freshCompletion: false, recovery: true }, { status: 409 });
  }
  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot create order` }, { status: 409 });
  }

  const storeCreditReservation = await getActiveStoreCreditReservation({ shopId: shop.shopId, customerProfileId, checkoutIntentId: intentId });
  const storeCreditAmountPaise = Math.min(Number(storeCreditReservation?.reservedAmount || 0), Math.max(0, Number(intent.totalAmountPaise || 0)));
  const remainingPayablePaise = Math.max(0, Number(intent.totalAmountPaise || 0) - storeCreditAmountPaise);
  const isStoreCreditFullCoverage = storeCreditAmountPaise > 0 && remainingPayablePaise === 0;

  if (intent.selectedPaymentMethod === "COD") {
    console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_start", { shopId: shop.shopId, intentId, customerProfileId, intentStatus: intent.status, selectedPaymentMethod: intent.selectedPaymentMethod, remainingPayablePaise });
  }

  if (!isStoreCreditFullCoverage && intent.selectedPaymentMethod !== "COD" && intent.selectedPaymentMethod !== "PREPAID") {
    return jsonWithCors(req, { ok: false, error: "Payment method required", code: "payment_method_not_cod" }, { status: 400 });
  }

  if (!Number.isFinite(intent.totalAmountPaise) || intent.totalAmountPaise < 0) {
    return jsonWithCors(req, { ok: false, error: "Invalid order amount" }, { status: 400 });
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

  if (!address) {
    if (intent.selectedPaymentMethod === "COD") console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "address", intentStatus: intent.status });
    return jsonWithCors(req, intent.selectedPaymentMethod === "COD" ? { ok: false, error: "Please select delivery address", code: "missing_address" } : { ok: false, error: "Please select delivery address" }, { status: intent.selectedPaymentMethod === "COD" ? 409 : 400 });
  }
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
    if (intent.selectedPaymentMethod === "COD") console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "address_fields", missingFields: missingAddressFields, intentStatus: intent.status });
    return jsonWithCors(req, intent.selectedPaymentMethod === "COD" ? { ok: false, error: "Please complete the delivery address.", code: "missing_address", missingFields: missingAddressFields } : { ok: false, error: "Please complete the delivery address.", missingFields: missingAddressFields }, { status: intent.selectedPaymentMethod === "COD" ? 409 : 400 });
  }

  const lineItems: JsonRecord[] = getCartLines(intent.cartSnapshot);
  if (!lineItems.length) {
    if (intent.selectedPaymentMethod === "COD") console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "cart_snapshot", intentStatus: intent.status });
    return jsonWithCors(req, intent.selectedPaymentMethod === "COD" ? { ok: false, error: "Cart line items required", code: "missing_cart_snapshot", reason: "intent.cartSnapshot must include lineItems/items/lines with variantId or variant_id and quantity" } : { ok: false, error: "Cart line items required", reason: "intent.cartSnapshot must include lineItems/items/lines with variantId or variant_id and quantity" }, { status: intent.selectedPaymentMethod === "COD" ? 409 : 400 });
  }

  if (intent.selectedPaymentMethod === "COD") {
    const confirmedPayment = await prisma.expressCheckoutPayment.findFirst({
      where: { shopId: shop.shopId, intentId, status: "CONFIRMED" },
      orderBy: { createdAt: "desc" },
    });

    if (confirmedPayment) {
      console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "verified_payment_absent", intentStatus: intent.status });
      return jsonWithCors(req, { ok: false, error: "COD order cannot be created after a verified payment.", code: "verified_payment_exists" }, { status: 409 });
    }

    console.info("[EXPRESS CHECKOUT ORDER] cod_order_readiness_satisfied", {
      shopId: shop.shopId,
      intentId,
      customerProfileId,
      intentStatus: intent.status,
      selectedPaymentMethod: intent.selectedPaymentMethod,
      lineItemCount: lineItems.length,
      hasAddressSnapshot: Boolean(address),
      pincodeConfirmed: Boolean(String(address.zip || "").trim()),
    });
  }

  // Keep COD fees in Megaska totals only for now. Shopify draftOrderCreate receives
  // only real product variants so draft creation can succeed reliably.

  const inputBuildStartedAt = Date.now();
  const discountAmount = Math.max(0, Math.min(intent.subtotalAmountPaise + intent.shippingAmountPaise, intent.discountAmountPaise + storeCreditAmountPaise));
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
    { key: "megaska_payment_method", value: isStoreCreditFullCoverage ? "STORE_CREDIT" : intent.selectedPaymentMethod },
    { key: "megaska_discount_snapshot", value: JSON.stringify(intent.discounts) },
    ...(storeCreditAmountPaise > 0 ? [
      { key: "store_credit_applied", value: "true" },
      { key: "store_credit_amount", value: String(storeCreditAmountPaise) },
      { key: "wallet_reservation_id", value: storeCreditReservation?.id || "" },
      { key: "checkout_intent_id", value: intent.id },
    ] : []),
    ...(intent.selectedPaymentMethod === "COD" && intent.codFeeAmountPaise > 0
      ? [
          { key: "COD fee", value: paiseToRupeeDisplay(intent.codFeeAmountPaise) },
          { key: "COD payable total", value: paiseToRupeeDisplay(intent.totalAmountPaise) },
        ]
      : []),
  ];
  const email = address.email || auth.customer.email || undefined;
  const phone = address.phone || auth.customer.phoneE164 || undefined;
  const discountValue = Number(paiseToAmountNumber(discountAmount));
  const discount = Number.isFinite(discountValue) && discountValue > 0
    ? { title: "Express checkout discount", value: discountValue, valueType: "FIXED_AMOUNT" }
    : undefined;
  const rawCustomerId = auth.customer.shopifyCustomerId || undefined;
  const resolvedCustomerGid = toShopifyCustomerGid(rawCustomerId);
  const draftOrderInput: JsonRecord = {
    lineItems,
    email,
    phone,
    shippingAddress,
    billingAddress: shippingAddress,
    note: storeCreditAmountPaise > 0
      ? `Megaska Express Checkout intent ${intent.id} | Megaska Store Credit: ${paiseToRupeeDisplay(storeCreditAmountPaise)} | Remaining payable: ${paiseToRupeeDisplay(remainingPayablePaise)}`
      : intent.selectedPaymentMethod === "COD" && intent.codFeeAmountPaise > 0
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
      if (latestIntent.orderLink) return jsonWithCors(req, { ok: false, intentId, error: "Order already completed for this checkout intent; a fresh completion was not performed.", code: "stale_order_link", freshCompletion: false, recovery: true }, { status: 409 });
      return jsonWithCors(req, { ok: false, error: `Intent status ${latestIntent.status} cannot create order` }, { status: 409 });
    }
    if (latestIntent.status === "EXPIRED" || await markCheckoutIntentExpiredIfNeeded(latestIntent)) {
      return jsonWithCors(req, { ok: false, error: CHECKOUT_INTENT_EXPIRY_MESSAGE }, { status: 409 });
    }
    if (intent.selectedPaymentMethod === "COD") {
      if (latestIntent.selectedPaymentMethod !== "COD") {
        console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "payment_method_not_cod", intentStatus: latestIntent.status, selectedPaymentMethod: latestIntent.selectedPaymentMethod });
        return jsonWithCors(req, { ok: false, error: "COD payment method required", code: "payment_method_not_cod" }, { status: 409 });
      }
      const latestConfirmedPayment = await prisma.expressCheckoutPayment.findFirst({
        where: { shopId: shop.shopId, intentId, status: "CONFIRMED" },
        orderBy: { createdAt: "desc" },
      });
      if (latestConfirmedPayment) {
        console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_blocked_missing_readiness", { shopId: shop.shopId, intentId, customerProfileId, missing: "verified_payment_absent", intentStatus: latestIntent.status });
        return jsonWithCors(req, { ok: false, error: "COD order cannot be created after a verified payment.", code: "verified_payment_exists" }, { status: 409 });
      }
    }
    let createResult: NonNullable<DraftOrderCreatePayload["draftOrderCreate"]> | null = null;
    if (latestIntent.orderLink?.draftOrderId) {
      console.info("[CHECKOUT STATE] draft_order_idempotent_return", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: latestIntent.orderLink.draftOrderId, hasShopifyOrder: Boolean(latestIntent.orderLink.shopifyOrderId) });
      return jsonWithCors(req, { ok: false, intentId, error: "Order already exists for this checkout intent; a fresh completion was not performed.", code: "stale_order_link", freshCompletion: false, recovery: true }, { status: 409 });
    }

    {
      console.info("[SHOPIFY CUSTOMER ID]", { rawCustomerId, resolvedCustomerGid });
      if (discount) {
        console.info("[EXPRESS PREPAID FINALIZATION] draft_order_discount", {
          valueType: typeof discount.value,
          value: discount.value,
          valueTypeField: discount.valueType,
        });
      }
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
    if (createResult?.draftOrder?.id) {
      console.info("[EXPRESS CHECKOUT ORDER] draft_order_create_success", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: createResult.draftOrder.id, draftOrderName: createResult.draftOrder.name || null });
    }
    if (createResult?.userErrors?.length || !createResult?.draftOrder?.id) {
      const message = userErrorMessage(createResult?.userErrors);
      const userErrors = normalizeShopifyUserErrors(createResult?.userErrors);
      console.error("[SHOPIFY DRAFT ORDER USER ERRORS]", JSON.stringify(userErrors, null, 2));
      console.error("[EXPRESS CHECKOUT ORDER] Shopify draftOrderCreate userErrors", { ...diagnostic, shopifyUserErrors: userErrors, errorName: "ShopifyUserError", errorMessage: message });
      if (storeCreditAmountPaise > 0) await releaseStoreCreditReservation({ shopId: shop.shopId, customerProfileId, checkoutIntentId: intentId, reason: "shopify-draft-order-create-failed" });
      return jsonWithCors(
        req,
        { ok: false, error: "We could not place your order right now. Please try again." },
        { status: 422 }
      );
    }

    const paymentPending = intent.selectedPaymentMethod === "COD";
    const markAsPaid = !paymentPending;
    console.info("[EXPRESS CHECKOUT ORDER] draft_order_complete_start", {
      shopId: shop.shopId,
      intentId,
      customerProfileId,
      paymentMethod: intent.selectedPaymentMethod,
      selectedPaymentMethod: intent.selectedPaymentMethod,
      paymentPending,
      markAsPaid,
      paid: markAsPaid,
      draftOrderId: createResult.draftOrder.id,
    });

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
      { id: createResult.draftOrder.id, paymentPending }
    );

    checkoutPerfLog("shopify_admin_api_ms", { ...perfContext, durationMs: elapsedMs(shopifyStartedAt) });

    const completeResult = completed.draftOrderComplete;
    const completedDraftOrder = completeResult?.draftOrder || null;
    const completedOrder = completedDraftOrder?.order || null;
    if ((completeResult?.userErrors?.length || !completedOrder?.id) && hasAlreadyPaidUserError(completeResult?.userErrors)) {
      console.error("[EXPRESS CHECKOUT ORDER] draft_order_complete_recovery_not_customer_facing", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: createResult.draftOrder.id, paymentMethod: intent.selectedPaymentMethod, paymentPending, markAsPaid });
    }
    if ((completeResult?.userErrors?.length && !completedOrder?.id) || !completedDraftOrder || !completedOrder?.id) {
      const message = userErrorMessage(completeResult?.userErrors);
      const shopifyUserErrors = normalizeShopifyUserErrors(completeResult?.userErrors);
      console.error("[EXPRESS CHECKOUT ORDER] Shopify draftOrderComplete userErrors", { ...diagnostic, shopifyUserErrors, errorName: "ShopifyUserError", errorMessage: message, paymentMethod: intent.selectedPaymentMethod, paymentPending, markAsPaid, draftOrderId: createResult.draftOrder.id });
      if (storeCreditAmountPaise > 0) await releaseStoreCreditReservation({ shopId: shop.shopId, customerProfileId, checkoutIntentId: intentId, reason: "shopify-draft-order-complete-failed" });
      return jsonWithCors(req, { ok: false, error: "We could not place your order right now. Please try again." }, { status: 422 });
    }

    const order = completedOrder;
    const completedAt = new Date().toISOString();
    console.info("[EXPRESS CHECKOUT ORDER] draft_order_complete_success", { shopId: shop.shopId, intentId, customerProfileId, draftOrderId: completedDraftOrder.id || createResult.draftOrder.id, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, paymentPending, completionSource: "draft_order_complete" });
    let orderLink = null;
    let updatedIntent = latestIntent;

    console.info("[EXPRESS CHECKOUT ORDER] post_order_side_effect_start", { shopId: shop.shopId, intentId, customerProfileId, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null });
    try {
      const persistStartedAt = Date.now();
      await logCheckoutConflictDiagnostics({ shopId: shop.shopId, intentId, customerProfileId, phase: "after_draft_order_complete_before_persist" });
      const written = await prisma.$transaction(async (tx) => {
        logOrderLinkWriteAttempt({ shopId: shop.shopId, intentId, customerProfileId, table: "ExpressCheckoutOrderLink", conflictTarget: ["shopId", "intentId"], operation: "explicit find/update/create", phase: "after_draft_order_complete" });
        const link = await writeExpressCheckoutOrderLink(tx as unknown as ExpressOrderLinkWriteClient, {
          shopId: shop.shopId,
          intentId,
          data: {
            draftOrderId: completedDraftOrder?.id || createResult.draftOrder?.id || null,
            draftOrderName: completedDraftOrder?.name || createResult.draftOrder?.name || null,
            shopifyOrderId: order.id || null,
            shopifyOrderName: order.name || null,
            financialStatus: order.displayFinancialStatus || (intent.selectedPaymentMethod === "COD" ? "PENDING" : "PAID"),
            fulfillmentStatus: order.displayFulfillmentStatus || null,
          },
        });
        await tx.expressCheckoutIntent.updateMany({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
          data: { status: intent.selectedPaymentMethod === "COD" ? "ORDER_COMPLETED" : "ORDER_CREATED" },
        });
        const refreshedIntent = await tx.expressCheckoutIntent.findFirst({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
          include: { orderLink: true },
        });

        return { link, refreshedIntent };
      });
      orderLink = written.link;
      if (storeCreditAmountPaise > 0) await consumeStoreCreditReservationForOrder({ shopId: shop.shopId, customerProfileId, checkoutIntentId: intentId, shopifyOrderId: order.id || "", orderNumber: order.name || null });
      updatedIntent = written.refreshedIntent ?? updatedIntent;
      checkoutPerfLog("order_persist_ms", { ...perfContext, durationMs: elapsedMs(persistStartedAt) });
    } catch (error) {
      console.error("[ORDER LINK WRITE] persist_failed", { shopId: shop.shopId, intentId, customerProfileId, table: "ExpressCheckoutOrderLink", conflictTarget: ["shopId", "intentId"], operation: "explicit find/update/create", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), errorCode: typeof error === "object" && error && "code" in error ? String(error.code) : null });
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "P2002") {
        orderLink = await prisma.expressCheckoutOrderLink.findFirst({ where: { shopId: shop.shopId, intentId } });
        const recoveredIntent = await prisma.expressCheckoutIntent.findFirst({
          where: { shopId: shop.shopId, id: intentId, customerProfileId },
          include: { orderLink: true },
        });
        updatedIntent = recoveredIntent ?? updatedIntent;
      } else {
        console.error("[EXPRESS CHECKOUT ORDER] post_order_side_effect_failed", { shopId: shop.shopId, intentId, customerProfileId, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : String(error), errorCode: code || null });
      }
    }

    const persistedOrderId = typeof orderLink === "object" && orderLink && "shopifyOrderId" in orderLink ? String(orderLink.shopifyOrderId || "") : "";
    const persistedOrderName = typeof orderLink === "object" && orderLink && "shopifyOrderName" in orderLink ? String(orderLink.shopifyOrderName || "") : "";
    if ((persistedOrderId && persistedOrderId !== order.id) || (persistedOrderName && persistedOrderName !== order.name)) {
      console.error("[EXPRESS CHECKOUT ORDER] post_order_side_effect_failed", { shopId: shop.shopId, intentId, customerProfileId, reason: "stale_order_link_after_completion", completedOrderId: order.id || null, completedOrderName: order.name || null, persistedOrderId: persistedOrderId || null, persistedOrderName: persistedOrderName || null, paymentMethod: intent.selectedPaymentMethod, freshCompletion: true, recovery: false });
      orderLink = null;
    }

    if (intent.selectedPaymentMethod === "COD") console.info("[EXPRESS CHECKOUT ORDER] cod_order_create_success", { shopId: shop.shopId, intentId, returnedIntentId: intentId, customerProfileId, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, freshCompletion: true, recovery: false, paymentMethod: "COD", completedAt, completionSource: "draft_order_complete" });
    checkoutPerfLog("order_create_total_ms", { ...perfContext, durationMs: elapsedMs(totalStartedAt) });
    return jsonWithCors(req, { ok: true, success: true, intentId, intent: updatedIntent, orderLink, shopifyOrder: order, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, completedAt, freshCompletion: true, recovery: false, completionSource: "draft_order_complete", paymentMethod: intent.selectedPaymentMethod }, { status: 201 });
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
