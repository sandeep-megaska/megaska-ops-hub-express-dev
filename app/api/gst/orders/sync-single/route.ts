import { NextRequest, NextResponse } from "next/server";
import { syncSingleOrder } from "../../../../../services/gst/order-sync";
import { getShopDomainFromRequest } from "../../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, data: null, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await syncSingleOrder({
    orderName: body.orderName ? String(body.orderName) : undefined,
    orderNumber: body.orderNumber ? String(body.orderNumber) : undefined,
    forceResync: Boolean(body.forceResync),
    shopDomain: getShopDomainFromRequest(req) || (body.shopDomain ? String(body.shopDomain) : undefined),
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, data: null, error: result.error || "Failed to sync order" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data, error: null });
}
