// Shopify token exchange, refresh and migration, plus the "does this shop need
// installing" check. No imports, so it can be unit-tested directly;
// services/shopify/install.ts and offline-token.ts wire it to the database.
//
// Offline tokens are EXPIRING: Shopify rejects non-expiring tokens for public apps
// created on or after 1 April 2026 (and for all apps from 1 April 2027). An expiring
// offline token lasts about an hour and comes with a refresh token (about 90 days)
// that rotates on every refresh.

export type ShopInstallState = {
  isActive: boolean;
  uninstalledAt: Date | string | null;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
};

export class ShopInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopInstallError";
  }
}

/** A refresh token Shopify will never accept again: re-authenticate with token exchange. */
export class ShopifyRefreshTokenRevokedError extends ShopInstallError {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyRefreshTokenRevokedError";
  }
}

export function shopNeedsInstall(shop: ShopInstallState | null) {
  if (!shop) return true;
  if (!shop.isActive || shop.uninstalledAt) return true;
  return !shop.accessToken && !shop.accessTokenEncrypted;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type GrantOptions = { apiKey?: string; apiSecret?: string; fetchImpl?: FetchLike; now?: () => number };

export type OfflineTokenGrant = {
  accessToken: string;
  scopes: string | null;
  /** null only for a legacy non-expiring token. */
  expiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
};

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
const OFFLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";

function credentials(opts: GrantOptions) {
  const apiKey = String(opts.apiKey ?? process.env.SHOPIFY_API_KEY ?? "").trim();
  const apiSecret = String(opts.apiSecret ?? process.env.SHOPIFY_API_SECRET ?? "").trim();
  if (!apiKey || !apiSecret) throw new ShopInstallError("Shopify API credentials are not configured");
  return { apiKey, apiSecret };
}

function seconds(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseOfflineTokenGrant(data: unknown, now: number): OfflineTokenGrant {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const accessToken = String(body.access_token || "").trim();
  if (!accessToken) throw new ShopInstallError("Shopify returned no access token");
  const expiresIn = seconds(body.expires_in);
  const refreshExpiresIn = seconds(body.refresh_token_expires_in);
  const refreshToken = String(body.refresh_token || "").trim() || null;
  return {
    accessToken,
    scopes: String(body.scope || "").trim() || null,
    expiresAt: expiresIn ? new Date(now + expiresIn * 1000) : null,
    refreshToken,
    refreshTokenExpiresAt: refreshToken && refreshExpiresIn ? new Date(now + refreshExpiresIn * 1000) : null,
  };
}

async function requestOfflineToken(shopDomain: string, params: Record<string, string>, opts: GrantOptions, label: string) {
  const { apiKey, apiSecret } = credentials(opts);
  const response = await (opts.fetchImpl ?? fetch)(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: apiKey, client_secret: apiSecret, ...params }).toString(),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const description = data && typeof data === "object" ? String((data as Record<string, unknown>).error_description || (data as Record<string, unknown>).error || "") : "";
    // Shopify answers every terminal refresh case (used, retired, expired) with 401.
    if (label === "refresh" && response.status === 401) throw new ShopifyRefreshTokenRevokedError(`Token refresh refused (HTTP 401) ${description}`.trim());
    throw new ShopInstallError(`Token ${label} failed (HTTP ${response.status}) ${description}`.trim());
  }
  return parseOfflineTokenGrant(data, (opts.now ?? Date.now)());
}

/** Session (ID) token → expiring offline token. Used on install and re-install. */
export async function exchangeSessionTokenForOfflineToken(shopDomain: string, sessionToken: string, opts: GrantOptions = {}): Promise<OfflineTokenGrant> {
  return requestOfflineToken(shopDomain, {
    grant_type: TOKEN_EXCHANGE,
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: "1",
  }, opts, "exchange");
}

/** Rotates an expiring offline token. The returned refresh token replaces the old one. */
export async function refreshOfflineToken(shopDomain: string, refreshToken: string, opts: GrantOptions = {}): Promise<OfflineTokenGrant> {
  return requestOfflineToken(shopDomain, { grant_type: "refresh_token", refresh_token: refreshToken }, opts, "refresh");
}

/**
 * Swaps a legacy non-expiring offline token for an expiring one. Shopify retires the
 * old token for Admin API use; repeating the call with the same old token within 7
 * days returns the same pair, so a lost response can be recovered.
 */
export async function migrateToExpiringOfflineToken(shopDomain: string, nonExpiringToken: string, opts: GrantOptions = {}): Promise<OfflineTokenGrant> {
  return requestOfflineToken(shopDomain, {
    grant_type: TOKEN_EXCHANGE,
    subject_token: nonExpiringToken,
    subject_token_type: OFFLINE_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: "1",
  }, opts, "migration");
}
