import crypto from "crypto";
import { REVERSE_PICKUP_CURRENCY, REVERSE_PICKUP_FEE_PAISE } from "./constants";

type CreatePaymentLinkInput = {
  requestId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amount?: number;
  currency?: string;
};

function getCreds() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return { keyId, keySecret, webhookSecret };
}

export function isRazorpayConfigured() {
  const { keyId, keySecret } = getCreds();
  return Boolean(keyId && keySecret);
}

export async function createReversePickupPaymentLink(input: CreatePaymentLinkInput) {
  const { keyId, keySecret } = getCreds();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const payload = {
    amount: input.amount || REVERSE_PICKUP_FEE_PAISE,
    currency: input.currency || REVERSE_PICKUP_CURRENCY,
    accept_partial: false,
    description: `Megaska exchange reverse pickup fee for ${input.requestId}`,
    reference_id: input.requestId,
    customer: {
      name: input.customerName || undefined,
      email: input.customerEmail || undefined,
      contact: input.customerPhone || undefined,
    },
    notify: { sms: true, email: true },
    reminder_enable: true,
    callback_method: "get",
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

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null) {
  const { webhookSecret } = getCreds();
  if (!webhookSecret || !signature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
