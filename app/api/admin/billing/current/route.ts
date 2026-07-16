import { NextRequest, NextResponse } from "next/server";
import { getMerchantBillingDashboard } from "../../../../../services/billing/billing-dashboard.service";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) return NextResponse.json({ ok: false, error: formatAdminShopResolutionError(resolved) }, { status: 401, headers });
  try {
    const dashboard = await getMerchantBillingDashboard({ shopId: resolved.shop.id });
    console.info("billing_dashboard_loaded", { shopId: resolved.shop.id, subscriptionId: dashboard.subscription?.subscriptionId ?? null, billingPeriodId: dashboard.currentPeriod?.billingPeriodId ?? null, provider: dashboard.provider?.provider ?? null, result: "success", duration: Date.now() - startedAt });
    return NextResponse.json({ ok: true, dashboard }, { headers });
  } catch {
    console.error("billing_dashboard_load_failed", { shopId: resolved.shop.id, result: "failed", duration: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: "Unable to load billing summary" }, { status: 500, headers });
  }
}
