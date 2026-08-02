import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";
import { DEFAULT_COD_INFORMATION_TEXT, getExpressCheckoutSettings, parseCodFeeRupeesToPaise, parsePercentValue, parseRupeesToPaise } from "../../../../../services/express-checkout/settings";
import { resolveExpressCheckoutReadiness, setExpressCheckoutEnabled } from "../../../../../services/express-checkout/readiness";

export const runtime = "nodejs";
const MODULE_KEY = "express_checkout_settings";

type ExpressCheckoutConfigBlob = {
  codFeeAmountPaise: number;
  codInformationText: string;
  prepaidDiscountEnabled: boolean;
  prepaidDiscountType: "PERCENTAGE" | "FIXED_AMOUNT";
  prepaidDiscountValue: number;
  prepaidDiscountMaxPaise: number;
  prepaidDiscountMinSubtotalPaise: number;
  prepaidOfferMessage: string;
};

const PREPAID_OFFER_MESSAGE_MAX_LENGTH = 160;

type ShopModuleConfigDelegate = {
  upsert(args: {
    where: { shopId_moduleKey: { shopId: string; moduleKey: string } };
    create: { shopId: string; moduleKey: string; enabled: boolean; config: ExpressCheckoutConfigBlob };
    update: { enabled: boolean; config: ExpressCheckoutConfigBlob };
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
  // Enabling Express Checkout no longer requires Razorpay: COD opens the modal
  // with no payment provider, and prepaid is handed off to Shopify Checkout.
  // `readiness.razorpayReady` still reports whether the legacy in-app prepaid
  // capture is usable, for merchants who want to surface that.
  const readiness = await setExpressCheckoutEnabled(resolved.id, requestedEnabled);

  const codFeeAmountPaise = parseCodFeeRupeesToPaise(body.codFeeAmountRupees);
  if (codFeeAmountPaise === null) return NextResponse.json({ ok: false, error: "COD charge must be a non-negative amount with up to two decimal places" }, { status: 400 });

  const codInformationText = String(body.codInformationText || "").trim() || DEFAULT_COD_INFORMATION_TEXT;

  // Prepaid discount: a PERCENTAGE value is a percent (0–100); a FIXED_AMOUNT is
  // captured in rupees and stored as paise. The cap and minimum-order are always
  // rupees→paise. A null from any parser means the input was malformed.
  const prepaidDiscountType = body.prepaidDiscountType === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
  const prepaidDiscountValue = prepaidDiscountType === "PERCENTAGE"
    ? parsePercentValue(body.prepaidDiscountPercent)
    : parseRupeesToPaise(body.prepaidDiscountFixedRupees);
  if (prepaidDiscountValue === null) {
    return NextResponse.json({ ok: false, error: prepaidDiscountType === "PERCENTAGE" ? "Prepaid discount percentage must be between 0 and 100" : "Prepaid discount amount must be a non-negative amount with up to two decimal places" }, { status: 400 });
  }
  const prepaidDiscountMaxPaise = parseRupeesToPaise(body.prepaidDiscountMaxRupees);
  if (prepaidDiscountMaxPaise === null) {
    return NextResponse.json({ ok: false, error: "Prepaid discount cap must be a non-negative amount with up to two decimal places" }, { status: 400 });
  }
  const prepaidDiscountMinSubtotalPaise = parseRupeesToPaise(body.prepaidDiscountMinSubtotalRupees);
  if (prepaidDiscountMinSubtotalPaise === null) {
    return NextResponse.json({ ok: false, error: "Prepaid discount minimum order must be a non-negative amount with up to two decimal places" }, { status: 400 });
  }
  const prepaidDiscountEnabled = body.prepaidDiscountEnabled === true && prepaidDiscountValue > 0;
  const prepaidOfferMessage = String(body.prepaidOfferMessage || "").trim().slice(0, PREPAID_OFFER_MESSAGE_MAX_LENGTH);

  const config: ExpressCheckoutConfigBlob = {
    codFeeAmountPaise,
    codInformationText,
    prepaidDiscountEnabled,
    prepaidDiscountType,
    prepaidDiscountValue,
    prepaidDiscountMaxPaise,
    prepaidDiscountMinSubtotalPaise,
    prepaidOfferMessage,
  };
  const settings = await db().shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId: resolved.id, moduleKey: MODULE_KEY } },
    create: { shopId: resolved.id, moduleKey: MODULE_KEY, enabled: true, config },
    update: { enabled: true, config },
  });

  return NextResponse.json({ ok: true, settings: { ...config, id: settings.id }, readiness });
}
