import type { NextRequest } from "next/server";

const ASSET_BASE = "/apps/loopd2c/customer/reviews/write/assets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Write a review</title><link rel="stylesheet" href="${ASSET_BASE}/loopdesk-product-reviews.css"></head><body><main style="min-height:60vh;padding:2rem"><div data-loopdesk-review-token-page data-app-proxy-base="/apps/loopd2c" data-token-present="${token ? "1" : "0"}" aria-live="polite">Loading review form…</div></main><script src="${ASSET_BASE}/loopdesk-product-reviews.js" defer></script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
