import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { setStyle, settleStyle } from "../../../../../../services/exchange/style-operations";

export const maxDuration = 30;

// action=set: { itemId, variantId | null } picks a different style (null = back to same product).
// action=settle: { settlement, note? } settles the price difference.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = body.action === "set"
      ? await setStyle(shop, id, String(body.itemId || ""), typeof body.variantId === "string" && body.variantId ? body.variantId : null)
      : body.action === "settle"
        ? await settleStyle(shop, id, String(body.settlement || ""), typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null)
        : { ok: false as const, status: 400, error: "Unknown action." };
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the exchange." }, { status });
  }
}
