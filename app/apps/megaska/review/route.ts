import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireStorefrontShopFromAppProxy } from "../../../../services/shopify/app-proxy";
export async function GET(request: NextRequest) {
  try {
    await requireStorefrontShopFromAppProxy(request);
    const assetOrigin = request.nextUrl.origin;
    return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Leave a review</title><link rel="stylesheet" href="${assetOrigin}/loopdesk-review-submission.css"></head><body><main id="loopdesk-review-submission" class="loopdesk-review" aria-live="polite"><p>Loading your review form…</p></main><script src="${assetOrigin}/loopdesk-review-submission.js" defer></script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return appProxyHtmlError(error); }
}
export const dynamic = "force-dynamic";
