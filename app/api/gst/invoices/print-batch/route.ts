import { NextRequest, NextResponse } from "next/server";
import { resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import { prepareInvoicePrintBatch } from "../../../../../services/gst/dispatch-batch";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, data: null, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await prepareInvoicePrintBatch({
    shopId,
    documentIds: Array.isArray(body.documentIds) ? body.documentIds.map(String) : undefined,
    orderImportIds: Array.isArray(body.orderImportIds) ? body.orderImportIds.map(String) : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, data: null, error: result.error || "Failed to prepare print batch" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data, error: null });
}
