import { NextRequest, NextResponse } from "next/server";
import { syncOrdersByDateRange } from "../../../../../services/gst/order-sync";
import {
  getShopDomainFromRequest,
  normalizeShopDomain,
} from "../../../../../services/shopify/shop";

export const runtime = "nodejs";

function getShopDomainFromReferer(req: NextRequest): string {
  const referer = req.headers.get("referer") || req.headers.get("origin") || "";
  try {
    const url = new URL(referer);
    return normalizeShopDomain(url.searchParams.get("shop"));
  } catch {
    return "";
  }
}

function resolveGstSyncShopDomain(
  req: NextRequest,
  body: Record<string, unknown>
): string | undefined {
  const bodyShopValue =
    typeof body.shopDomain === "string"
      ? body.shopDomain
      : typeof body.shop === "string"
        ? body.shop
        : typeof body.shopifyShopDomain === "string"
          ? body.shopifyShopDomain
          : typeof body.myshopifyDomain === "string"
            ? body.myshopifyDomain
            : undefined;

  const fromBody = normalizeShopDomain(bodyShopValue);
  const fromRequest = getShopDomainFromRequest(req);
  const fromReferer = getShopDomainFromReferer(req);
  const fromEnv = normalizeShopDomain(process.env.SHOPIFY_STORE_DOMAIN);

  const resolved = fromBody || fromRequest || fromReferer || fromEnv;

  console.log("[GST SHOP SCOPE]", {
    bodyShopDomain: fromBody || null,
    requestShopDomain: fromRequest || null,
    refererShopDomain: fromReferer || null,
    envShopDomain: fromEnv || null,
    resolvedShopDomain: resolved || null,
  });

  return resolved || undefined;
}
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, data: null, error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const from = String(body.from || "").trim();
  const to = String(body.to || "").trim();

  if (!from || !to) {
    return NextResponse.json(
      { ok: false, data: null, error: "from and to are required for sync" },
      { status: 400 }
    );
  }

  const shopDomain = resolveGstSyncShopDomain(req, body);

  const result = await syncOrdersByDateRange({
    from,
    to,
    financialStatus: Array.isArray(body.financialStatus)
      ? body.financialStatus.map(String)
      : undefined,
    fulfillmentStatus: Array.isArray(body.fulfillmentStatus)
      ? body.fulfillmentStatus.map(String)
      : undefined,
    forceResync: Boolean(body.forceResync),
    shopDomain,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: result.error || "Failed to sync orders",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    error: null,
  });
}
