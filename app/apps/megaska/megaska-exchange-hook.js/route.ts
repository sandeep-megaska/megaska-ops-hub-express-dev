import { readFile } from "fs/promises";
import path from "path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { appProxyJsonError, requireEnabledModule, requireShopFromAppProxy } from "../../../../services/shopify/app-proxy";

export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "exchange_hook");
    const source = await readFile(path.join(process.cwd(), "public", "megaska-exchange-hook.js"), "utf8");
    const bootstrap = `window.MEGASKA_SHOP_DOMAIN=window.MEGASKA_SHOP_DOMAIN||${JSON.stringify(shop.shopDomain)};window.MEGASKA_API_BASE=window.MEGASKA_API_BASE||"/apps/megaska/api";\n`;
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
