import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyJsonError, requireEnabledModule, requireShopFromAppProxy, requireStorefrontShopFromAppProxy } from "../../../../../services/shopify/app-proxy";


const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

function buildAppProxyResponseHeaders(upstreamHeaders: Headers) {
  const headers = new Headers(upstreamHeaders);

  for (const header of HOP_BY_HOP_RESPONSE_HEADERS) {
    headers.delete(header);
  }

  return headers;
}

async function buildOtpRequestProxyResponse(response: Response) {
  let payload: unknown = null;

  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (response.ok) {
    return NextResponse.json(
      { ok: true, sent: true },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const headers = buildAppProxyResponseHeaders(response.headers);
  headers.set("Cache-Control", "no-store");

  return NextResponse.json(
    payload && typeof payload === "object" ? payload : { ok: false, error: "OTP request failed" },
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    }
  );
}

const STOREFRONT_API_PREFIXES = [
  "otp/request",
  "otp/verify",
  "auth/session",
  "delhivery/pincode",
  "express/checkout/",
  "profile/",
];

function isStorefrontApiPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return STOREFRONT_API_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

const API_MODULES: Array<{ prefix: string; moduleKey: string }> = [
  { prefix: "dashboard/", moduleKey: "dashboard" },
  { prefix: "express/checkout/", moduleKey: "express_checkout" },
  { prefix: "delhivery/pincode", moduleKey: "pincode" },
  { prefix: "requests/exchange", moduleKey: "exchanges" },
  { prefix: "requests/cancellation", moduleKey: "cancellations" },
  { prefix: "requests/issue", moduleKey: "issues" },
  { prefix: "account/exchange-requests", moduleKey: "exchanges" },
  { prefix: "account/refunds", moduleKey: "issues" },
  { prefix: "gst/", moduleKey: "gst" },
  { prefix: "otp/", moduleKey: "otp_auth" },
  { prefix: "auth/", moduleKey: "otp_auth" },
  { prefix: "profile/", moduleKey: "otp_auth" },
];

function resolveModuleKey(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return API_MODULES.find((entry) => normalized === entry.prefix || normalized.startsWith(entry.prefix))?.moduleKey || null;
}

async function proxyInternalApi(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const proxyPath = path.join("/");
    const shop = isStorefrontApiPath(proxyPath)
      ? await requireStorefrontShopFromAppProxy(request)
      : await requireShopFromAppProxy(request);
    const moduleKey = resolveModuleKey(proxyPath);

    if (!moduleKey) {
      return NextResponse.json({ ok: false, error: "API route is not available through the Megaska app proxy" }, { status: 404 });
    }

    await requireEnabledModule(shop.id, moduleKey);

    const targetUrl = new URL(request.url);
    targetUrl.pathname = `/api/${proxyPath}`;
    targetUrl.searchParams.set("shop", shop.shopDomain);
    targetUrl.searchParams.delete("signature");
    targetUrl.searchParams.delete("hmac");

    const headers = new Headers(request.headers);
    headers.set("x-shopify-shop-domain", shop.shopDomain);
    headers.set("x-megaska-app-proxy", "1");
    headers.delete("host");

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
      cache: "no-store",
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);

    if (proxyPath === "otp/request") {
      return buildOtpRequestProxyResponse(response);
    }

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: buildAppProxyResponseHeaders(response.headers),
    });
  } catch (error) {
    return appProxyJsonError(error);
  }
}

export const GET = proxyInternalApi;
export const POST = proxyInternalApi;
export const PUT = proxyInternalApi;
export const PATCH = proxyInternalApi;
export const DELETE = proxyInternalApi;
export const dynamic = "force-dynamic";
