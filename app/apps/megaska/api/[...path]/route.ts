import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyJsonError, requireEnabledModule, requireShopFromAppProxy } from "../../../../../services/shopify/app-proxy";

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
    const shop = await requireShopFromAppProxy(request);
    const { path } = await context.params;
    const proxyPath = path.join("/");
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
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
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
