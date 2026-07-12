import { NextRequest, NextResponse } from "next/server";
import { resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context.ts";
import { synchronizePromotionFunctionConfiguration } from "../../../../../services/promotions/runtime/synchronization.server.ts";

function hasManageScope(request: Request) {
  return String(request.headers.get("x-loopdesk-admin-scopes") || request.headers.get("x-admin-scopes") || "")
    .split(/[\s,]+/)
    .includes("promotions.manage");
}

export async function POST(request: NextRequest) {
  if (!hasManageScope(request)) return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "promotions.manage authorization is required.", retryable: false }, { status: 403 });
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, code: "SHOP_NOT_FOUND", message: resolved.error || "Unable to resolve embedded admin shop session.", retryable: false }, { status: 401 });
  const result = await synchronizePromotionFunctionConfiguration({ shopId: resolved.shop.id });
  if (result.ok) return NextResponse.json(result, { status: 200 });
  return NextResponse.json(result, { status: result.retryable ? 409 : 500 });
}
