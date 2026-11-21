import { offShopifyPaymentsEnabled } from "../platform/off-shopify-payments.ts";
import { cancelShopifyFeeInvoice, createShopifyFeeInvoice, isShopifyDraftOrderId } from "./shopify-fee-invoice.ts";
import crypto from "crypto";
import { getInternalRazorpayConfig } from "../razorpay/config";
import { REVERSE_PICKUP_CURRENCY, REVERSE_PICKUP_FEE_PAISE } from "./constants";

type CreatePaymentLinkInput = {
  shopId: string;
  requestId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amount?: number;
  currency?: string;
  expiresAt?: Date | null;
  description?: string;
  /** What the link charges for. A reverse pickup charge is a shipping charge. */
  purpose?: "REVERSE_PICKUP_FEE" | "STYLE_DIFFERENCE";
  orderNumber?: string | null;
};

export async function isRazorpayConfigured(shopId: string) {
  const config = await getInternalRazorpayConfig(shopId);
  return Boolean(config.enabled && config.keyId && config.keySecret);
}

// Creates the link the customer pays an exchange charge with. The original
// store-specific app uses Razorpay payment links; the public app uses a Shopify
// draft-order invoice, so the customer pays on Shopify Checkout (Shopify App Store
// 1.1.2). `provider` says which, and is stored on the RequestPayment row.
export async function createReversePickupPaymentLink(input: CreatePaymentLinkInput) {
  if (!offShopifyPaymentsEnabled()) {
    const style = input.purpose === "STYLE_DIFFERENCE";
    const invoice = await createShopifyFeeInvoice({
      shopId: input.shopId,
      requestId: input.requestId,
      amount: input.amount || REVERSE_PICKUP_FEE_PAISE,
      currency: input.currency || REVERSE_PICKUP_CURRENCY,
      title: style ? `Price difference${input.orderNumber ? ` for exchange #${input.orderNumber}` : ""}` : "Reverse pickup",
      lineTitle: `Reverse pickup${input.orderNumber ? ` for order #${input.orderNumber}` : ""}`,
      itemTitle: `Reverse pickup charge${input.orderNumber ? ` (order #${input.orderNumber})` : ""}`,
      asShipping: !style,
      description: input.description,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      expiresAt: input.expiresAt,
    });
    return { ...invoice, status: "created" };
  }
  return createRazorpayPaymentLink(input);
}

async function createRazorpayPaymentLink(input: CreatePaymentLinkInput) {
  const { enabled, keyId, keySecret } = await getInternalRazorpayConfig(input.shopId);
  if (!enabled || !keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const payload = {
    amount: input.amount || REVERSE_PICKUP_FEE_PAISE,
    currency: input.currency || REVERSE_PICKUP_CURRENCY,
    accept_partial: false,
    description: input.description || `Exchange reverse pickup fee for ${input.requestId}`,
    reference_id: input.requestId,
    customer: {
      name: input.customerName || undefined,
      email: input.customerEmail || undefined,
      contact: input.customerPhone || undefined,
    },
    notify: { sms: true, email: true },
    reminder_enable: true,
    callback_method: "get",
    expire_by: input.expiresAt ? Math.floor(input.expiresAt.getTime() / 1000) : undefined,
  };

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error(`Failed to create payment link (${response.status})`);
  }

  return {
    id: String(data.id || ""),
    shortUrl: String(data.short_url || ""),
    status: String(data.status || "created"),
    referenceId: String(data.reference_id || input.requestId),
    expiresAt: typeof data.expire_by === "number" ? new Date(data.expire_by * 1000) : null,
    provider: "RAZORPAY" as const,
  };
}

export async function verifyRazorpayWebhookSignature(shopId: string, rawBody: string, signature: string | null) {
  const { enabled, webhookSecret } = await getInternalRazorpayConfig(shopId);
  if (!enabled || !webhookSecret || !signature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Reads one payment back from Razorpay with the shop's own keys, e.g. a fee the
 * customer paid through a link the team created in the Razorpay dashboard (the
 * webhook only recognises links loopd2c created). Null when Razorpay has no such
 * payment on this account.
 */
export async function fetchRazorpayPayment(shopId: string, paymentId: string): Promise<Record<string, unknown> | null> {
  const { enabled, keyId, keySecret } = await getInternalRazorpayConfig(shopId);
  if (!enabled || !keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 400 || response.status === 404) return null;
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error(`Razorpay payment lookup failed (${response.status})`);
  }
  return data;
}

/** Best effort: cancels a still-active payment link so the customer can't pay the fee twice. */
export async function cancelRazorpayPaymentLink(shopId: string, paymentLinkId: string): Promise<boolean> {
  if (isShopifyDraftOrderId(paymentLinkId)) return cancelShopifyFeeInvoice(shopId, paymentLinkId);
  try {
    const { enabled, keyId, keySecret } = await getInternalRazorpayConfig(shopId);
    if (!enabled || !keyId || !keySecret) return false;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
