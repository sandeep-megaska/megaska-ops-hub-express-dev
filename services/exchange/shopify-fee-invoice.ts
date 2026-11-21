// Exchange charges (reverse pickup charge, price difference for a dearer style)
// collected through Shopify Checkout: the app creates a Shopify draft order and
// sends the customer its invoice link. Paying it creates a normal Shopify order;
// the orders/paid webhook (app/api/webhooks/orders/paid) matches it back to the
// exchange by the `loopd2c_payment_ref` attribute and carries on automatically.
//
// This replaces Razorpay payment links in the public app (Shopify App Store 1.1.2:
// no buyer payments outside Shopify Checkout). The reverse pickup charge is a
// shipping charge, so it goes on the draft order as a shipping line, not a product.
import crypto from "crypto";
import { prisma } from "../db/prisma.ts";
import { adminGraphql } from "../shopify/admin.ts";

export const FEE_REF_ATTRIBUTE = "loopd2c_payment_ref";
export const FEE_REQUEST_ATTRIBUTE = "loopd2c_request_id";
export const FEE_ORDER_TAG = "loopd2c-exchange-charge";

export type ShopifyFeeInvoiceInput = {
  shopId: string;
  requestId: string;
  amount: number; // paise
  currency?: string;
  /** Shown to the customer: the shipping line title (or line item title). */
  title: string;
  /** true: a shipping charge (reverse pickup). false: a price difference. */
  asShipping: boolean;
  description?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  expiresAt?: Date | null;
};

export type ShopifyFeeInvoice = { id: string; shortUrl: string; referenceId: string; expiresAt: Date | null; provider: "SHOPIFY" };

type Graphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
type UserError = { field?: string[] | null; message: string };

const DRAFT_ORDER_CREATE = `mutation LoopD2CExchangeCharge($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { field message } }
}`;
const DRAFT_ORDER_DELETE = `mutation LoopD2CExchangeChargeDelete($input: DraftOrderDeleteInput!) {
  draftOrderDelete(input: $input) { deletedId userErrors { field message } }
}`;
const ORDER_SHIPPING = `query LoopD2CExchangeChargeAddress($id: ID!) {
  order(id: $id) { shippingAddress { firstName lastName address1 address2 city provinceCode zip countryCodeV2 phone } }
}`;

type OrderAddress = { firstName?: string | null; lastName?: string | null; address1?: string | null; address2?: string | null; city?: string | null; provinceCode?: string | null; zip?: string | null; countryCodeV2?: string | null; phone?: string | null };

function toMailingAddress(address: OrderAddress | null | undefined) {
  if (!address?.address1) return undefined;
  return {
    firstName: address.firstName || undefined,
    lastName: address.lastName || undefined,
    address1: address.address1,
    address2: address.address2 || undefined,
    city: address.city || undefined,
    provinceCode: address.provinceCode || undefined,
    zip: address.zip || undefined,
    countryCode: address.countryCodeV2 || undefined,
    phone: address.phone || undefined,
  };
}

function money(paise: number, currency: string) {
  return { amount: (paise / 100).toFixed(2), currencyCode: currency };
}

function errorText(errors: UserError[] | undefined) {
  return errors && errors.length ? errors.map((e) => e.message).join("; ") : "";
}

/** Shopify may refuse a draft order without line items; the fallback is one custom, non-shippable line. */
export function needsLineItemFallback(message: string) {
  return /line ?items?/i.test(message);
}

export function buildDraftOrderInput(input: ShopifyFeeInvoiceInput & { referenceId: string; customerId?: string | null; shippingAddress?: ReturnType<typeof toMailingAddress> }, withLineItem: boolean) {
  const currency = input.currency || "INR";
  const charge = money(input.amount, currency);
  const base: Record<string, unknown> = {
    note: input.description || input.title,
    tags: [FEE_ORDER_TAG],
    customAttributes: [
      { key: FEE_REF_ATTRIBUTE, value: input.referenceId },
      { key: FEE_REQUEST_ATTRIBUTE, value: input.requestId },
    ],
    ...(input.customerId ? { purchasingEntity: { customerId: input.customerId } } : {}),
    ...(input.customerEmail ? { email: input.customerEmail } : {}),
    ...(input.customerPhone ? { phone: input.customerPhone } : {}),
    ...(input.shippingAddress ? { shippingAddress: input.shippingAddress } : {}),
  };
  if (input.asShipping && !withLineItem) return { ...base, shippingLine: { title: input.title, priceWithCurrency: charge } };
  return { ...base, lineItems: [{ title: input.title, quantity: 1, originalUnitPriceWithCurrency: charge, requiresShipping: false, taxable: true }] };
}

