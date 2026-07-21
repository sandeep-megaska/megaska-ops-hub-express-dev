import crypto from "crypto";
import { getInternalRazorpayConfig } from "../razorpay/config";

export async function isCodAdvanceRazorpayConfigured(shopId: string) {
  const config = await getInternalRazorpayConfig(shopId);
  return Boolean(config.enabled && config.keyId && config.keySecret);
}

export async function createCodAdvancePaymentLink(input: {
  shopId: string;
  intentId: string;
  amountPaise: number;
  currency: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}) {
  const { enabled, keyId, keySecret } = await getInternalRazorpayConfig(input.shopId);
  if (!enabled || !keyId || !keySecret) throw new Error("Razorpay credentials are not configured");
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency || "INR",
      accept_partial: false,
      description: `Fixed COD Advance for ${input.intentId}`,
      reference_id: input.intentId,
      customer: {
        name: input.customerName || undefined,
        email: input.customerEmail || undefined,
        contact: input.customerPhone || undefined,
      },
      notes: { loopdesk_module: "fixed_cod_advance", loopdesk_cod_advance_intent_id: input.intentId },
      notify: { sms: true, email: true },
      reminder_enable: true,
      callback_method: "get",
    }),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new Error(`Failed to create COD advance payment link (${response.status})`);
  return {
    id: String(data.id || ""),
    shortUrl: String(data.short_url || ""),
    status: String(data.status || "created"),
    referenceId: String(data.reference_id || input.intentId),
    expiresAt: typeof data.expire_by === "number" ? new Date(data.expire_by * 1000) : null,
  };
}

export async function verifyCodAdvanceRazorpayWebhookSignature(shopId: string, rawBody: string, signature: string | null) {
  const { enabled, webhookSecret } = await getInternalRazorpayConfig(shopId);
  if (!enabled || !webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
