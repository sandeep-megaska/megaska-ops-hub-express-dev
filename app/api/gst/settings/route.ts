import { NextRequest, NextResponse } from "next/server";
import {
  GST_DEFAULT_NUMBERING_STRATEGY,
  isGstNumberingStrategy,
} from "../../../../services/gst/constants";
import { writeGstAuditLog } from "../../../../services/gst/audit";
import type { GstSettingsWriteInput } from "../../../../services/gst/settings";
import { validateGstIdentityConfig } from "../../../../services/gst/settings";
import { prisma } from "../../../../services/db/prisma";
import { getShopByDomain, getShopDomainFromRequest } from "../../../../services/shopify/shop-resolver";

export const runtime = "nodejs";

const DEBUG_VERSION = "GST_SETTINGS_SHOP_SCOPE_V1";

function resolveString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function resolveNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : fallback;
}

export async function GET(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = shopDomain ? await getShopByDomain(shopDomain) : null;
  const resolvedShopId = shop?.id ?? null;

  let settings =
    resolvedShopId
      ? await prisma.gstSettings.findFirst({
          where: { isActive: true, shopId: resolvedShopId },
          orderBy: { updatedAt: "desc" },
        })
      : null;

  let usedFallbackGlobal = false;
  if (!settings) {
    settings = await prisma.gstSettings.findFirst({
      where: { isActive: true, shopId: null },
      orderBy: { updatedAt: "desc" },
    });
    usedFallbackGlobal = Boolean(settings) && Boolean(resolvedShopId);
  }

  if (!settings) {
    return NextResponse.json({ ok: false, error: "No active GST settings configured" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: { settings },
    settings,
    __debugVersion: DEBUG_VERSION,
    __resolvedShopDomain: shopDomain || null,
    __resolvedShopId: resolvedShopId,
    __usedFallbackGlobal: usedFallbackGlobal,
  });
}

async function saveSettings(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = shopDomain ? await getShopByDomain(shopDomain) : null;
  const resolvedShopId = shop?.id ?? null;

  if (!resolvedShopId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to resolve current shopId for GST settings save.",
        __debugVersion: DEBUG_VERSION,
        __resolvedShopDomain: shopDomain || null,
        __resolvedShopId: null,
        __usedFallbackGlobal: false,
      },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const existingShopSettings = await prisma.gstSettings.findFirst({
    where: { shopId: resolvedShopId },
    orderBy: { updatedAt: "desc" },
  });
  const fallbackGlobalSettings = existingShopSettings
    ? null
    : await prisma.gstSettings.findFirst({
        where: { shopId: null, isActive: true },
        orderBy: { updatedAt: "desc" },
      });

  const baseValues = existingShopSettings ?? fallbackGlobalSettings;

  const candidateInput: Partial<GstSettingsWriteInput> = {
    legalName: resolveString(body.legalName, baseValues?.legalName ?? ""),
    tradeName: resolveNullableString(body.tradeName, baseValues?.tradeName ?? null),
    gstin: resolveString(body.gstin, baseValues?.gstin ?? ""),
    pan: resolveNullableString(body.pan, baseValues?.pan ?? null),
    stateCode: resolveString(body.stateCode, baseValues?.stateCode ?? ""),
    invoicePrefix: resolveString(body.invoicePrefix, baseValues?.invoicePrefix ?? ""),
    creditNotePrefix: resolveString(body.creditNotePrefix, baseValues?.creditNotePrefix ?? ""),
    debitNotePrefix: resolveString(body.debitNotePrefix, baseValues?.debitNotePrefix ?? ""),
    invoiceNumberStrategy: isGstNumberingStrategy(body.invoiceNumberStrategy)
      ? body.invoiceNumberStrategy
      : baseValues?.invoiceNumberStrategy ?? GST_DEFAULT_NUMBERING_STRATEGY,
    defaultCurrency: resolveString(body.defaultCurrency, baseValues?.defaultCurrency ?? "INR"),
    priceIncludesTax:
      typeof body.priceIncludesTax === "boolean"
        ? body.priceIncludesTax
        : (baseValues?.priceIncludesTax ?? true),
    einvoiceEnabled:
      typeof body.einvoiceEnabled === "boolean"
        ? body.einvoiceEnabled
        : (baseValues?.einvoiceEnabled ?? false),
    isActive: typeof body.isActive === "boolean" ? body.isActive : (baseValues?.isActive ?? true),
  };

  const validation = validateGstIdentityConfig(candidateInput);
  if (!validation.ok || !validation.data?.normalized) {
    return NextResponse.json({ ok: false, error: validation.error || "Invalid GST settings" }, { status: 400 });
  }

  const normalized = validation.data.normalized;

  const settings = await prisma.$transaction(async (tx) => {
    if (normalized.isActive) {
      await tx.gstSettings.updateMany({
        where: { isActive: true, shopId: resolvedShopId },
        data: { isActive: false },
      });
    }

    if (existingShopSettings) {
      return tx.gstSettings.update({
        where: { id: existingShopSettings.id },
        data: {
          legalName: String(normalized.legalName),
          tradeName: normalized.tradeName ?? null,
          gstin: String(normalized.gstin),
          pan: normalized.pan ?? null,
          stateCode: String(normalized.stateCode),
          invoicePrefix: String(normalized.invoicePrefix),
          creditNotePrefix: String(normalized.creditNotePrefix),
          debitNotePrefix: String(normalized.debitNotePrefix),
          invoiceNumberStrategy: normalized.invoiceNumberStrategy,
          defaultCurrency: String(normalized.defaultCurrency || "INR"),
          priceIncludesTax: normalized.priceIncludesTax !== false,
          einvoiceEnabled: Boolean(normalized.einvoiceEnabled),
          isActive: normalized.isActive ?? true,
        },
      });
    }

    return tx.gstSettings.create({
      data: {
        shopId: resolvedShopId,
        legalName: String(normalized.legalName),
        tradeName: normalized.tradeName ?? null,
        gstin: String(normalized.gstin),
        pan: normalized.pan ?? null,
        stateCode: String(normalized.stateCode),
        invoicePrefix: String(normalized.invoicePrefix),
        creditNotePrefix: String(normalized.creditNotePrefix),
        debitNotePrefix: String(normalized.debitNotePrefix),
        invoiceNumberStrategy: normalized.invoiceNumberStrategy,
        defaultCurrency: String(normalized.defaultCurrency || "INR"),
        priceIncludesTax: normalized.priceIncludesTax !== false,
        einvoiceEnabled: Boolean(normalized.einvoiceEnabled),
        isActive: normalized.isActive ?? true,
      },
    });
  });

  await writeGstAuditLog(
    {
      action: "GST_SETTINGS_UPSERT",
      gstSettingsId: settings.id,
      nextState: settings,
      metadata: { gstin: settings.gstin },
    },
    { actorType: "SYSTEM" },
  );

  return NextResponse.json(
    {
      ok: true,
      data: { settings },
      settings,
      __debugVersion: DEBUG_VERSION,
      __resolvedShopDomain: shopDomain || null,
      __resolvedShopId: resolvedShopId,
      __usedFallbackGlobal: Boolean(fallbackGlobalSettings && !existingShopSettings),
    },
    { status: existingShopSettings ? 200 : 201 },
  );
}

export async function POST(req: NextRequest) {
  return saveSettings(req);
}

export async function PUT(req: NextRequest) {
  return saveSettings(req);
}
