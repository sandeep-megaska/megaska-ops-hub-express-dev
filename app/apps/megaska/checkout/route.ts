import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyHtmlError, requireEnabledModule, requireShopFromAppProxy } from "../../../../services/shopify/app-proxy";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "express_checkout");
    return new NextResponse(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Megaska Express Checkout</title></head><body><main style="font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:auto"><h1>Opening Megaska Express Checkout…</h1><p id="megaska-fallback">If the checkout modal does not open, return to your cart and use the Megaska Express Checkout button.</p><button onclick="window.MegaskaExpressCheckout&&window.MegaskaExpressCheckout.open&&window.MegaskaExpressCheckout.open()">Try again</button></main><script>window.MEGASKA_SHOP_DOMAIN=${JSON.stringify(shop.shopDomain)};window.MEGASKA_API_BASE='/apps/megaska/api';</script><script src="/apps/megaska/megaska-exchange-hook.js" defer></script><script>setTimeout(function(){try{if(window.MegaskaExpressCheckout&&window.MegaskaExpressCheckout.open){window.MegaskaExpressCheckout.open();document.getElementById('megaska-fallback').textContent='Megaska Express Checkout is ready.';}}catch(e){}},800);</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    return appProxyHtmlError(error);
  }
}

export const dynamic = "force-dynamic";
