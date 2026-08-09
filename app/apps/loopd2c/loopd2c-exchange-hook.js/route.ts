import { readFile } from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyJsonError, requireEnabledModule, requireShopFromAppProxy } from "../../../../services/shopify/app-proxy";
import { getExchangeRequestPolicy } from "../../../../services/loopdesk/merchant-settings";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "exchange_hook");
    const source = await readFile(path.join(process.cwd(), "public", "loopd2c-exchange-hook.js"), "utf8");
    // Expose this shop's excluded-exchange categories so the hook can warn the
    // customer up front (before they fill the form) instead of only on a failed
    // submit. The server remains the authority — this is a UX hint only.
    const { excludedCategories } = await getExchangeRequestPolicy(shop.id);
    const bootstrap = `window.MEGASKA_SHOP_DOMAIN=window.MEGASKA_SHOP_DOMAIN||${JSON.stringify(shop.shopDomain)};window.MEGASKA_API_BASE=window.MEGASKA_API_BASE||"/apps/loopd2c/api";window.MEGASKA_EXCHANGE_EXCLUDED_CATEGORIES=${JSON.stringify(excludedCategories)};\n`;
    return new NextResponse(`${bootstrap}${source}`, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return appProxyJsonError(error);
  }
}

export const dynamic = "force-dynamic";
