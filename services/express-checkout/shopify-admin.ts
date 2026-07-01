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
  primaryDomain: string | null;
  isActive: boolean | null;
  uninstalledAt: Date | null;
  accessToken: string | null;
  accessTokenEncrypted: string | null;
  scopes: string | null;
  updatedAt: Date | null;
};

type ShopifyAdminConfigOptions = {
  shopId?: string | null;
};

function getEnvTrimmed(name: string) {
  return String(process.env[name] || "").trim();
}

function getCanonicalShopId() {
  return getEnvTrimmed("MEGASKA_CANONICAL_SHOP_ID") || getEnvTrimmed("SHOPIFY_PRIMARY_SHOP_ID") || null;
}

function getExpectedAppIdentity() {
  return getEnvTrimmed("SHOPIFY_EXPECTED_APP_KEY") || getEnvTrimmed("SHOPIFY_APP_IDENTITY") || null;
}

function hasExpectedAppIdentity(row: Pick<ShopifyAdminConfigRow, "scopes"> | null | undefined) {
  const expected = getExpectedAppIdentity();
  if (!expected) return true;

  const scopes = String(row?.scopes || "");
  return scopes.includes(`app_identity:${expected}`) || scopes.includes(`shopify_app_key:${expected}`);
}

function isCanonicalShop(row: Pick<ShopifyAdminConfigRow, "resolvedShopId"> | null | undefined, canonicalShopId: string | null) {
  return !canonicalShopId || row?.resolvedShopId === canonicalShopId;
}

function logNoncanonicalInstallationIgnored(row: ShopifyAdminConfigRow | null | undefined, requestShop: string, canonicalShopId: string | null, reason: string) {
  console.warn("[SHOPIFY ADMIN CONFIG] noncanonical_installation_ignored", {
    ...safeCandidateDiagnostic(row, requestShop),
    canonicalShopId,
    reason,
  });
}

function hasStoredAdminToken(row: Pick<ShopifyAdminConfigRow, "accessToken" | "accessTokenEncrypted"> | null | undefined) {
  return Boolean(String(row?.accessToken || "").trim() || row?.accessTokenEncrypted);
}

function isActiveTokenBearingInstallation(row: ShopifyAdminConfigRow | null | undefined) {
  return Boolean(
    row &&
      row.installationStatus === "ACTIVE" &&
      row.isActive === true &&
      !row.uninstalledAt &&
      hasStoredAdminToken(row) &&
      hasExpectedAppIdentity(row)
  );
}

function decryptAdminAccessToken(row: Pick<ShopifyAdminConfigRow, "accessToken" | "accessTokenEncrypted"> | null | undefined) {
  return String(row?.accessToken || "").trim() || decryptShopifyToken(row?.accessTokenEncrypted || null);
}

function domainFamily(domain: string | null | undefined) {
  return normalizeShopDomain(domain)
    .replace(/^www\./, "")
    .replace(/\.myshopify\.com$/, "");
}

function rowDomains(row: ShopifyAdminConfigRow) {
  return [row.myshopifyDomain, row.shopDomain, row.primaryDomain]
    .map((domain) => normalizeShopDomain(domain))
    .filter(Boolean);
}

function candidateScore(row: ShopifyAdminConfigRow, requestShop: string) {
  if (normalizeShopDomain(row.myshopifyDomain) === requestShop) return 0;
  if (normalizeShopDomain(row.shopDomain) === requestShop) return 1;
  if (normalizeShopDomain(row.primaryDomain) === requestShop) return 2;

  const requestedFamily = domainFamily(requestShop);
  if (requestedFamily && rowDomains(row).some((domain) => domainFamily(domain) === requestedFamily)) return 3;

  return 4;
}

function safeCandidateDiagnostic(row: ShopifyAdminConfigRow | null | undefined, requestShop: string): ShopifyAdminShopDiagnostic & {
  shopDomain: string | null;
  primaryDomain: string | null;
  isActive: boolean | null;
  uninstalledAt: boolean;
} {
  return {
    resolvedShopId: row?.resolvedShopId || null,
    requestShop,
    shopDomain: row?.shopDomain || null,
    myshopifyDomain: row?.myshopifyDomain || null,
    primaryDomain: row?.primaryDomain || null,
    installationStatus: row?.installationStatus || null,
    isActive: row?.isActive ?? null,
    uninstalledAt: Boolean(row?.uninstalledAt),
    hasAccessToken: hasStoredAdminToken(row),
  };
}

