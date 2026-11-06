import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { collabCsv, monthRange } from "../../../../../services/collab/collab-shipments";

// CSV for the accountant: one line per item with retail value, cost and shipping.
export async function GET(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const range = monthRange(req.nextUrl.searchParams.get("month"));
    const rows = await prisma.collabShipment.findMany({
      where: { shopId: shop.id, createdAt: { gte: range.from, lt: range.to }, status: { in: ["ORDER_CREATED", "BOOKED"] } },
      orderBy: { createdAt: "asc" },
    });
    return new NextResponse(collabCsv(rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="collab-parcels-${range.month}.csv"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export failed." }, { status });
  }
}
