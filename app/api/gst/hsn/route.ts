import { NextRequest, NextResponse } from "next/server";
import { resolveGstAdminShopId } from "../../../../services/gst/request-shop";
import { assignSlabToHsn, deleteHsnCode, listHsnCodes, upsertHsnCode } from "../../../../services/gst/hsn";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const result = await listHsnCodes();
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

  if (body.hsnId && body.slabId) {
    const assignment = await assignSlabToHsn({
      hsnId: String(body.hsnId),
      slabId: String(body.slabId),
      effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
      effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
      priority: body.priority ? Number(body.priority) : 0,
    });

    if (!assignment.ok) {
      return NextResponse.json({ ok: false, error: assignment.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: assignment.data }, { status: 201 });
  }

  const result = await upsertHsnCode({
    id: body.id ? String(body.id) : undefined,
    hsnCode: String(body.hsnCode || ""),
    description: String(body.description || ""),
    isService: body.isService === true,
    isActive: body.isActive === false ? false : true,
    effectiveFrom: body.effectiveFrom ? String(body.effectiveFrom) : null,
    effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null,
    metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unauthorized. Reopen this page from Shopify admin." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const result = await deleteHsnCode(id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data }, { status: 200 });
}
