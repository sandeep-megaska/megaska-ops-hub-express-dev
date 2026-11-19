import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { lookupOrderForReversePickup } from "../../../../../services/exchange/manual-reverse-pickup";
import { manualPickupErrorResponse } from "../../../../../services/exchange/manual-reverse-pickup-http";

export const runtime = "nodejs";

// GET ?order=522404: the order's items, pickup address, delivery date / window
// and any open exchange or issue, for the "Arrange reverse pickup" form.
export async function GET(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const order = req.nextUrl.searchParams.get("order") || "";
    const result = await lookupOrderForReversePickup(shop.id, order);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return manualPickupErrorResponse(error, "order lookup");
  }
}
