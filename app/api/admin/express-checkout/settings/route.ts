import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";
import { DEFAULT_COD_INFORMATION_TEXT, getExpressCheckoutSettings, parseCodFeeRupeesToPaise } from "../../../../../services/express-checkout/settings";
import { resolveExpressCheckoutReadiness, setExpressCheckoutEnabled } from "../../../../../services/express-checkout/readiness";

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
  const readiness = await resolveExpressCheckoutReadiness(resolved.id);
  return NextResponse.json({ ok: true, settings, readiness, shopDomain: resolved.shopDomain });
}

export async function POST(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });

  const requestedEnabled = body.enabled === true;
  const readiness = await setExpressCheckoutEnabled(resolved.id, requestedEnabled);
  if (requestedEnabled && !readiness.ready) return NextResponse.json({ ok: false, code: "EXPRESS_CHECKOUT_NOT_READY", readiness, error: "Express Checkout requires a valid Razorpay configuration. Complete the Razorpay settings or continue using Shopify Checkout." }, { status: 409 });

  const codFeeAmountPaise = parseCodFeeRupeesToPaise(body.codFeeAmountRupees);
  if (codFeeAmountPaise === null) return NextResponse.json({ ok: false, error: "COD charge must be a non-negative amount with up to two decimal places" }, { status: 400 });

  const codInformationText = String(body.codInformationText || "").trim() || DEFAULT_COD_INFORMATION_TEXT;
  const config = { codFeeAmountPaise, codInformationText };
  const settings = await db().shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId: resolved.id, moduleKey: MODULE_KEY } },
    create: { shopId: resolved.id, moduleKey: MODULE_KEY, enabled: true, config },
    update: { enabled: true, config },
  });

  return NextResponse.json({ ok: true, settings: { ...config, id: settings.id }, readiness });
}
