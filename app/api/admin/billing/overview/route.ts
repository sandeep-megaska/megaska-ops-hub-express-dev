import { NextRequest, NextResponse } from "next/server";
import { getMerchantBillingOverview } from "../../../../../services/billing/merchant-billing-overview";
import { getPrimaryCommercialPlanCode } from "../../../../../services/billing/commercial-catalog-health";
import { billingOverviewErrorResponse } from "../../../../../services/billing/overview-errors";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401, headers });
  try { return NextResponse.json({ ok: true, overview: await getMerchantBillingOverview({ shopId: resolved.shop.id }) }, { headers }); }
  catch (error) {
    const response = billingOverviewErrorResponse(error);
    console.error("billing_overview_load_failed", { shopId: resolved.shop.id, errorCode: response.body.error, errorName: error instanceof Error ? error.name : "UnknownError", safeErrorMessage: response.body.message, primaryPlanCode: getPrimaryCommercialPlanCode(), duration: Date.now() - startedAt });
    return NextResponse.json(response.body, { status: response.status, headers });
  }
}
