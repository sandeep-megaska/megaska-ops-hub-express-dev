import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify X-Shopify-Hmac-Sha256: base64 HMAC-SHA256 of the raw request body. */
export function verifyShopifyWebhook(rawBody: Buffer | string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** The webhook topics the storefront sync subscribes to (GraphQL enum names). */
export const SYNC_WEBHOOK_TOPICS = [
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "COLLECTIONS_CREATE",
  "COLLECTIONS_UPDATE",
  "COLLECTIONS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
] as const;
