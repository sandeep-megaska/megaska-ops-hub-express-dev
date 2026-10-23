// Shopify token exchange and the "does this shop need installing" check. No imports,
// so it can be unit-tested directly; services/shopify/install.ts wires it to the database.

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

export function shopNeedsInstall(shop: ShopInstallState | null) {
  if (!shop) return true;
  if (!shop.isActive || shop.uninstalledAt) return true;
  return !shop.accessToken && !shop.accessTokenEncrypted;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function exchangeSessionTokenForOfflineToken(
  shopDomain: string,
  sessionToken: string,
  opts: { apiKey?: string; apiSecret?: string; fetchImpl?: FetchLike } = {},
): Promise<{ accessToken: string; scopes: string | null }> {
  const apiKey = String(opts.apiKey ?? process.env.SHOPIFY_API_KEY ?? "").trim();
  const apiSecret = String(opts.apiSecret ?? process.env.SHOPIFY_API_SECRET ?? "").trim();
  if (!apiKey || !apiSecret) throw new ShopInstallError("Shopify API credentials are not configured");

  const response = await (opts.fetchImpl ?? fetch)(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    }),
  });

  if (!response.ok) throw new ShopInstallError(`Token exchange failed (HTTP ${response.status})`);
  const data = (await response.json().catch(() => null)) as { access_token?: string; scope?: string } | null;
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) throw new ShopInstallError("Token exchange returned no access token");
  return { accessToken, scopes: String(data?.scope || "").trim() || null };
}
