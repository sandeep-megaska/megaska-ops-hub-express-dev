import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CHECKOUT_RECOVERY_EXPIRED_MESSAGE, validateCheckoutRecoveryToken } from "../../../../../services/express-checkout/recovery/tokens";
import { prisma } from "../../../../../services/db/prisma";
import { requireEnabledModule, requireShopFromAppProxy } from "../../../../../services/shopify/app-proxy";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "express_checkout");

    const token = request.nextUrl.searchParams.get("t") || "";
    if (!token) throw new Error(CHECKOUT_RECOVERY_EXPIRED_MESSAGE);

    const recovery = await validateCheckoutRecoveryToken({ shopId: shop.id, token });
    const checkoutIntents = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT "status"
      FROM "ExpressCheckoutIntent"
      WHERE "shopId" = ${shop.id} AND "id" = ${recovery.checkoutIntentId}
      LIMIT 1
    `;
    const checkoutIntent = checkoutIntents[0] || null;
    if (!checkoutIntent) throw new Error(CHECKOUT_RECOVERY_EXPIRED_MESSAGE);

    console.info("[CHECKOUT RECOVERY] recovery_route_valid", {
      shopId: shop.id,
      recoveryType: recovery.recoveryType,
      checkoutIntentStatus: checkoutIntent.status,
      expiresAt: recovery.expiresAt,
    });

    return NextResponse.json({
      recoverable: true,
      recoveryType: recovery.recoveryType,
      checkoutIntentStatus: checkoutIntent.status,
      expiresAt: recovery.expiresAt,
    });
  } catch {
    console.info("[CHECKOUT RECOVERY] recovery_route_invalid");
    return NextResponse.json({ recoverable: false, message: CHECKOUT_RECOVERY_EXPIRED_MESSAGE });
  }
}

export const dynamic = "force-dynamic";
