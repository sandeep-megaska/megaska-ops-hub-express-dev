import crypto from "crypto";
import { SessionTokenError, verifyShopifySessionToken } from "./session-token.ts";

/*
  Decides which shop a server-rendered admin request (a page render, an RSC
  navigation or a server action) belongs to, from something Shopify signed —
  never from a bare ?shop= param, which anyone can type.

  Accepted, in order:
    1. `Authorization: Bearer <session token>` — App Bridge (and the layout's fetch
       wrapper) attach it to every same-origin request made inside the admin iframe,
       which covers client navigations and server actions.
    2. `?id_token=` — Shopify adds a fresh one to the URL when it loads the app, and
       the session bounce page adds one after a reload.
    3. `?hmac=` with a recent `timestamp` — Shopify's signed app-load URL.

  A present-but-invalid bearer token is a failure; it does not fall back to the URL.
*/

export type AdminRequestVerification =
  | { ok: true; shopDomain: string; method: "session_token" | "id_token" | "hmac" }
  | { ok: false; reason: string };

// Shopify's app-load URL is used straight away; an older one is a replay.
export const ADMIN_HMAC_MAX_AGE_SECONDS = 10 * 60;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function apiSecretFrom(explicit?: string) {
  return String(explicit ?? process.env.SHOPIFY_API_SECRET ?? "").trim();
}

export function validateShopifyAdminHmac(params: URLSearchParams, apiSecret?: string) {
  const secret = apiSecretFrom(apiSecret);
  const hmac = params.get("hmac") || "";
  if (!secret || !hmac) return false;

  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const generated = crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (generated.length !== hmac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(generated, "utf8"), Buffer.from(hmac, "utf8"));
}

export function verifyAdminRequest(input: {
  authorization?: string | null;
  params: URLSearchParams;
  now?: number;
  apiSecret?: string;
  apiKey?: string;
}): AdminRequestVerification {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tokenOpts = { apiSecret: input.apiSecret, apiKey: input.apiKey, now };

  const bearer = String(input.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) {
    try {
      const verified = verifyShopifySessionToken(bearer, tokenOpts);
      return { ok: true, shopDomain: verified.shopDomain, method: "session_token" };
    } catch (error) {
      return { ok: false, reason: error instanceof SessionTokenError ? error.message : "Invalid session token" };
    }
  }

  const idToken = input.params.get("id_token") || "";
  if (idToken) {
    try {
      const verified = verifyShopifySessionToken(idToken, { ...tokenOpts, leewaySeconds: 10 });
      return { ok: true, shopDomain: verified.shopDomain, method: "id_token" };
    } catch {
      // An expired URL token is normal after a reload; Shopify's HMAC may still be fresh.
    }
  }

  if (input.params.get("hmac")) {
    const shop = String(input.params.get("shop") || "").trim().toLowerCase();
    const timestamp = Number(input.params.get("timestamp"));
    if (!SHOP_DOMAIN.test(shop)) return { ok: false, reason: "Invalid shop domain" };
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > ADMIN_HMAC_MAX_AGE_SECONDS) {
      return { ok: false, reason: "Admin link has expired" };
    }
    if (!validateShopifyAdminHmac(input.params, input.apiSecret)) return { ok: false, reason: "Invalid admin signature" };
    return { ok: true, shopDomain: shop, method: "hmac" };
  }

  return { ok: false, reason: "Missing Shopify session" };
}

// Where to send an unverified page render or server action so App Bridge can supply
// a fresh session token. Returns null when there is nowhere safe to return to, or when
// this URL has only just come back from the bounce (so a bad token can't loop).
export const SESSION_BOUNCE_PATH = "/admin/session-bounce";
export const SESSION_BOUNCE_MARK = "loopd2c_bounce";
const BOUNCE_LOOP_WINDOW_MS = 30_000;

export function sessionBounceUrl(currentUrl: string | null | undefined, nowMs = Date.now()): string | null {
  const raw = String(currentUrl || "");
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const url = new URL(raw, "https://app.invalid");
  if (url.pathname === SESSION_BOUNCE_PATH) return null;
  const bouncedAt = Number(url.searchParams.get(SESSION_BOUNCE_MARK));
  if (Number.isFinite(bouncedAt) && nowMs - bouncedAt >= 0 && nowMs - bouncedAt < BOUNCE_LOOP_WINDOW_MS) return null;

  const bounce = new URLSearchParams();
  for (const key of ["shop", "host", "embedded"]) {
    const value = url.searchParams.get(key);
    if (value) bounce.set(key, value);
  }
  bounce.set("return", `${url.pathname}${url.search}`);
  return `${SESSION_BOUNCE_PATH}?${bounce.toString()}`;
}

/*
  Media the admin shows in <img>/<audio> tags can't carry a session token, so the
  page that renders them signs each URL for its own (already verified) shop.
*/
export const MEDIA_URL_TTL_SECONDS = 60 * 60;

function mediaSignature(shopDomain: string, mediaId: string, expires: number, apiSecret?: string) {
  return crypto
    .createHmac("sha256", apiSecretFrom(apiSecret))
    .update(`whatsapp-media:${shopDomain}:${mediaId}:${expires}`)
    .digest("hex");
}

export function signAdminMediaQuery(shopDomain: string, mediaId: string, opts?: { now?: number; apiSecret?: string }) {
  const expires = (opts?.now ?? Math.floor(Date.now() / 1000)) + MEDIA_URL_TTL_SECONDS;
  const query = new URLSearchParams({ shop: shopDomain, expires: String(expires), sig: mediaSignature(shopDomain, mediaId, expires, opts?.apiSecret) });
  return query.toString();
}

export function verifyAdminMediaQuery(mediaId: string, params: URLSearchParams, opts?: { now?: number; apiSecret?: string }): string | null {
  const shop = String(params.get("shop") || "").trim().toLowerCase();
  const expires = Number(params.get("expires"));
  const sig = String(params.get("sig") || "");
  if (!apiSecretFrom(opts?.apiSecret) || !SHOP_DOMAIN.test(shop) || !Number.isFinite(expires) || !sig) return null;
  if ((opts?.now ?? Math.floor(Date.now() / 1000)) > expires) return null;
  const expected = mediaSignature(shop, mediaId, expires, opts?.apiSecret);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  return shop;
}
