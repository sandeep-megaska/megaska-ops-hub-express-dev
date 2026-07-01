import { prisma } from "../db/prisma";
import { ShopifyAdminConfigError, shopifyAdminGraphql } from "./shopify-admin";
import { consumeStoreCreditReservationForOrder, getActiveStoreCreditReservation, releaseStoreCreditReservation } from "./store-credit";

type OrderLink = { id?: string; shopifyOrderId?: string | null; shopifyOrderName?: string | null; financialStatus?: string | null; fulfillmentStatus?: string | null; draftOrderId?: string | null; draftOrderName?: string | null };
type IntentRecord = { id: string; status?: string | null; selectedPaymentMethod?: string | null; customerProfileId?: string | null; cartSnapshot?: unknown; subtotalAmountPaise: number; discountAmountPaise: number; shippingAmountPaise: number; totalAmountPaise: number; discounts?: unknown[] };
type AddressRecord = { name: string; phone: string; email?: string | null; address1: string; address2?: string | null; city: string; province: string; country: string; zip: string };
type CustomerRecord = { email?: string | null; phoneE164?: string | null; shopifyCustomerId?: string | null };
type TxClient = {
  expressCheckoutOrderLink: { findFirst(args: unknown): Promise<OrderLink | null>; create(args: unknown): Promise<OrderLink>; update(args: unknown): Promise<OrderLink> };
  expressCheckoutIntent: { update(args: unknown): Promise<IntentRecord> };
};
type ExpressCheckoutDb = {
  expressCheckoutOrderLink: { findFirst(args: unknown): Promise<OrderLink | null> };
  expressCheckoutIntent: { findFirst(args: unknown): Promise<IntentRecord | null>; update(args: unknown): Promise<IntentRecord> };
  customerProfile: { findFirst(args: unknown): Promise<CustomerRecord | null> };
  expressCheckoutAddressSnapshot: { findFirst(args: unknown): Promise<AddressRecord | null> };
  $transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T>;
};

const db = prisma as unknown as ExpressCheckoutDb;

type JsonRecord = Record<string, unknown>;

function prepaidSuccessResponse(input: { intentId: string; intent: IntentRecord; orderLink: OrderLink; shopifyOrder?: unknown }) {
  const shopifyOrder = input.shopifyOrder || (input.orderLink.shopifyOrderId || input.orderLink.shopifyOrderName
    ? { id: input.orderLink.shopifyOrderId || null, name: input.orderLink.shopifyOrderName || null, displayFinancialStatus: input.orderLink.financialStatus || null, displayFulfillmentStatus: input.orderLink.fulfillmentStatus || null }
    : null);
  const orderRecord = asRecord(shopifyOrder);
  const completedAt = new Date().toISOString();
  return {
    ok: true,
    success: true,
    intentId: input.intentId,
    intent: input.intent,
    orderLink: input.orderLink,
    shopifyOrder,
    shopifyOrderId: String(orderRecord?.id || input.orderLink.shopifyOrderId || "") || null,
    shopifyOrderName: String(orderRecord?.name || input.orderLink.shopifyOrderName || "") || null,
    completedAt,
    freshCompletion: true,
    recovery: false,
    completionSource: "draft_order_complete",
    paymentMethod: "PREPAID",
    idempotent: false,
  };
}

async function writeExpressCheckoutOrderLink(client: TxClient, input: { shopId: string; intentId: string; data: Record<string, unknown> }) {
  const where = { shopId: input.shopId, intentId: input.intentId };
  const existing = await client.expressCheckoutOrderLink.findFirst({ where });
  if (existing?.shopifyOrderId) return existing;
  if (existing?.id) return client.expressCheckoutOrderLink.update({ where: { id: existing.id }, data: input.data });

  try {
    return await client.expressCheckoutOrderLink.create({ data: { shopId: input.shopId, intentId: input.intentId, ...input.data } });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;
    const raced = await client.expressCheckoutOrderLink.findFirst({ where });
    if (raced?.shopifyOrderId) return raced;
    if (raced?.id) return client.expressCheckoutOrderLink.update({ where: { id: raced.id }, data: input.data });
    throw error;
  }
}


