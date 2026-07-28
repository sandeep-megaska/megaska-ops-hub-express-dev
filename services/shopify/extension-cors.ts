import { NextRequest, NextResponse } from "next/server";

const EXTENSION_ORIGIN = "https://extensions.shopifycdn.com";

// Origins that legitimately call our backend on behalf of the merchant admin:
//  - extensions.shopifycdn.com: the sandbox the admin UI / print-action
//    extensions run in, where our own fetch() calls originate.
//  - admin.shopify.com: the print preview modal issues the document fetch for
//    the `src` we hand it from THIS origin, not the extension sandbox - so a
//    hardcoded extension origin makes that preflight fail with a CORS error.
//  - <shop>.myshopify.com: legacy/embedded admin surfaces still served from the
//    merchant's own myshopify domain.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/extensions\.shopifycdn\.com$/i,
  /^https:\/\/admin\.shopify\.com$/i,
  /^https:\/\/[a-z0-9][a-z0-9-]*\.myshopify\.com$/i,
];

function resolveAllowedOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(requestOrigin))) {
    return requestOrigin;
  }
  // Fall back to the extension sandbox origin so existing extension fetch()
  // callers keep working even when no (or an unrecognized) Origin is sent.
  return EXTENSION_ORIGIN;
}

/**
 * Admin UI Extensions run in a sandboxed iframe on extensions.shopifycdn.com and
 * the print preview modal fetches from admin.shopify.com. Reflect whichever
 * allow-listed origin actually made the request so both surfaces pass CORS.
 */
export function withExtensionCors(response: NextResponse, req?: NextRequest): NextResponse {
  const requestOrigin = req?.headers.get("origin") ?? null;
  response.headers.set("Access-Control-Allow-Origin", resolveAllowedOrigin(requestOrigin));
  // The allowed origin varies per request, so caches must key on Origin.
  response.headers.append("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

export function extensionCorsPreflight(req?: NextRequest): NextResponse {
  return withExtensionCors(new NextResponse(null, { status: 204 }), req);
}
