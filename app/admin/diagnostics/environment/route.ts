import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import {
  getAdminShopDomainFromSearchParams,
  type AdminShopSearchParams,
} from "../../../../services/shopify/admin-shop-context";
import { LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } from "../../../../services/loopdesk/merchant-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShopDiagnosticRow = {
  id: string;
  shopDomain: string;
  isActive: boolean;
  uninstalledAt: Date | null;
  installationStatus: string | null;
};

function hasEnv(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

function diagnosticSecret() {
  return String(
    process.env.ADMIN_OPS_KEY || process.env.INTERNAL_DIAGNOSTIC_SECRET || "",
  ).trim();
}

function providedSecret(req: NextRequest) {
  const url = new URL(req.url);
  return String(
    req.headers.get("x-admin-ops-key") ||
      req.headers.get("x-internal-diagnostic-secret") ||
      url.searchParams.get("ops_key") ||
      url.searchParams.get("diagnostic_secret") ||
      "",
  ).trim();
}

function isAuthorized(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const expected = diagnosticSecret();
  if (!expected) return false;

  return providedSecret(req) === expected;
}

function collectSearchParams(req: NextRequest) {
  const url = new URL(req.url);
  const params: AdminShopSearchParams = {};
  url.searchParams.forEach((value, key) => {
    const existing = params[key];
    if (Array.isArray(existing)) existing.push(value);
    else if (existing !== undefined) params[key] = [existing, value];
    else params[key] = value;
  });
  return params;
}

async function findShop(shopDomain: string) {
  if (!shopDomain) return null;

  const rows = await prisma.$queryRaw<ShopDiagnosticRow[]>`
    SELECT "id", "shopDomain", "isActive", "uninstalledAt", "installationStatus"
    FROM "Shop"
    WHERE "shopDomain" = ${shopDomain} OR "myshopifyDomain" = ${shopDomain}
    ORDER BY CASE WHEN "installationStatus" = 'ACTIVE' THEN 0 ELSE 1 END, "updatedAt" DESC
    LIMIT 1
  `;

  return rows[0] || null;
}

async function runtimeConfigExists(shopId: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "ShopModuleConfig"
    WHERE "shopId" = ${shopId} AND "moduleKey" = ${LOOPDESK_RUNTIME_CONFIG_MODULE_KEY}
    LIMIT 1
  `;

  return Boolean(rows[0]?.id);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Diagnostics are not authorized." },
      { status: 403 },
    );
  }

  const params = collectSearchParams(req);
  const shopQueryParam = String(
    Array.isArray(params.shop) ? params.shop[0] || "" : params.shop || "",
  );
  const resolvedShopDomain = getAdminShopDomainFromSearchParams(params);

  let dbConnectionOk = false;
  let dbError: string | null = null;
  let installedActiveShopRowExists = false;
  let runtimeConfigRowExists = false;
  let shopRowStatus: Pick<
    ShopDiagnosticRow,
    "shopDomain" | "isActive" | "installationStatus"
  > | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnectionOk = true;

    const shop = await findShop(resolvedShopDomain);
    if (shop) {
      installedActiveShopRowExists = Boolean(
        shop.isActive && !shop.uninstalledAt,
      );
      shopRowStatus = {
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        installationStatus: shop.installationStatus,
      };
      runtimeConfigRowExists = await runtimeConfigExists(shop.id);
    }
  } catch (error) {
    dbError = error instanceof Error ? error.message : "Unknown database error";
  }

  return NextResponse.json({
    ok: true,
    env: {
      DATABASE_URL: hasEnv("DATABASE_URL"),
      SHOPIFY_API_KEY: hasEnv("SHOPIFY_API_KEY"),
      SHOPIFY_API_SECRET: hasEnv("SHOPIFY_API_SECRET"),
      SHOPIFY_APP_URL: hasEnv("SHOPIFY_APP_URL"),
      SHOPIFY_SCOPES: hasEnv("SHOPIFY_SCOPES"),
      SHOPIFY_STORE_DOMAIN: hasEnv("SHOPIFY_STORE_DOMAIN"),
      APP_BASE_URL: hasEnv("APP_BASE_URL"),
      NEXT_PUBLIC_APP_URL: hasEnv("NEXT_PUBLIC_APP_URL"),
    },
    db: {
      connectionOk: dbConnectionOk,
      error: dbError,
    },
    shop: {
      queryParam: shopQueryParam || null,
      resolvedShop: resolvedShopDomain || null,
      installedActiveShopRowExists,
      rowStatus: shopRowStatus,
    },
    runtimeConfig: {
      rowExists: runtimeConfigRowExists,
      moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY,
    },
    runtime: {
      nodeEnv: process.env.NODE_ENV || null,
      vercelEnvironment: process.env.VERCEL_ENV || null,
    },
  });
}
