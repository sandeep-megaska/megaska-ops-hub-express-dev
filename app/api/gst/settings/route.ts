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
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await upsertGstSettings({
    shopId: shop.id || null,
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
  return NextResponse.json({ ok: true, data: { settings }, settings }, { status: 201 });
}

export async function POST(req: NextRequest) {
  return saveSettings(req);
}

export async function PUT(req: NextRequest) {
  return saveSettings(req);
}
