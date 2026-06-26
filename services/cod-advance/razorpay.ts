import crypto from "crypto";

export function isCodAdvanceRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function creds() {
  return {
    keyId: String(process.env.RAZORPAY_KEY_ID || "").trim(),
    keySecret: String(process.env.RAZORPAY_KEY_SECRET || "").trim(),
    webhookSecret: String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim(),
  };
}

export async function createCodAdvancePaymentLink(input: {
  intentId: string;
  amountPaise: number;
  currency: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}) {
  const { keyId, keySecret } = creds();
  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured");
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency || "INR",
      accept_partial: false,
      description: `Megaska Fixed COD Advance for ${input.intentId}`,
      reference_id: input.intentId,
      customer: {
        name: input.customerName || undefined,
        email: input.customerEmail || undefined,
        contact: input.customerPhone || undefined,
      },
      notes: { megaska_module: "fixed_cod_advance", megaska_cod_advance_intent_id: input.intentId },
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

export function verifyCodAdvanceRazorpayWebhookSignature(rawBody: string, signature: string | null) {
  const { webhookSecret } = creds();
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
