import { NextRequest, NextResponse } from "next/server";
import {
  GST_DEFAULT_NUMBERING_STRATEGY,
  isGstNumberingStrategy,
} from "../../../../services/gst/constants";
import { getActiveGstSettings, upsertGstSettings } from "../../../../services/gst/settings";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  console.info("[GST DEBUG][SETTINGS][GET]", {
    requestUrl: req.url,
    resolvedShopDomain: shopDomain || null,
    resolvedShopId: shop.id ?? null,
  });
  const result = await getActiveGstSettings({ shopId: shop.id });
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  }

  const settings = result.data;
  return NextResponse.json({ ok: true, data: { settings }, settings });
}

async function saveSettings(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);
  const resolvedShopId = shop.id ? String(shop.id) : null;
  console.info("[GST DEBUG][SETTINGS][SAVE][REQUEST]", {
    requestUrl: req.url,
    resolvedShopDomain: shopDomain || null,
    resolvedShopId,
    saveUsesShopId: Boolean(resolvedShopId),
    saveUsesNullShopId: !resolvedShopId,
  });

  if (!resolvedShopId) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve current shopId for GST settings save." },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await upsertGstSettings({
    shopId: resolvedShopId,
    legalName: String(body.legalName || ""),
    tradeName: body.tradeName ? String(body.tradeName) : null,
    gstin: String(body.gstin || ""),
    pan: body.pan ? String(body.pan) : null,
    stateCode: String(body.stateCode || ""),
    invoicePrefix: String(body.invoicePrefix || ""),
    creditNotePrefix: String(body.creditNotePrefix || ""),
    debitNotePrefix: String(body.debitNotePrefix || ""),
    invoiceNumberStrategy: isGstNumberingStrategy(body.invoiceNumberStrategy)
      ? body.invoiceNumberStrategy
      : GST_DEFAULT_NUMBERING_STRATEGY,
    defaultCurrency: body.defaultCurrency ? String(body.defaultCurrency) : "INR",
    priceIncludesTax: body.priceIncludesTax === false ? false : true,
    einvoiceEnabled: Boolean(body.einvoiceEnabled),
    isActive: body.isActive === false ? false : true,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const settings = result.data;
  console.info("[GST DEBUG][SETTINGS][SAVE][RESULT]", {
    requestUrl: req.url,
    resolvedShopDomain: shopDomain || null,
    resolvedShopId,
    persistedSettingsId: settings.id,
    persistedSettingsShopId: settings.shopId ?? null,
  });
  return NextResponse.json({ ok: true, data: { settings }, settings }, { status: 201 });
}

export async function POST(req: NextRequest) {
  return saveSettings(req);
}

export async function PUT(req: NextRequest) {
  return saveSettings(req);
}
