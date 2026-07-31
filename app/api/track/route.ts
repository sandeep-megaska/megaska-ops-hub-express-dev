import { NextRequest, NextResponse } from "next/server";
import { isVerifiedInternalAppProxyRequest } from "../../../services/shopify/app-proxy";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../services/shopify/shop";
import { recordFunnelEventsFromBeacon } from "../../../services/analytics/funnel-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Storefront funnel-event beacon. Reached only through the Shopify app proxy at
// /apps/loopd2c/api/track, which verifies Shopify's signature and re-signs the
// internal hop. We require that internal proof so the write path can't be forged
// by a direct POST. Always responds 200 with no-store — analytics must never
// break or slow the storefront.
const OK = (inserted: number) =>
  NextResponse.json({ ok: true, inserted }, { headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  if (!isVerifiedInternalAppProxyRequest(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  if (!shop.id) return OK(0);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return OK(0);
  }

  try {
    const { inserted } = await recordFunnelEventsFromBeacon(req, shop.id, body);
    return OK(inserted);
  } catch {
    // Swallow analytics failures — never surface them to the storefront.
    return OK(0);
  }
}
