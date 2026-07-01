import { normalizeShopDomain } from "./shop-resolver";
import { decryptShopifyToken } from "./token-crypto";

export type ShopifyAdminTokenSource =
  | "runtime_client_credentials"
  | "shop_stored_token"
  | "encrypted_shop_stored_token";

export type ResolveShopifyAdminAccessTokenInput = {
  shopDomain: string | null | undefined;
  storedAccessToken?: string | null;
  storedAccessTokenEncrypted?: string | null;
  preferRuntime?: boolean;
};

export type ResolvedShopifyAdminAccessToken = {
  accessToken: string;
  tokenSource: ShopifyAdminTokenSource;
  expiresAt?: number | null;
};

type CachedRuntimeToken = {
  accessToken: string;
  expiresAt: number;
};

const runtimeTokenCache = new Map<string, CachedRuntimeToken>();

function getEnvTrimmed(name: string) {
  return String(process.env[name] || "").trim();
}

function runtimeCredentials() {
  return {
    apiKey: getEnvTrimmed("SHOPIFY_API_KEY"),
    apiSecret: getEnvTrimmed("SHOPIFY_API_SECRET"),
  };
}

function resolveStoredToken(input: ResolveShopifyAdminAccessTokenInput): ResolvedShopifyAdminAccessToken | null {
  const directToken = String(input.storedAccessToken || "").trim();
  if (directToken) {
    return {
      accessToken: directToken,
      tokenSource: "shop_stored_token",
      expiresAt: null,
    };
  }

  const encryptedToken = decryptShopifyToken(input.storedAccessTokenEncrypted || null);
  if (encryptedToken) {
    return {
      accessToken: encryptedToken,
      tokenSource: "encrypted_shop_stored_token",
      expiresAt: null,
    };
  }

  return null;
}

async function fetchRuntimeAdminAccessToken(shopDomain: string): Promise<ResolvedShopifyAdminAccessToken> {
  const { apiKey, apiSecret } = runtimeCredentials();
  if (!shopDomain || !apiKey || !apiSecret) {
    throw new Error("Shopify runtime admin authentication is not configured");
  }

  const now = Date.now();
  const cached = runtimeTokenCache.get(shopDomain);
  if (cached && cached.expiresAt > now) {
    console.info("[SHOPIFY AUTH SERVER] reusing cached runtime admin access token", {
      shopDomain,
      expiresInSecApprox: Math.max(0, Math.floor((cached.expiresAt - now) / 1000)),
    });
    return {
      accessToken: cached.accessToken,
      tokenSource: "runtime_client_credentials",
      expiresAt: cached.expiresAt,
    };
  }

  console.info("[SHOPIFY AUTH SERVER] fetching runtime admin access token", {
    shopDomain,
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecret),
  });

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "client_credentials",
    }),
  });

  const rawText = await response.text().catch(() => "");
  let payload: { access_token?: string; expires_in?: number | string } | null = null;
  try {
    payload = rawText ? (JSON.parse(rawText) as { access_token?: string; expires_in?: number | string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error("[SHOPIFY AUTH SERVER] runtime admin token fetch failed", {
      shopDomain,
      status: response.status,
      responsePreview: rawText.slice(0, 200),
    });
    throw new Error(`Failed to obtain Shopify Admin access token (${response.status})`);
  }

  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Failed to obtain Shopify Admin access token");
  }

  const expiresInSecondsRaw = Number(payload?.expires_in);
  const expiresInSeconds = Number.isFinite(expiresInSecondsRaw) && expiresInSecondsRaw > 0 ? expiresInSecondsRaw : 300;
  const refreshEarlySeconds = 60;
  const cacheTtlSeconds = Math.max(30, expiresInSeconds - refreshEarlySeconds);
  const expiresAt = Date.now() + cacheTtlSeconds * 1000;

  runtimeTokenCache.set(shopDomain, { accessToken, expiresAt });

  return {
    accessToken,
    tokenSource: "runtime_client_credentials",
    expiresAt,
  };
}

export async function resolveShopifyAdminAccessToken(
  input: ResolveShopifyAdminAccessTokenInput
): Promise<ResolvedShopifyAdminAccessToken> {
  const shopDomain = normalizeShopDomain(input.shopDomain);
  const preferRuntime = input.preferRuntime !== false;
  const { apiKey, apiSecret } = runtimeCredentials();

  if (preferRuntime && shopDomain && apiKey && apiSecret) {
    try {
      return await fetchRuntimeAdminAccessToken(shopDomain);
    } catch (error) {
      console.warn("[SHOPIFY AUTH SERVER] runtime admin token unavailable; falling back to stored shop token", {
        shopDomain,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  const storedToken = resolveStoredToken(input);
  if (storedToken) return storedToken;

  throw new Error("Missing installed Shopify Admin token. Reinstall app through /api/auth/install?shop=" + shopDomain);
}
