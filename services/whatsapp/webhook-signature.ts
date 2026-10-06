import { createHmac, timingSafeEqual } from "crypto";

// Meta signs webhook POSTs with the app secret: X-Hub-Signature-256: sha256=<hex HMAC of the raw body>.
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const received = Buffer.from(signatureHeader.slice("sha256=".length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}