type FinalizeParams = {
  shopId: string;
  shopDomain: string;
  intentId: string;
  customerProfileId: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  paymentId?: string | null;
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
    draftOrder?: { id?: string | null; name?: string | null } | null;
    userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
  } | null;
};

export class ExpressCheckoutOrderFinalizationError extends Error {
  status: number;
  publicMessage: string;

  constructor(status: number, publicMessage: string, message = publicMessage) {
    super(message);
    this.name = "ExpressCheckoutOrderFinalizationError";
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

const INDIAN_STATE_CODES: Record<string, string> = { KL: "Kerala" };

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function paiseToAmount(paise: number) {
  return (Math.max(0, Math.round(Number(paise) || 0)) / 100).toFixed(2);
}

function paiseToAmountNumber(paise: number) {
  return Math.max(0, Math.round(Number(paise) || 0)) / 100;
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

function getCartLines(cartSnapshot: unknown) {
  const dedupedByVariantId = new Map<string, { variantId: string; quantity: number }>();
  for (const item of cartSnapshotLines(cartSnapshot)) {
    const record = asRecord(item);
    if (!record) continue;
    const variantId = normalizeVariantId(record.variantId || record.shopifyVariantId || record.merchandiseId || record.variant_id);
    const quantity = Math.max(0, Math.floor(Number(record.quantity || 0)));
    if (!variantId || quantity <= 0) continue;
    const existing = dedupedByVariantId.get(variantId);
    dedupedByVariantId.set(variantId, { variantId, quantity: (existing?.quantity || 0) + quantity });
  }
  return Array.from(dedupedByVariantId.values());
}

function normalizeShopifyUserErrors(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  return (errors || []).map((error) => ({ field: Array.isArray(error.field) ? error.field : undefined, message: String(error.message || "").trim() })).filter((error) => error.message);
}

function userErrorMessage(errors?: Array<{ field?: string[] | null; message?: string | null }>) {
  return normalizeShopifyUserErrors(errors).map((error) => error.message).join(", ") || "Shopify draft order error";
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

function toShopifyCustomerGid(customerId?: string | null) {
  if (!customerId) return undefined;
  if (customerId.startsWith("gid://shopify/Customer/")) return customerId;
  if (/^\d+$/.test(customerId)) return `gid://shopify/Customer/${customerId}`;
  return undefined;
}

export async function finalizePrepaidExpressCheckoutOrder(params: FinalizeParams) {
  console.info("[EXPRESS PREPAID FINALIZATION] start", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null });

  const intent = await db.expressCheckoutIntent.findFirst({
    where: { shopId: params.shopId, id: params.intentId, customerProfileId: params.customerProfileId },
    include: { discounts: { orderBy: { createdAt: "desc" } } },
  });
  if (!intent) throw new ExpressCheckoutOrderFinalizationError(404, "Payment received, but we could not create your order automatically. Please contact support.", "Intent not found");
  if (intent.selectedPaymentMethod !== "PREPAID") throw new ExpressCheckoutOrderFinalizationError(409, "Payment received, but we could not create your order automatically. Please contact support.", "PREPAID payment method required");

  const existingLink = await db.expressCheckoutOrderLink.findFirst({ where: { shopId: params.shopId, intentId: params.intentId } });
  if (existingLink?.shopifyOrderId || existingLink?.shopifyOrderName) {
    const updatedIntent = intent.status === "ORDER_COMPLETED" ? intent : await db.expressCheckoutIntent.update({ where: { id: params.intentId }, data: { status: "ORDER_COMPLETED" } });
    console.info("[EXPRESS PREPAID FINALIZATION] existing_order_link_returned", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null, financialStatus: existingLink.financialStatus || null });
    return prepaidSuccessResponse({ intentId: params.intentId, intent: updatedIntent, orderLink: existingLink });
  }

  const customer = await db.customerProfile.findFirst({ where: { shopId: params.shopId, id: params.customerProfileId } });
  const address = await db.expressCheckoutAddressSnapshot.findFirst({ where: { shopId: params.shopId, intentId: params.intentId, customerProfileId: params.customerProfileId }, orderBy: { createdAt: "desc" } });
  if (!address) throw new ExpressCheckoutOrderFinalizationError(400, "Payment received, but we could not create your order automatically. Please contact support.", "Address snapshot required");

  const lineItems: JsonRecord[] = getCartLines(intent.cartSnapshot);
  if (!lineItems.length) throw new ExpressCheckoutOrderFinalizationError(400, "Payment received, but we could not create your order automatically. Please contact support.", "Cart line items required");

  console.info("[EXPRESS PREPAID FINALIZATION] shopify_order_create_start", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null });

  const { firstName, lastName } = nameParts(address.name);
  const shippingAddress = { firstName, lastName, address1: address.address1, address2: address.address2, city: address.city, province: normalizeProvince(address.province), country: address.country, zip: address.zip, phone: address.phone };
  const storeCreditReservation = await getActiveStoreCreditReservation({ shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.intentId });
  const storeCreditAmountPaise = Math.min(Number(storeCreditReservation?.reservedAmount || 0), Math.max(0, intent.totalAmountPaise));
  const discountAmount = Math.max(0, Math.min(intent.subtotalAmountPaise + intent.shippingAmountPaise, intent.discountAmountPaise + storeCreditAmountPaise));
  const discountValue = Number(paiseToAmountNumber(discountAmount));
  const appliedDiscount = Number.isFinite(discountValue) && discountValue > 0
    ? { title: "Express checkout discount", value: discountValue, valueType: "FIXED_AMOUNT" }
    : undefined;
  const customAttributes = [
    { key: "megaska_express_intent_id", value: intent.id },
    { key: "megaska_customer_profile_id", value: params.customerProfileId },
    { key: "megaska_payment_method", value: "PREPAID" },
    { key: "megaska_discount_snapshot", value: JSON.stringify(intent.discounts) },
    ...(storeCreditAmountPaise > 0 ? [
      { key: "store_credit_applied", value: "true" },
      { key: "store_credit_amount", value: String(storeCreditAmountPaise) },
      { key: "wallet_reservation_id", value: storeCreditReservation?.id || "" },
      { key: "checkout_intent_id", value: params.intentId },
    ] : []),
    ...(params.razorpayOrderId ? [{ key: "megaska_razorpay_order_id", value: params.razorpayOrderId }] : []),
    ...(params.razorpayPaymentId ? [{ key: "megaska_razorpay_payment_id", value: params.razorpayPaymentId }] : []),
  ];
  const draftOrderInput: JsonRecord = {
    lineItems,
    email: address.email || customer?.email || undefined,
    phone: address.phone || customer?.phoneE164 || undefined,
    shippingAddress,
    billingAddress: shippingAddress,
    note: storeCreditAmountPaise > 0 ? `Megaska Express Checkout intent ${intent.id} | Megaska Store Credit: ${paiseToAmount(storeCreditAmountPaise)}` : `Megaska Express Checkout intent ${intent.id}`,
    tags: ["Megaska Express Checkout"],
    customAttributes,
    shippingLine: intent.shippingAmountPaise > 0 ? { title: "Shipping", price: paiseToAmount(intent.shippingAmountPaise) } : undefined,
    appliedDiscount,
  };
  const resolvedCustomerGid = toShopifyCustomerGid(customer?.shopifyCustomerId);
  if (resolvedCustomerGid) draftOrderInput.customerId = resolvedCustomerGid;

  try {
    if (appliedDiscount) {
      console.info("[EXPRESS PREPAID FINALIZATION] draft_order_discount", {
        valueType: typeof appliedDiscount.value,
        value: appliedDiscount.value,
        valueTypeField: appliedDiscount.valueType,
      });
    }

    const created = await shopifyAdminGraphql<DraftOrderCreatePayload>(params.shopDomain, `mutation DraftOrderCreate($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name } userErrors { field message } } }`, { input: draftOrderInput }, { shopId: params.shopId });
    const createResult = created.draftOrderCreate;
    if (createResult?.userErrors?.length || !createResult?.draftOrder?.id) throw new ExpressCheckoutOrderFinalizationError(422, "Payment received, but we could not create your order automatically. Please contact support.", userErrorMessage(createResult?.userErrors));

    console.info("[EXPRESS PREPAID FINALIZATION] draft_order_complete_start", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, paymentMethod: "PREPAID", selectedPaymentMethod: "PREPAID", paymentPending: false, markAsPaid: true, paid: true, draftOrderId: createResult.draftOrder.id });
    const completed = await shopifyAdminGraphql<DraftOrderCompletePayload>(params.shopDomain, `mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) { draftOrderComplete(id: $id, paymentPending: $paymentPending) { draftOrder { id name order { id name displayFinancialStatus displayFulfillmentStatus } } userErrors { field message } } }`, { id: createResult.draftOrder.id, paymentPending: false }, { shopId: params.shopId });
    const completeResult = completed.draftOrderComplete;
    if (completeResult?.userErrors?.length || !completeResult?.draftOrder?.order?.id) throw new ExpressCheckoutOrderFinalizationError(422, "Payment received, but we could not create your order automatically. Please contact support.", userErrorMessage(completeResult?.userErrors));

    const order = completeResult.draftOrder.order;
    const written = await db.$transaction(async (tx) => {
      const link = await writeExpressCheckoutOrderLink(tx, {
        shopId: params.shopId,
        intentId: params.intentId,
        data: { draftOrderId: completeResult.draftOrder?.id || createResult.draftOrder?.id || null, draftOrderName: completeResult.draftOrder?.name || createResult.draftOrder?.name || null, shopifyOrderId: order.id || null, shopifyOrderName: order.name || null, financialStatus: order.displayFinancialStatus || "PAID", fulfillmentStatus: order.displayFulfillmentStatus || null },
      });
      const updatedIntent = await tx.expressCheckoutIntent.update({ where: { id: params.intentId }, data: { status: "ORDER_COMPLETED" } });
      return { link, updatedIntent };
    });
    if (storeCreditAmountPaise > 0) await consumeStoreCreditReservationForOrder({ shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.intentId, shopifyOrderId: order.id || "", orderNumber: order.name || null });
    console.info("[EXPRESS PREPAID FINALIZATION] shopify_order_create_success", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null, financialStatus: written.link.financialStatus || null, shopifyOrderId: written.link.shopifyOrderId || null, shopifyOrderName: written.link.shopifyOrderName || null });
    console.info("[EXPRESS PREPAID FINALIZATION] complete", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null, financialStatus: written.link.financialStatus || null });
    return prepaidSuccessResponse({ intentId: params.intentId, intent: written.updatedIntent, orderLink: written.link, shopifyOrder: order });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "P2002") {
      const link = await db.expressCheckoutOrderLink.findFirst({ where: { shopId: params.shopId, intentId: params.intentId } });
      if (link?.shopifyOrderId || link?.shopifyOrderName) {
        console.info("[EXPRESS PREPAID FINALIZATION] existing_order_link_returned", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null, financialStatus: link.financialStatus || null });
        const updatedIntent = await db.expressCheckoutIntent.update({ where: { id: params.intentId }, data: { status: "ORDER_COMPLETED" } });
        return prepaidSuccessResponse({ intentId: params.intentId, intent: updatedIntent, orderLink: link });
      }
    }
    const status = error instanceof ExpressCheckoutOrderFinalizationError || error instanceof ShopifyAdminConfigError ? error.status : 502;
    if (storeCreditAmountPaise > 0) await releaseStoreCreditReservation({ shopId: params.shopId, customerProfileId: params.customerProfileId, checkoutIntentId: params.intentId, reason: "shopify-prepaid-order-create-failed" });
    console.error("[EXPRESS PREPAID FINALIZATION] order_create_failed_after_payment_confirmed", { shopId: params.shopId, intentId: params.intentId, paymentId: params.paymentId || null, razorpayOrderId: params.razorpayOrderId || null, razorpayPaymentId: params.razorpayPaymentId || null, errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "Unknown error" });
    throw new ExpressCheckoutOrderFinalizationError(status, "Payment received, but we could not create your order automatically. Please contact support.", error instanceof Error ? error.message : "Order finalization failed");
  }
}
