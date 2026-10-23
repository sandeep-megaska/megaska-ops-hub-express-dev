import { NextRequest, NextResponse } from "next/server";
import { resolveGstAdminShopId } from "../../../../services/gst/request-shop";
import { assignSlabToHsn, listHsnSlabMaps } from "../../../../services/gst/hsn";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const result = await listHsnSlabMaps();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data ?? [] });
}

export async function POST(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await assignSlabToHsn({
    hsnId: String(body.hsnId || ""),
    slabId: String(body.slabId || ""),
    effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
    effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
    priority: body.priority !== undefined ? Number(body.priority) : 0,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data }, { status: 201 });
}
