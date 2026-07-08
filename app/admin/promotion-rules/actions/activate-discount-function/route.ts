import { NextResponse, type NextRequest } from "next/server";
import { activateLoopDeskDiscountFunction } from "../../../../../services/loopdesk/discount-function-activation.server";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) {
    return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401 });
  }

  try {
    const result = await activateLoopDeskDiscountFunction({ shopId: resolved.shop.id, shopDomain: resolved.shop.shopDomain });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Discount function activation failed." }, { status: 502 });
  }
}
