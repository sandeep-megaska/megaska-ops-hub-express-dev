import crypto from "crypto";

/*
  Verifies a Shopify App Bridge session token (a short-lived JWT the embedded
  admin frontend attaches as `Authorization: Bearer <token>`). The token is
  signed HS256 with the app's client secret (SHOPIFY_API_SECRET), so we can
  verify it with Node crypto without any JWT dependency.

  Verifying this token — rather than trusting a client-supplied ?shop= param —
  is what actually authenticates which merchant an admin API request belongs to.
*/

export class SessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionTokenError";
  }
}

export interface VerifiedSessionToken {
  /** Shop myshopify domain derived from the token's `dest` claim, e.g. "store.myshopify.com". */
  shopDomain: string;
  dest: string;
  aud: string;
  sub: string;
  sid?: string;
  exp: number;
}

const SHOP_HOST = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64");
}

function hostOf(value: string): string {
  return String(value || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function verifyShopifySessionToken(
  token: string,
  opts?: { apiSecret?: string; apiKey?: string; leewaySeconds?: number; now?: number },
): VerifiedSessionToken {
  const apiSecret = String(opts?.apiSecret ?? process.env.SHOPIFY_API_SECRET ?? "").trim();
  const apiKey = String(opts?.apiKey ?? process.env.SHOPIFY_API_KEY ?? "").trim();
  const leeway = opts?.leewaySeconds ?? 5;

  if (!apiSecret) throw new SessionTokenError("SHOPIFY_API_SECRET is not configured");
  if (!apiKey) throw new SessionTokenError("SHOPIFY_API_KEY is not configured");

  const raw = String(token || "")
    .trim()
    .replace(/^Bearer\s+/i, "");
  const parts = raw.split(".");
  if (parts.length !== 3) throw new SessionTokenError("Malformed session token");
  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Signature (HS256) — constant-time compare.
  const expected = crypto.createHmac("sha256", apiSecret).update(`${headerB64}.${payloadB64}`).digest();
  const provided = base64UrlDecode(signatureB64);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    throw new SessionTokenError("Invalid session token signature");
  }

  // 2. Header alg.
  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    throw new SessionTokenError("Malformed session token header");
  }
  if (header.alg !== "HS256") throw new SessionTokenError(`Unsupported session token alg: ${String(header.alg)}`);

  // 3. Payload claims.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new SessionTokenError("Malformed session token payload");
  }

  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp);
  const nbf = Number(payload.nbf);
  if (!Number.isFinite(exp) || now > exp + leeway) throw new SessionTokenError("Session token expired");
  if (Number.isFinite(nbf) && now + leeway < nbf) throw new SessionTokenError("Session token not yet valid");

  if (String(payload.aud || "") !== apiKey) throw new SessionTokenError("Session token audience mismatch");

  const shopDomain = hostOf(String(payload.dest || ""));
  if (!SHOP_HOST.test(shopDomain)) throw new SessionTokenError("Session token dest is not a valid shop domain");

  const issHost = hostOf(String(payload.iss || ""));
  if (issHost && issHost !== shopDomain) throw new SessionTokenError("Session token iss/dest mismatch");

  return {
    shopDomain,
    dest: String(payload.dest || ""),
    aud: String(payload.aud || ""),
    sub: String(payload.sub || ""),
    sid: payload.sid ? String(payload.sid) : undefined,
    exp,
  };
}
