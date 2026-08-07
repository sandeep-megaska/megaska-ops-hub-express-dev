import crypto from "crypto";

/**
 * Collect every candidate webhook signing secret.
 *
 * A single deployment can receive `orders/create` (and other) webhooks from
 * more than one Shopify app — e.g. the production app, a staging app, and an
 * ops app all installed across stores that point at the same handler. Each app
 * signs with its OWN client secret, so verifying against a single value rejects
 * every webhook signed by the other apps.
 *
 * `SHOPIFY_WEBHOOK_SECRET` may therefore be a list: multiple secrets separated
 * by commas, semicolons, or whitespace/newlines. `SHOPIFY_API_SECRET` (this
 * deployment's own app secret) is always included as a fallback candidate.
 */
export function collectShopifyWebhookSecrets(): string[] {
  const raw = [
    String(process.env.SHOPIFY_WEBHOOK_SECRET || ""),
    String(process.env.SHOPIFY_API_SECRET || ""),
  ].join(",");

  const seen = new Set<string>();
  const secrets: string[] = [];
  for (const candidate of raw.split(/[\s,;]+/)) {
    const value = candidate.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      secrets.push(value);
    }
  }
  return secrets;
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Verify a Shopify webhook signature against any configured signing secret.
 * Accepts when the base64 HMAC-SHA256 of the raw body under ANY candidate
 * secret matches the `x-shopify-hmac-sha256` header. Every candidate is one of
 * the operator's own app secrets, so accept-on-any preserves authenticity.
 */
export function verifyShopifyWebhookHmac(rawBuffer: Buffer, hmacHeader: string): boolean {
  const header = String(hmacHeader || "").trim();
  if (!header) return false;

  const secrets = collectShopifyWebhookSecrets();
  if (secrets.length === 0) return false;

  for (const secret of secrets) {
    const digest = crypto.createHmac("sha256", secret).update(rawBuffer).digest("base64");
    if (safeEqual(digest, header)) return true;
  }
  return false;
}

export interface ShopifyWebhookHmacDiagnostics {
  ok: boolean;
  /** How many distinct signing secrets are configured on this deployment. */
  candidateSecretCount: number;
  /** Presence of each env source — reveals scope/plumbing problems, not values. */
  hasWebhookSecretEnv: boolean;
  hasApiSecretEnv: boolean;
  /** Whether Shopify's signature header arrived (its length, never our secret). */
  hmacHeaderPresent: boolean;
  hmacHeaderLength: number;
  /** Raw request body size in bytes — a mutated/empty body shows up here. */
  bodyBytes: number;
}

/**
 * Non-sensitive verification breadcrumb for logging on rejection. Reveals
 * nothing about any secret value: only counts, presence flags, and the public
 * (Shopify-supplied) signature header length. Distinguishes "no secret reached
 * this deployment" (env scope/project problem) from "secret present but wrong"
 * from "body altered".
 */
export function describeShopifyWebhookHmac(
  rawBuffer: Buffer,
  hmacHeader: string,
): ShopifyWebhookHmacDiagnostics {
  const header = String(hmacHeader || "").trim();
  return {
    ok: verifyShopifyWebhookHmac(rawBuffer, header),
    candidateSecretCount: collectShopifyWebhookSecrets().length,
    hasWebhookSecretEnv: Boolean(String(process.env.SHOPIFY_WEBHOOK_SECRET || "").trim()),
    hasApiSecretEnv: Boolean(String(process.env.SHOPIFY_API_SECRET || "").trim()),
    hmacHeaderPresent: Boolean(header),
    hmacHeaderLength: header.length,
    bodyBytes: rawBuffer.length,
  };
}
