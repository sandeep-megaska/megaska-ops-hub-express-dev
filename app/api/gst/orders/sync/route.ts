import { NextRequest, NextResponse } from "next/server";
import { syncOrdersByDateRange } from "../../../../../services/gst/order-sync";
import { resolveGstAdminShopDomain } from "../../../../../services/gst/request-shop";

export const runtime = "nodejs";

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

  // The shop comes only from the verified session token — never the body, referer or a default store.
  const shopDomain = await resolveGstAdminShopDomain(req);
  if (!shopDomain) return NextResponse.json({ ok: false, data: null, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });

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
