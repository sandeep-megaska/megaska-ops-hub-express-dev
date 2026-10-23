import crypto from "crypto";
import { prisma } from "../db/prisma";
import { encryptShopifyToken } from "./token-crypto";
import { getShopByDomain, type ShopRow } from "./shop";
import { exchangeSessionTokenForOfflineToken, shopNeedsInstall, ShopInstallError } from "./token-exchange";

export { ShopInstallError };

/*
  Shopify-managed install (shopify.app.toml: use_legacy_install_flow = false).
  Shopify installs the app and opens it in the admin with a session token; there is
  no OAuth redirect. The first verified admin request for a shop that has no usable
  Shop row (new install, reinstall after uninstall, or a missing token) swaps that
  session token for an offline Admin API token — Shopify's token exchange — and
  creates or reactivates the row. The OAuth callback stores tokens the same way.
*/

const ADMIN_API_VERSION = "2026-01";

function normalizeHost(input: string | null | undefined) {
  return String(input || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

async function fetchShopMetadata(shopDomain: string, accessToken: string) {
  try {
    const response = await fetch(`https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: `query LoopDeskShopInstallMetadata { shop { name myshopifyDomain primaryDomain { host url } } }` }),
    });
    if (!response.ok) return { shopName: null, myshopifyDomain: shopDomain, primaryDomain: null };
    const payload = (await response.json().catch(() => null)) as {
      data?: { shop?: { name?: string | null; myshopifyDomain?: string | null; primaryDomain?: { host?: string | null; url?: string | null } | null } };
    } | null;
    const shop = payload?.data?.shop;
    return {
      shopName: String(shop?.name || "").trim() || null,
      myshopifyDomain: normalizeHost(shop?.myshopifyDomain || shopDomain) || shopDomain,
      primaryDomain: normalizeHost(shop?.primaryDomain?.host || shop?.primaryDomain?.url || "") || null,
    };
  } catch {
    return { shopName: null, myshopifyDomain: shopDomain, primaryDomain: null };
  }
}

// Creates or reactivates the Shop row with an encrypted offline token. Shared by the
// token-exchange install and the OAuth callback.
export async function persistShopInstallation(input: { shopDomain: string; accessToken: string; scopes: string | null }) {
  const encryptedAccessToken = encryptShopifyToken(input.accessToken);
  // Tokens are stored encrypted only; without a key the install fails rather than
  // storing plaintext.
  if (!encryptedAccessToken) throw new ShopInstallError("Token encryption is not configured");

  const metadata = await fetchShopMetadata(input.shopDomain, input.accessToken);
  const appProxyEnabled = Boolean(process.env.SHOPIFY_APP_PROXY_PREFIX || process.env.SHOPIFY_APP_PROXY_SUBPATH || process.env.SHOPIFY_APP_URL);
  // Installation never depends on a deployment allowlist; module settings decide checkout features.
  const checkoutEnabled = false;
  const shopId = crypto.randomUUID();

  const rows = await prisma.$queryRaw<{ id: string; installationStatus: string | null; myshopifyDomain: string | null; hasAccessToken: boolean }[]>`
    INSERT INTO "Shop" (
      "id", "shopDomain", "accessToken", "accessTokenEncrypted", "scopes", "isActive", "installedAt", "uninstalledAt",
      "createdAt", "updatedAt", "myshopifyDomain", "primaryDomain", "shopName", "appProxyEnabled", "checkoutEnabled", "installationStatus"
    )
    VALUES (
      ${shopId}, ${input.shopDomain}, NULL, ${encryptedAccessToken}, ${input.scopes}, true, NOW(), NULL,
      NOW(), NOW(), ${metadata.myshopifyDomain}, ${metadata.primaryDomain}, ${metadata.shopName}, ${appProxyEnabled}, ${checkoutEnabled}, 'ACTIVE'
    )
    ON CONFLICT ("shopDomain") DO UPDATE SET
      "accessToken" = NULL,
      "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
      "scopes" = EXCLUDED."scopes",
      "isActive" = true,
      "installedAt" = NOW(),
      "uninstalledAt" = NULL,
      "updatedAt" = NOW(),
      "myshopifyDomain" = EXCLUDED."myshopifyDomain",
      "primaryDomain" = EXCLUDED."primaryDomain",
      "shopName" = EXCLUDED."shopName",
      "appProxyEnabled" = EXCLUDED."appProxyEnabled",
      "checkoutEnabled" = EXCLUDED."checkoutEnabled",
      "installationStatus" = 'ACTIVE'
    RETURNING "id", "installationStatus", "myshopifyDomain", ("accessToken" IS NOT NULL OR "accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
  `;

  console.info("[SHOP INSTALL] shop persisted", {
    shopId: rows[0]?.id || null,
    shopDomain: input.shopDomain,
    installationStatus: rows[0]?.installationStatus || "ACTIVE",
    hasAccessToken: Boolean(rows[0]?.hasAccessToken),
    scopesCount: input.scopes?.split(",").filter(Boolean).length || 0,
  });
  return rows[0] || null;
}

/**
 * Returns the installed Shop row for a shop whose identity was just verified from a
 * Shopify session token, installing or reactivating it first when needed. Returns the
 * existing row untouched when it is already usable, so this is cheap on every request.
 * `sessionToken` must be the raw, already-verified token for `shopDomain`.
 */
export async function ensureShopInstalled(shopDomain: string, sessionToken: string | null): Promise<ShopRow | null> {
  const existing = await getShopByDomain(shopDomain);
  if (!shopNeedsInstall(existing)) return existing;
  if (!sessionToken) return existing;

  try {
    const { accessToken, scopes } = await exchangeSessionTokenForOfflineToken(shopDomain, sessionToken);
    await persistShopInstallation({ shopDomain, accessToken, scopes });
  } catch (error) {
    console.error("[SHOP INSTALL] token exchange install failed", {
      shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });
    return existing;
  }
  return getShopByDomain(shopDomain);
}
