import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { searchCollabVariants } from "../../../../../services/collab/collab-operations";

// Product search for the parcel form: title or SKU, with price, cost and stock.
export async function GET(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const variants = await searchCollabVariants(shop, req.nextUrl.searchParams.get("q") || "");
    return NextResponse.json({ variants }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Search failed." }, { status });
  }
}
