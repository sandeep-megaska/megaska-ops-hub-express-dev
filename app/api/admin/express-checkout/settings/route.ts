import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";
import { DEFAULT_COD_FEE_AMOUNT_PAISE, DEFAULT_COD_INFORMATION_TEXT, getExpressCheckoutSettings } from "../../../../../services/express-checkout/settings";

export const runtime = "nodejs";
const MODULE_KEY = "express_checkout_settings";

type ShopModuleConfigDelegate = {
  upsert(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    create: { shopId: string; moduleKey: string; enabled: boolean; config: { codFeeAmountPaise: number; codInformationText: string } };
    update: { enabled: boolean; config: { codFeeAmountPaise: number; codInformationText: string } };
  }): Promise<{ id: string }>;
};

function db() {
  return prisma as unknown as { shopModuleConfig: ShopModuleConfigDelegate };
}

async function shop(req: NextRequest) {
  return resolveShopConfig(getShopDomainFromRequest(req));
}

export async function GET(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const settings = await getExpressCheckoutSettings(resolved.id);
  return NextResponse.json({ ok: true, settings, shopDomain: resolved.shopDomain });
}

export async function POST(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });

  const codFeeAmountPaise = DEFAULT_COD_FEE_AMOUNT_PAISE;

  const codInformationText = String(body.codInformationText || "").trim() || DEFAULT_COD_INFORMATION_TEXT;
  const config = { codFeeAmountPaise, codInformationText };
  const settings = await db().shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId: resolved.id, moduleKey: MODULE_KEY } },
    create: { shopId: resolved.id, moduleKey: MODULE_KEY, enabled: true, config },
    update: { enabled: true, config },
  });

  return NextResponse.json({ ok: true, settings: { ...config, id: settings.id } });
}
