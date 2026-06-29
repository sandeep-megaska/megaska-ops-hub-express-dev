import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireEnabledModule, requireShopFromAppProxy } from "../../../../../services/shopify/app-proxy";
import { CHECKOUT_RECOVERY_EXPIRED_MESSAGE, validateCheckoutRecoveryToken } from "../../../../../services/express-checkout/recovery/tokens";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "express_checkout");

    const token = request.nextUrl.searchParams.get("t") || "";
    if (!token) return NextResponse.json({ ok: false, error: CHECKOUT_RECOVERY_EXPIRED_MESSAGE }, { status: 400 });

    const recovery = await validateCheckoutRecoveryToken({ shopId: shop.id, token });
    return NextResponse.json({ ok: true, recovery });
  } catch {
    return NextResponse.json({ ok: false, error: CHECKOUT_RECOVERY_EXPIRED_MESSAGE }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
