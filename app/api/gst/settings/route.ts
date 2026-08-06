import { NextRequest, NextResponse } from "next/server";
import {
  GST_DEFAULT_NUMBERING_STRATEGY,
  isGstNumberingStrategy,
} from "../../../../services/gst/constants";
import { writeGstAuditLog } from "../../../../services/gst/audit";
import type { GstSettingsWriteInput } from "../../../../services/gst/settings";
import { validateGstIdentityConfig } from "../../../../services/gst/settings";
import { isGstModuleEnabled, setGstModuleEnabled } from "../../../../services/gst/module-toggle";
import { prisma } from "../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";

export const runtime = "nodejs";

const DEBUG_VERSION = "GST_SHOP_RESOLVER_FIX_V1";

function resolveString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function resolveNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : fallback;
}

async function resolveShopContext(req: NextRequest) {
  const requestedShopDomain = getShopDomainFromRequest(req);
  const usedGlobalFallback = !requestedShopDomain;
  const resolvedShop = requestedShopDomain
    ? await resolveShopConfig(requestedShopDomain)
    : await resolveShopConfig();

  return {
    requestedShopDomain,
    resolvedShop,
    usedGlobalFallback,
  };
}

export async function GET(req: NextRequest) {
  const { requestedShopDomain, resolvedShop, usedGlobalFallback } = await resolveShopContext(req);
  const resolvedShopId = resolvedShop.id ?? null;

  // GST settings are always shop-scoped now; no shopId: null global fallback.
  const settings = resolvedShopId
    ? await prisma.gstSettings.findFirst({
        where: { isActive: true, shopId: resolvedShopId },
        orderBy: { updatedAt: "desc" },
      })
    : null;
  const usedFallbackGlobal = false;

  if (!settings) {
    return NextResponse.json({ ok: false, error: "No active GST settings configured" }, { status: 404 });
  }

  // settings is non-null here only when resolvedShopId is non-null (see query above).
  const gstModuleEnabled = resolvedShopId ? await isGstModuleEnabled(resolvedShopId) : true;

  return NextResponse.json({
    ok: true,
    data: { settings, gstModuleEnabled },
    settings,
    gstModuleEnabled,
    __debugVersion: DEBUG_VERSION,
    __resolvedShopDomain: resolvedShop.shopDomain || requestedShopDomain || null,
    __resolvedShopId: resolvedShopId,
    __usedGlobalFallback: usedGlobalFallback || usedFallbackGlobal,
    __createdFromFallback: false,
  });
}

async function saveSettings(req: NextRequest) {
  const { requestedShopDomain, resolvedShop, usedGlobalFallback } = await resolveShopContext(req);
  const resolvedShopId = resolvedShop.id ?? null;

  if (!resolvedShopId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to resolve current shopId for GST settings save.",
        __debugVersion: DEBUG_VERSION,
        __resolvedShopDomain: resolvedShop.shopDomain || requestedShopDomain || null,
        __resolvedShopId: null,
        __usedGlobalFallback: usedGlobalFallback,
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
  // GST settings are always shop-scoped now; no null-scoped global fallback.
  const baseValues = existingShopSettings;

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
    autoGenerateOnOrderCreate:
      typeof body.autoGenerateOnOrderCreate === "boolean"
        ? body.autoGenerateOnOrderCreate
        : (baseValues?.autoGenerateOnOrderCreate ?? true),
    isActive: typeof body.isActive === "boolean" ? body.isActive : (baseValues?.isActive ?? true),
    numberingConfig: body.numberingConfig !== undefined ? body.numberingConfig : baseValues?.numberingConfig,
  };

  const validation = validateGstIdentityConfig(candidateInput);
  if (!validation.ok || !validation.data?.normalized) {
    return NextResponse.json({ ok: false, error: validation.error || "Invalid GST settings" }, { status: 400 });
  }

  const normalized = validation.data.normalized;
  const invoiceNumberStrategy = normalized.invoiceNumberStrategy ?? GST_DEFAULT_NUMBERING_STRATEGY;

  try {
    const settings = await prisma.$transaction(async (tx) => {
      if (normalized.isActive) {
        await tx.gstSettings.updateMany({
          where: { isActive: true, shopId: resolvedShopId },
          data: { isActive: false },
        });
      }

      const upsertData = {
        shopId: resolvedShopId,
        legalName: String(normalized.legalName),
        tradeName: normalized.tradeName ?? null,
        gstin: String(normalized.gstin),
        pan: normalized.pan ?? null,
        stateCode: String(normalized.stateCode),
        invoicePrefix: String(normalized.invoicePrefix),
        creditNotePrefix: String(normalized.creditNotePrefix),
        debitNotePrefix: String(normalized.debitNotePrefix),
        invoiceNumberStrategy,
        numberingConfig: normalized.numberingConfig ?? undefined,
        defaultCurrency: String(normalized.defaultCurrency || "INR"),
        priceIncludesTax: normalized.priceIncludesTax !== false,
        einvoiceEnabled: Boolean(normalized.einvoiceEnabled),
        autoGenerateOnOrderCreate: Boolean(normalized.autoGenerateOnOrderCreate),
        isActive: normalized.isActive ?? true,
      };

      if (existingShopSettings) {
        return tx.gstSettings.update({
          where: { id: existingShopSettings.id },
          data: upsertData,
        });
      }

      return tx.gstSettings.create({ data: upsertData });
    });

    // Per-shop GST engine on/off (stored in ShopModuleConfig, separate from the
    // settings row) — set when the client sends it, then echo the effective value.
    if (typeof body.gstModuleEnabled === "boolean") {
      await setGstModuleEnabled(resolvedShopId, body.gstModuleEnabled);
    }
    const gstModuleEnabled = await isGstModuleEnabled(resolvedShopId);

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
        data: { settings, gstModuleEnabled },
        settings,
        gstModuleEnabled,
        __debugVersion: DEBUG_VERSION,
        __resolvedShopDomain: resolvedShop.shopDomain || requestedShopDomain || null,
        __resolvedShopId: resolvedShopId,
        __usedGlobalFallback: usedGlobalFallback,
      },
      { status: existingShopSettings ? 200 : 201 },
    );
  } catch (error) {
    const knownError = error as { message?: string; code?: string; meta?: unknown } | undefined;
    console.error("[GST SETTINGS SAVE] failed", {
      message: knownError?.message ?? String(error),
      code: knownError?.code,
      meta: knownError?.meta,
    });
    return NextResponse.json({ ok: false, error: "Failed to save GST settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return saveSettings(req);
}

export async function PUT(req: NextRequest) {
  return saveSettings(req);
}
