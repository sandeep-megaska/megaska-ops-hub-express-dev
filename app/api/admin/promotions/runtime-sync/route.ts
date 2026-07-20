import { NextRequest, NextResponse } from "next/server";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromRequest,
} from "../../../../../services/shopify/admin-shop-context.ts";
import { manuallySynchronizePromotionConfiguration } from "../../../../../services/promotions/publication-orchestration.server.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const resolved = await resolveAdminShopFromRequest(request);

  if (!resolved.shop?.id) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNAUTHORIZED",
        message: formatAdminShopResolutionError(resolved),
        retryable: false,
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await manuallySynchronizePromotionConfiguration(resolved.shop.id, resolved.shop.shopDomain);

  if (result.ok) {
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(result, {
    status: result.retryable ? 409 : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
