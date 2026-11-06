import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../services/shopify/shop";
import { createCollabShipment } from "../../../../services/collab/collab-operations";
import { monthRange, normalizeCollabInput, summarizeCollabs } from "../../../../services/collab/collab-shipments";

export const maxDuration = 60;

function fail(error: unknown, fallback: string) {
  const status = error instanceof ShopResolutionError ? error.status : 500;
  console.error("[COLLAB SHIPMENTS ERROR]", { message: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

// Parcels for one month (IST) with totals for the summary row.
export async function GET(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const range = monthRange(req.nextUrl.searchParams.get("month"));
    const rows = await prisma.collabShipment.findMany({
      where: { shopId: shop.id, createdAt: { gte: range.from, lt: range.to } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ month: range.month, summary: summarizeCollabs(rows), rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error, "Could not load parcels.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const parsed = normalizeCollabInput(await req.json().catch(() => ({})));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const result = await createCollabShipment(shop, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error, id: "id" in result ? result.id : null }, { status: 422 });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error, "Could not create the parcel.");
  }
}
