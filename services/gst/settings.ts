import { gstDb } from "./db";
import { writeGstAuditLog } from "./audit";
import { GST_DEFAULT_NUMBERING_STRATEGY } from "./constants";
import type { GstNumberingStrategy } from "./constants";
import type { GstServiceResult } from "./types";
import { GSTIN_REGEX, PAN_REGEX, PREFIX_REGEX, isValidStateCode } from "./validation";

export interface GstSettingsSnapshot {
  id: string;
  shopId?: string | null;
  legalName: string;
  tradeName: string | null;
  gstin: string;
  pan: string | null;
  stateCode: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  debitNotePrefix: string;
  invoiceNumberStrategy: GstNumberingStrategy;
  defaultCurrency: string;
  priceIncludesTax: boolean;
  einvoiceEnabled: boolean;
  isActive: boolean;
}

export interface GstSettingsWriteInput {
  shopId?: string | null;
  legalName: string;
  tradeName?: string | null;
  gstin: string;
  pan?: string | null;
  stateCode: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  debitNotePrefix: string;
  invoiceNumberStrategy?: GstSettingsSnapshot["invoiceNumberStrategy"];
  defaultCurrency?: string;
  priceIncludesTax?: boolean;
  einvoiceEnabled?: boolean;
  isActive?: boolean;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function toSnapshot(settings: GstSettingsSnapshot | null | undefined): GstSettingsSnapshot | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    id: settings.id,
    shopId: settings.shopId ?? null,
    legalName: settings.legalName,
    tradeName: settings.tradeName,
    gstin: settings.gstin,
    pan: settings.pan,
    stateCode: settings.stateCode,
    invoicePrefix: settings.invoicePrefix,
    creditNotePrefix: settings.creditNotePrefix,
    debitNotePrefix: settings.debitNotePrefix,
    invoiceNumberStrategy: settings.invoiceNumberStrategy,
    defaultCurrency: settings.defaultCurrency,
    priceIncludesTax: Boolean(settings.priceIncludesTax),
    einvoiceEnabled: settings.einvoiceEnabled,
    isActive: settings.isActive,
  };
}

export function validateGstIdentityConfig(
  input: Partial<GstSettingsWriteInput>,
): GstServiceResult<{ normalized?: Partial<GstSettingsWriteInput>; messages?: string[] }> {
  const errors: string[] = [];

  const legalName = normalize(input.legalName);
  const gstin = normalize(input.gstin).toUpperCase();
  const pan = normalize(input.pan).toUpperCase();
  const stateCode = normalize(input.stateCode);
  const invoicePrefix = normalize(input.invoicePrefix).toUpperCase();
  const creditNotePrefix = normalize(input.creditNotePrefix).toUpperCase();
  const debitNotePrefix = normalize(input.debitNotePrefix).toUpperCase();

  if (!legalName) {
    errors.push("legalName is required");
  }
  if (!GSTIN_REGEX.test(gstin)) {
    errors.push("gstin must be a valid 15-character GSTIN");
  }
  if (pan && !PAN_REGEX.test(pan)) {
    errors.push("pan must be a valid PAN");
  }
  if (!isValidStateCode(stateCode)) {
    errors.push("stateCode must be a valid GST state code");
  }
  if (!PREFIX_REGEX.test(invoicePrefix)) {
    errors.push("invoicePrefix must be 1-12 chars and contain A-Z, 0-9, /, _, -");
  }
  if (!PREFIX_REGEX.test(creditNotePrefix)) {
    errors.push("creditNotePrefix must be 1-12 chars and contain A-Z, 0-9, /, _, -");
  }
  if (!PREFIX_REGEX.test(debitNotePrefix)) {
    errors.push("debitNotePrefix must be 1-12 chars and contain A-Z, 0-9, /, _, -");
  }
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) {
    errors.push("gstin state code and stateCode must match");
  }
  if (pan && gstin && gstin.slice(2, 12) !== pan) {
    errors.push("gstin PAN segment and pan must match");
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join("; "), data: { messages: errors } };
  }

  return {
    ok: true,
    data: {
      normalized: {
        legalName,
        tradeName: normalize(input.tradeName) || null,
        gstin,
        pan: pan || null,
        stateCode,
        invoicePrefix,
        creditNotePrefix,
        debitNotePrefix,
        invoiceNumberStrategy: input.invoiceNumberStrategy ?? GST_DEFAULT_NUMBERING_STRATEGY,
        defaultCurrency: normalize(input.defaultCurrency || "INR").toUpperCase(),
        priceIncludesTax: input.priceIncludesTax !== false,
        einvoiceEnabled: Boolean(input.einvoiceEnabled),
        isActive: input.isActive ?? true,
      },
    },
  };
}

