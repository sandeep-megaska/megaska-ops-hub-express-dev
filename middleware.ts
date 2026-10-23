import { NextRequest, NextResponse } from "next/server";

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const DEFAULT_APP_HANDLE = "megaska-ops-hub-express-dev";
const DEFAULT_MARKETING_SITE_URL = "https://www.loopd2c.com";

function isValidShop(shop: string | null): shop is string {
  return Boolean(shop) && SHOP_DOMAIN_PATTERN.test(shop as string);
}

function buildFrameAncestors(shop: string | null) {
  if (isValidShop(shop)) return `frame-ancestors https://${shop} https://admin.shopify.com;`;
  return "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
}

// The merchant admin pages (/ and /admin/*) are only meant to be reached
// embedded inside Shopify Admin. A direct top-level browser navigation
// (typed URL, bookmark, external link) sends Sec-Fetch-Dest: document.
// Shopify's own embedding iframe sends Sec-Fetch-Dest: iframe, and in-app
// client-side navigation/data fetches send "empty" — both are always let
// through. Clients that omit the header entirely fail open rather than
// risk breaking a legitimate embed we can't positively identify.
//
// It also forwards the requested path + query to the page as x-loopd2c-url (any
// client-sent copy is replaced), so an admin page or server action whose Shopify
// session can't be verified knows where the session bounce should return to.
// WhatsApp media opened in a new tab is a top-level document load by design; that
// route checks its own signed URL, so it is not redirected.
const ADMIN_REQUEST_URL_HEADER = "x-loopd2c-url";
const SIGNED_MEDIA_PATH = /^\/admin\/whatsapp\/media\//;

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const shop = url.searchParams.get("shop");
  const secFetchDest = request.headers.get("sec-fetch-dest");

  if (secFetchDest === "document" && !SIGNED_MEDIA_PATH.test(url.pathname)) {
    const appHandle = process.env.SHOPIFY_APP_HANDLE || DEFAULT_APP_HANDLE;
    const destination = isValidShop(shop)
      ? `https://${shop}/admin/apps/${appHandle}`
      : process.env.MARKETING_SITE_URL || DEFAULT_MARKETING_SITE_URL;
    return NextResponse.redirect(destination);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ADMIN_REQUEST_URL_HEADER, `${url.pathname}${url.search}`);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildFrameAncestors(shop));
  return response;
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