async function getShopifyAdminConfig(shopDomain: string, options: ShopifyAdminConfigOptions = {}) {
  const requestShop = normalizeShopDomain(shopDomain);
  const requestedShopId = String(options.shopId || "").trim() || null;
  const canonicalShopId = getCanonicalShopId();

  console.info("[SHOPIFY ADMIN CONFIG] resolve_start", {
    requestShop,
    requestedShopId,
    canonicalShopId,
    expectedAppIdentityConfigured: Boolean(getExpectedAppIdentity()),
  });

  if (!requestShop && !requestedShopId) {
    console.warn("[SHOPIFY ADMIN CONFIG] missing_active_installation", { requestShop, requestedShopId });
    throw new ShopifyAdminConfigError(409, "No active Shopify installation found. Please reinstall the app.");
  }

  const shopIdRows = requestedShopId
    ? await prisma.$queryRaw<Array<ShopifyAdminConfigRow>>`
        SELECT
          "id" AS "resolvedShopId",
          ${requestShop} AS "requestShop",
          "shopDomain",
          "myshopifyDomain",
          "primaryDomain",
          "installationStatus",
          "isActive",
          "uninstalledAt",
          "accessToken",
          "accessTokenEncrypted",
          "scopes",
          "updatedAt",
          (("accessToken" IS NOT NULL AND "accessToken" <> '') OR "accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
        FROM "Shop"
        WHERE "id" = ${requestedShopId}
        LIMIT 1
      `
    : [];

  const shopIdRow = shopIdRows[0] || null;
  if (shopIdRow) {
    console.info("[SHOPIFY ADMIN CONFIG] candidate_found", safeCandidateDiagnostic(shopIdRow, requestShop));
    if (!isCanonicalShop(shopIdRow, canonicalShopId)) {
      logNoncanonicalInstallationIgnored(shopIdRow, requestShop, canonicalShopId, "requested_shop_id_does_not_match_canonical");
    } else if (!hasExpectedAppIdentity(shopIdRow)) {
      logNoncanonicalInstallationIgnored(shopIdRow, requestShop, canonicalShopId, "app_identity_mismatch");
    } else if (isActiveTokenBearingInstallation(shopIdRow)) {
      const accessToken = decryptAdminAccessToken(shopIdRow);
      if (accessToken) {
        const diagnostic: ShopifyAdminShopDiagnostic = {
          resolvedShopId: shopIdRow.resolvedShopId || null,
          requestShop,
          myshopifyDomain: shopIdRow.myshopifyDomain || null,
          installationStatus: shopIdRow.installationStatus || null,
          hasAccessToken: true,
        };
        console.info("[SHOPIFY ADMIN CONFIG] active_installation_selected", diagnostic);
        return {
          shopDomain: normalizeShopDomain(shopIdRow.myshopifyDomain || shopIdRow.shopDomain || requestShop),
          accessToken,
          diagnostic,
        };
      }
    }
  }

  const canonicalRows = canonicalShopId
    ? await prisma.$queryRaw<Array<ShopifyAdminConfigRow>>`
        SELECT
          "id" AS "resolvedShopId",
          ${requestShop} AS "requestShop",
          "shopDomain",
          "myshopifyDomain",
          "primaryDomain",
          "installationStatus",
          "isActive",
          "uninstalledAt",
          "accessToken",
          "accessTokenEncrypted",
          "scopes",
          "updatedAt",
          (("accessToken" IS NOT NULL AND "accessToken" <> '') OR "accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
        FROM "Shop"
        WHERE "id" = ${canonicalShopId}
        LIMIT 1
      `
    : [];

  const canonicalRow = canonicalRows[0] || null;
  if (canonicalRow) {
    console.info("[SHOPIFY ADMIN CONFIG] canonical_shop_preferred", safeCandidateDiagnostic(canonicalRow, requestShop));
    if (!hasExpectedAppIdentity(canonicalRow)) {
      logNoncanonicalInstallationIgnored(canonicalRow, requestShop, canonicalShopId, "canonical_app_identity_mismatch");
    } else if (isActiveTokenBearingInstallation(canonicalRow)) {
      const accessToken = decryptAdminAccessToken(canonicalRow);
      if (accessToken) {
        const diagnostic: ShopifyAdminShopDiagnostic = {
          resolvedShopId: canonicalRow.resolvedShopId || null,
          requestShop,
          myshopifyDomain: canonicalRow.myshopifyDomain || null,
          installationStatus: canonicalRow.installationStatus || null,
          hasAccessToken: true,
        };
        console.info("[SHOPIFY ADMIN CONFIG] active_installation_selected", diagnostic);
        return {
          shopDomain: normalizeShopDomain(canonicalRow.myshopifyDomain || canonicalRow.shopDomain || requestShop),
          accessToken,
          diagnostic,
        };
      }
    }
  }

  const rows = requestShop
    ? await prisma.$queryRaw<Array<ShopifyAdminConfigRow>>`
        SELECT
          "id" AS "resolvedShopId",
          ${requestShop} AS "requestShop",
          "shopDomain",
          "myshopifyDomain",
          "primaryDomain",
          "installationStatus",
          "isActive",
          "uninstalledAt",
          "accessToken",
          "accessTokenEncrypted",
          "scopes",
          "updatedAt",
          (("accessToken" IS NOT NULL AND "accessToken" <> '') OR "accessTokenEncrypted" IS NOT NULL) AS "hasAccessToken"
        FROM "Shop"
        WHERE "shopDomain" = ${requestShop}
          OR "myshopifyDomain" = ${requestShop}
          OR "primaryDomain" = ${requestShop}
          OR replace(regexp_replace(COALESCE("shopDomain", ''), '^www\\.', ''), '.myshopify.com', '') = ${domainFamily(requestShop)}
          OR replace(regexp_replace(COALESCE("myshopifyDomain", ''), '^www\\.', ''), '.myshopify.com', '') = ${domainFamily(requestShop)}
          OR replace(regexp_replace(COALESCE("primaryDomain", ''), '^www\\.', ''), '.myshopify.com', '') = ${domainFamily(requestShop)}
        ORDER BY
          CASE WHEN "installationStatus" = 'ACTIVE' AND "isActive" = true AND "uninstalledAt" IS NULL AND (("accessToken" IS NOT NULL AND "accessToken" <> '') OR "accessTokenEncrypted" IS NOT NULL) THEN 0 ELSE 1 END,
          "updatedAt" DESC
      `
    : [];

  for (const candidate of rows) {
    console.info("[SHOPIFY ADMIN CONFIG] candidate_found", safeCandidateDiagnostic(candidate, requestShop));
  }

  const eligibleRows = rows.filter((row) => {
    if (!isCanonicalShop(row, canonicalShopId)) {
      logNoncanonicalInstallationIgnored(row, requestShop, canonicalShopId, "candidate_does_not_match_canonical");
      return false;
    }
    if (!hasExpectedAppIdentity(row)) {
      logNoncanonicalInstallationIgnored(row, requestShop, canonicalShopId, "app_identity_mismatch");
      return false;
    }
    return isActiveTokenBearingInstallation(row);
  });

  const selected = eligibleRows
    .sort((left, right) => {
      const scoreDelta = candidateScore(left, requestShop) - candidateScore(right, requestShop);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
    })[0] || null;

  const accessToken = decryptAdminAccessToken(selected);
  const diagnostic: ShopifyAdminShopDiagnostic = {
    resolvedShopId: selected?.resolvedShopId || null,
    requestShop,
    myshopifyDomain: selected?.myshopifyDomain || null,
    installationStatus: selected?.installationStatus || null,
    hasAccessToken: Boolean(selected && accessToken),
  };

  if (!selected || !accessToken) {
    console.warn("[SHOPIFY ADMIN CONFIG] missing_active_installation", {
      ...diagnostic,
      requestedShopId,
      candidatesChecked: rows.length + shopIdRows.length + canonicalRows.length,
    });
    throw new ShopifyAdminConfigError(409, "No active Shopify installation found. Please reinstall the app.");
  }

  console.info("[SHOPIFY ADMIN CONFIG] active_installation_selected", diagnostic);

  return {
    shopDomain: normalizeShopDomain(selected.myshopifyDomain || selected.shopDomain || requestShop),
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

async function markShopifyAdminTokenInvalid(shopId: string | null | undefined) {
  if (!shopId) return;

  await prisma.$executeRaw`
    UPDATE "Shop"
    SET "installationStatus" = 'TOKEN_INVALID', "tokenRotationRequiredAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = ${shopId}
  `;
}

export async function shopifyAdminGraphql<T>(shopDomain: string, query: string, variables: JsonRecord = {}, options: ShopifyAdminConfigOptions = {}) {
  const adminConfig = await getShopifyAdminConfig(shopDomain, options);
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
    if (response.status === 401) {
      console.error("[SHOPIFY ADMIN API ERROR] 401_token_invalid", {
        shopDomain: normalizedShopDomain,
        resolvedShopId: adminConfig.diagnostic.resolvedShopId,
        installationStatus: adminConfig.diagnostic.installationStatus,
        hasAccessToken: Boolean(accessToken),
        shopifyRequestId: response.headers.get("x-request-id"),
        adminApiUrl,
        responseBody,
      });
      await markShopifyAdminTokenInvalid(adminConfig.diagnostic.resolvedShopId);
      throw new ShopifyAdminConfigError(401, "Shopify Admin token is invalid for this app installation. Reinstall the production app.");
    }

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