export async function createShopifyFeeInvoice(input: ShopifyFeeInvoiceInput, deps: { graphql?: Graphql; shopDomain?: string } = {}): Promise<ShopifyFeeInvoice> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("The charge must be a positive amount.");
  const [shop, request] = await Promise.all([
    deps.shopDomain ? Promise.resolve({ shopDomain: deps.shopDomain }) : prisma.shop.findUnique({ where: { id: input.shopId }, select: { shopDomain: true } }),
    prisma.orderActionRequest.findUnique({ where: { id: input.requestId }, select: { shopifyOrderId: true, customerProfile: { select: { shopifyCustomerId: true } } } }),
  ]);
  if (!shop?.shopDomain) throw new Error("Shop not found for the exchange charge.");
  const graphql: Graphql = deps.graphql ?? ((query, variables) => adminGraphql(query, variables, { shopDomain: shop.shopDomain, preferStoredToken: true }));

  // Prefill the address from the original order so paying the charge is quick.
  let shippingAddress: ReturnType<typeof toMailingAddress>;
  if (request?.shopifyOrderId) {
    const orderId = request.shopifyOrderId.startsWith("gid://") ? request.shopifyOrderId : `gid://shopify/Order/${request.shopifyOrderId}`;
    try {
      const data = await graphql<{ order?: { shippingAddress?: OrderAddress | null } | null }>(ORDER_SHIPPING, { id: orderId });
      shippingAddress = toMailingAddress(data.order?.shippingAddress);
    } catch {
      shippingAddress = undefined;
    }
  }
  const rawCustomerId = String(request?.customerProfile?.shopifyCustomerId || "").trim();
  const customerId = rawCustomerId ? (rawCustomerId.startsWith("gid://") ? rawCustomerId : `gid://shopify/Customer/${rawCustomerId}`) : null;
  const referenceId = `ld2c_${crypto.randomUUID()}`;
  const draftInput = { ...input, referenceId, customerId, shippingAddress };

  let result = await graphql<{ draftOrderCreate: { draftOrder?: { id: string; invoiceUrl?: string | null } | null; userErrors: UserError[] } }>(DRAFT_ORDER_CREATE, { input: buildDraftOrderInput(draftInput, false) });
  let message = errorText(result.draftOrderCreate.userErrors);
  if (message && input.asShipping && needsLineItemFallback(message)) {
    result = await graphql(DRAFT_ORDER_CREATE, { input: buildDraftOrderInput(draftInput, true) });
    message = errorText(result.draftOrderCreate.userErrors);
  }
  const draft = result.draftOrderCreate.draftOrder;
  if (message || !draft?.id || !draft.invoiceUrl) throw new Error(`Shopify didn't create the payment link${message ? `: ${message}` : "."}`);
  return { id: draft.id, shortUrl: draft.invoiceUrl, referenceId, expiresAt: input.expiresAt ?? null, provider: "SHOPIFY" };
}

/** Best effort: deletes an unpaid exchange-charge draft order so it can't be paid twice. */
export async function cancelShopifyFeeInvoice(shopId: string, draftOrderId: string): Promise<boolean> {
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true } });
    if (!shop?.shopDomain) return false;
    const data = await adminGraphql<{ draftOrderDelete: { deletedId?: string | null; userErrors: UserError[] } }>(DRAFT_ORDER_DELETE, { input: { id: draftOrderId } }, { shopDomain: shop.shopDomain, preferStoredToken: true });
    return Boolean(data.draftOrderDelete.deletedId);
  } catch {
    return false;
  }
}

export function isShopifyDraftOrderId(value: string | null | undefined) {
  return String(value || "").startsWith("gid://shopify/DraftOrder/");
}
