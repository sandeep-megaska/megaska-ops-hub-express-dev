import { NextRequest, NextResponse } from "next/server";
import { listDispatchReadyOrders } from "../../../../../services/gst/dispatch-batch";
import { resolveShopConfig } from "../../../../../services/shopify/shop";
import { resolveGstAdminShopDomain } from "../../../../../services/gst/request-shop";
import { gstPerfLog, gstPerfNow } from "../../../../../services/gst/perf";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const totalStartedAtMs = gstPerfNow();
  const shopDomain = await resolveGstAdminShopDomain(req);
  if (!shopDomain) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const shop = await resolveShopConfig(shopDomain);
  const query = req.nextUrl.searchParams;
  const result = await listDispatchReadyOrders({
    shopId: shop.id,
    from: query.get("from") || undefined,
    to: query.get("to") || undefined,
    invoiceStatus: query.get("invoiceStatus") || undefined,
    readiness: query.get("readiness") || undefined,
    syncRunId: query.get("syncRunId") || undefined,
  });

  gstPerfLog("api.gst.orders.dispatchReady.total", totalStartedAtMs, { ok: result.ok, count: result.ok ? (result.data || []).length : 0 });

  if (!result.ok) {
    return NextResponse.json({ ok: false, data: null, error: result.error || "Failed to load dispatch-ready orders" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data || [], error: null });
}
