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
};

export async function isRazorpayConfigured(shopId: string) {
  const config = await getInternalRazorpayConfig(shopId);
  return Boolean(config.enabled && config.keyId && config.keySecret);
}

export async function createReversePickupPaymentLink(input: CreatePaymentLinkInput) {
  const { enabled, keyId, keySecret } = await getInternalRazorpayConfig(input.shopId);
  if (!enabled || !keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const payload = {
    amount: input.amount || REVERSE_PICKUP_FEE_PAISE,
    currency: input.currency || REVERSE_PICKUP_CURRENCY,
    accept_partial: false,
    description: `Exchange reverse pickup fee for ${input.requestId}`,
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
