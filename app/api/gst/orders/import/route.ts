import { NextRequest, NextResponse } from "next/server";
import { importOrderByShopifyId } from "../../../../../services/gst/order-import";
import { getShopDomainFromRequest } from "../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const shopifyOrderId = String(body.shopifyOrderId || "").trim();
  const orderPayload = body.order && typeof body.order === "object" ? (body.order as Record<string, unknown>) : null;

  if (!shopifyOrderId) {
    return NextResponse.json({ ok: false, error: "shopifyOrderId is required" }, { status: 400 });
  }

  if (!orderPayload) {
    return NextResponse.json({ ok: false, error: "order payload is required" }, { status: 400 });
  }

  const shopDomain = getShopDomainFromRequest(req) || (body.shopDomain ? String(body.shopDomain) : undefined);
  const result = await importOrderByShopifyId(shopifyOrderId, orderPayload, { shopDomain });
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Failed to import order" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, order: result.data }, { status: 201 });
}
