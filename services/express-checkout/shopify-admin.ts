import { prisma } from "../db/prisma";
import { normalizeShopDomain } from "../shopify/shop";
import { decryptShopifyToken } from "../shopify/token-crypto";

const SHOPIFY_API_VERSION = "2026-01";

type JsonRecord = Record<string, unknown>;

export type ShopifyAdminShopDiagnostic = {
  resolvedShopId: string | null;
  requestShop: string | null;
  myshopifyDomain: string | null;
  installationStatus: string | null;
  hasAccessToken: boolean;
};

export class ShopifyAdminConfigError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ShopifyAdminConfigError";
    this.status = status;
  }
}

type ShopifyAdminConfigRow = ShopifyAdminShopDiagnostic & {
  shopDomain: string | null;
  accessTokenEncrypted: string | null;
};

async function getShopifyAdminConfig(shopDomain: string) {
  const requestShop = normalizeShopDomain(shopDomain);
  const rows = await prisma.$queryRaw<Array<ShopifyAdminConfigRow>>`
    SELECT
      "id" AS "resolvedShopId",
      ${requestShop} AS "requestShop",
      "shopDomain",
      "myshopifyDomain",
      "installationStatus",
      "accessTokenEncrypted",
      ("accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
    FROM "Shop"
    WHERE ("shopDomain" = ${requestShop} OR "myshopifyDomain" = ${requestShop})
      AND "installationStatus" = 'ACTIVE'
      AND "isActive" = true
      AND "uninstalledAt" IS NULL
      AND "accessTokenEncrypted" IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;
  const row = rows[0] || null;
  const accessToken = decryptShopifyToken(row?.accessTokenEncrypted || null);
  const diagnostic: ShopifyAdminShopDiagnostic = {
    resolvedShopId: row?.resolvedShopId || null,
    requestShop,
    myshopifyDomain: row?.myshopifyDomain || null,
    installationStatus: row?.installationStatus || null,
    hasAccessToken: Boolean(row?.hasAccessToken && accessToken),
  };

  if (!row || !accessToken) {
    console.warn("[SHOPIFY ADMIN CONFIG] missing active installation", diagnostic);
    throw new ShopifyAdminConfigError(409, "No active Shopify installation found. Please reinstall the app.");
  }

  return {
    shopDomain: normalizeShopDomain(row.myshopifyDomain || row.shopDomain || requestShop),
    accessToken,
    diagnostic,
  };
}

function parseShopifyAdminResponseBody(rawText: string) {
  if (!rawText) return null;

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

export async function shopifyAdminGraphql<T>(shopDomain: string, query: string, variables: JsonRecord = {}) {
  const adminConfig = await getShopifyAdminConfig(shopDomain);
  const normalizedShopDomain = adminConfig.shopDomain;
  const accessToken = adminConfig.accessToken;
  const adminApiUrl = `https://${normalizedShopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  console.info("[SHOPIFY ADMIN CONFIG] resolved", adminConfig.diagnostic);

  const response = await fetch(adminApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const rawText = await response.text().catch(() => "");
  const responseBody = parseShopifyAdminResponseBody(rawText);

  if (!response.ok) {
    console.error("[SHOPIFY ADMIN API ERROR]", {
      status: response.status,
      statusText: response.statusText,
      shopDomain: normalizedShopDomain,
      resolvedShopId: adminConfig.diagnostic.resolvedShopId,
      installationStatus: adminConfig.diagnostic.installationStatus,
      hasAccessToken: Boolean(accessToken),
      shopifyRequestId: response.headers.get("x-request-id"),
      adminApiUrl,
      responseBody,
    });
    throw new Error(`Shopify Admin API failed (${response.status})`);
  }

  const payload = responseBody as { data?: T; errors?: Array<{ message?: string }> } | null;
  if (payload?.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join(", "));
  }
  if (!payload?.data) throw new Error("Shopify Admin API response missing data");

  return payload.data;
}

export async function validateShopifyAdminToken(shopDomain: string) {
  return shopifyAdminGraphql<{
    shop?: {
      id?: string | null;
      name?: string | null;
      myshopifyDomain?: string | null;
    } | null;
  }>(
    shopDomain,
    `query ValidateShopifyAdminToken {
      shop {
        id
        name
        myshopifyDomain
      }
    }`,
    {}
  );
}