async function detectActiveSettingsConflicts(gstin: string, shopId?: string | null): Promise<GstServiceResult<true>> {
  const normalizedShopId = normalize(shopId) || null;
  const activeSettings = await gstDb.gstSettings.findMany({
    where: {
      isActive: true,
      ...(normalizedShopId ? { shopId: normalizedShopId } : { shopId: null }),
    },
    select: { id: true, gstin: true },
  });

  const uniqueActiveGstins = new Set(activeSettings.map((entry) => String(entry.gstin)));
  if (uniqueActiveGstins.size > 1) {
    return {
      ok: false,
      error: "Multiple active GST settings exist. Resolve duplicates before updating.",
    };
  }

  const duplicateActiveByGstin = activeSettings.filter((entry) => String(entry.gstin) === gstin);
  if (duplicateActiveByGstin.length > 1) {
    return {
      ok: false,
      error: `Duplicate active GST settings found for GSTIN ${gstin}`,
    };
  }

  return { ok: true, data: true };
}

export async function getGstSettingsById(id: string): Promise<GstServiceResult<GstSettingsSnapshot>> {
  try {
    const settings = await gstDb.gstSettings.findUnique({ where: { id: normalize(id) } });
    if (!settings) {
      return { ok: false, error: "GST settings not found" };
    }

    return { ok: true, data: toSnapshot(settings) };
  } catch (error) {
    console.error("[GST SETTINGS] getGstSettingsById failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to load GST settings" };
  }
}

export async function getActiveGstSettings(input?: { shopId?: string | null }): Promise<GstServiceResult<GstSettingsSnapshot>> {
  try {
    const requestedShopId = normalize(input?.shopId) || null;
    let settings: GstSettingsSnapshot | null = null;
    let fallbackUsed = false;

    if (requestedShopId) {
      settings = await gstDb.gstSettings.findFirst({
        where: {
          isActive: true,
          shopId: requestedShopId,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (!settings) {
        settings = await gstDb.gstSettings.findFirst({
          where: {
            isActive: true,
            shopId: null,
          },
          orderBy: { updatedAt: "desc" },
        });
        fallbackUsed = Boolean(settings);
      }
    } else {
      settings = await gstDb.gstSettings.findFirst({
        where: {
          isActive: true,
          shopId: null,
        },
        orderBy: { updatedAt: "desc" },
      });

      if (!settings) {
        settings = await gstDb.gstSettings.findFirst({
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
        });
        fallbackUsed = Boolean(settings);
      }
    }

    console.info("[GST SETTINGS RESOLVE]", {
      requestedShopId,
      resolvedSettingsId: settings?.id ?? null,
      resolvedSettingsShopId: settings?.shopId ?? null,
      fallbackUsed,
    });

    if (!settings) {
      return { ok: false, error: "No active GST settings configured" };
    }

    return { ok: true, data: toSnapshot(settings) };
  } catch (error) {
    console.error("[GST SETTINGS] getActiveGstSettings failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to load active GST settings" };
  }
}

export async function upsertGstSettings(input: GstSettingsWriteInput): Promise<GstServiceResult<GstSettingsSnapshot>> {
  const validation = validateGstIdentityConfig(input);
  if (!validation.ok || !validation.data || !validation.data.normalized) {
    return { ok: false, error: validation.error || "Invalid GST settings" };
  }

  const normalized = validation.data.normalized;
  const shopId = normalize(input.shopId) || null;

  try {
    const created = await gstDb.$transaction(async (tx) => {
      const existingForShop = shopId
        ? await tx.gstSettings.findFirst({
            where: { shopId },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          })
        : null;

      const conflictCheck = await detectActiveSettingsConflicts(String(normalized.gstin), shopId);
      if (!conflictCheck.ok) {
        return Promise.reject(new Error(conflictCheck.error || "Active GST settings conflict detected"));
      }

      if (normalized.isActive) {
        await tx.gstSettings.updateMany({
          where: {
            isActive: true,
            ...(shopId ? { shopId } : {}),
          },
          data: { isActive: false },
        });
      }

      if (existingForShop?.id) {
        return tx.gstSettings.update({
          where: { id: String(existingForShop.id) },
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

      return tx.gstSettings.upsert({
        where: { gstin: String(normalized.gstin) },
        create: {
          shopId,
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
        update: {
          shopId,
          legalName: String(normalized.legalName),
          tradeName: normalized.tradeName ?? null,
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
        gstSettingsId: created.id,
        nextState: toSnapshot(created),
        metadata: { gstin: created.gstin },
      },
      { actorType: "SYSTEM" },
    );

    console.info("[GST SETTINGS] upserted GST settings", { gstSettingsId: created.id, gstin: created.gstin });
    return { ok: true, data: toSnapshot(created) };
  } catch (error) {
    console.error("[GST SETTINGS] upsertGstSettings failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to save GST settings" };
  }
}
