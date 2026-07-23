import crypto from "crypto";

function getShopifyWebhookSecret() {
  return String(process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || "").trim();
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function verifyShopifyWebhookHmac(rawBuffer: Buffer, hmacHeader: string) {
  const secret = getShopifyWebhookSecret();
  if (!secret || !hmacHeader) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBuffer).digest("base64");
  return safeEqual(digest, hmacHeader);
}
