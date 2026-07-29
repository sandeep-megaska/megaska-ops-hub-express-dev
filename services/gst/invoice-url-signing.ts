import crypto from "crypto";

// Short-lived signed access for GST document/invoice PDF (and HTML) views.
//
// Most admin surfaces attach a verified Shopify session token as a Bearer
// header. The one place that cannot is the admin action extension: it opens the
// invoice PDF with window.open(url) — a top-level navigation that carries no
// Authorization header. For that path the backend mints a short-lived, HMAC
// signed URL after it has verified the caller's session token, and the PDF
// route accepts that signature in lieu of a Bearer token.
//
// The signing key is derived from SHOPIFY_API_SECRET — the same secret used to
// verify session tokens — so no new secret has to be provisioned.

const DEFAULT_TTL_SECONDS = 5 * 60;

function signingKey(): Buffer | null {
  const secret = String(
    process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_KEY || "",
  ).trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

function payloadString(documentId: string, shopId: string, exp: number): string {
  return `${documentId}.${shopId}.${exp}`;
}

/**
 * Mint a signature + expiry for a document PDF/HTML view scoped to one shop.
 * Returns null when no signing key is configured. `nowMs` is injectable for tests.
 */
export function signInvoiceDocumentAccess(
  documentId: string,
  shopId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  nowMs: number = Date.now(),
): { exp: number; sig: string } | null {
  const key = signingKey();
  const cleanDocumentId = String(documentId || "").trim();
  const cleanShopId = String(shopId || "").trim();
  if (!key || !cleanDocumentId || !cleanShopId) return null;

  const exp = Math.floor(nowMs / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const sig = crypto
    .createHmac("sha256", key)
    .update(payloadString(cleanDocumentId, cleanShopId, exp))
    .digest("base64url");
  return { exp, sig };
}

/**
 * Verify a signed document-access request. On success returns the shopId the
 * signature was scoped to (so the caller renders only that shop's document).
 */
export function verifyInvoiceDocumentAccess(
  documentId: string,
  params: { shopId?: string | null; exp?: string | number | null; sig?: string | null },
  nowMs: number = Date.now(),
): { ok: boolean; shopId?: string } {
  const key = signingKey();
  if (!key) return { ok: false };

  const cleanDocumentId = String(documentId || "").trim();
  const shopId = String(params.shopId || "").trim();
  const exp = Number(params.exp || 0);
  const sig = String(params.sig || "").trim();
  if (!cleanDocumentId || !shopId || !Number.isFinite(exp) || exp <= 0 || !sig) {
    return { ok: false };
  }

  // Expiry check before the constant-time compare.
  if (Math.floor(nowMs / 1000) > exp) return { ok: false };

  const expected = crypto
    .createHmac("sha256", key)
    .update(payloadString(cleanDocumentId, shopId, exp))
    .digest("base64url");

  const provided = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    return { ok: false };
  }

  return { ok: true, shopId };
}
