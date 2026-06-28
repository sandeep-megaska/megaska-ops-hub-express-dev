import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireEnabledModule, requireShopFromAppProxy } from "../../../../services/shopify/app-proxy";

const MODULE_KEY = "exchanges";
const TITLE = "Megaska Exchanges";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, MODULE_KEY);
    return new NextResponse(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${TITLE}</title></head><body><main style="font-family:system-ui,sans-serif;padding:24px;max-width:720px;margin:auto"><h1>${TITLE}</h1><p>This Megaska module is available for ${shop.shopDomain} through the Shopify App Proxy.</p><p>Module data is served from <code>/apps/megaska/api</code>.</p></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    return appProxyHtmlError(error);
  }
}

export const dynamic = "force-dynamic";
