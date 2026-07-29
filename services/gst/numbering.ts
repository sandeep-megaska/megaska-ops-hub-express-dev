import { GST_DOCUMENT_TYPES } from "./constants";
import { gstDb } from "./db";
import type { GstDocumentType, GstNumberingStrategy, GstServiceResult } from "./types";
import {
  buildFormattedDocumentNumber,
  counterPeriodLabel,
  resolveDocFormat,
  type DocNumberFormat,
} from "./numbering-config";

export interface GstNumberRequest {
  gstSettingsId: string;
  documentType: GstDocumentType;
  documentDate: Date;
}

export interface GstReservedNumber {
  documentNumber: string;
  sequence: number;
  financialYear: string;
}

type CounterSchemaProfile = {
  hasLegacyColumns: boolean;
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function getFinancialYearLabel(documentDate: Date): string {
  const year = documentDate.getUTCFullYear();
  const month = documentDate.getUTCMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

export function getCalendarYearLabel(documentDate: Date): string {
  return String(documentDate.getUTCFullYear());
}

export function getMonthlyPeriodLabel(documentDate: Date): string {
  const year = documentDate.getUTCFullYear();
  const month = String(documentDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatDocumentSequence(sequence: number): string {
  return String(sequence).padStart(5, "0");
}

export function buildDocumentNumber(prefix: string, financialYear: string, sequence: number): string {
  return `${prefix}/${financialYear}/${formatDocumentSequence(sequence)}`;
}

export function getCounterPeriodLabel(
  strategy: GstNumberingStrategy,
  documentDate: Date,
): GstServiceResult<string> {
  switch (strategy) {
    case "FINANCIAL_YEAR_SEQUENCE":
      return { ok: true, data: getFinancialYearLabel(documentDate) };
    case "CALENDAR_YEAR_SEQUENCE":
      return { ok: true, data: getCalendarYearLabel(documentDate) };
    case "MONTHLY_SEQUENCE":
      return { ok: true, data: getMonthlyPeriodLabel(documentDate) };
    case "MANUAL":
      return {
        ok: false,
        error:
          "GST numbering strategy is MANUAL. Automatic draft numbering cannot continue until strategy is updated.",
      };
    default:
      return { ok: false, error: `Unsupported GST numbering strategy: ${String(strategy)}` };
  }
}

export function pickPrefix(
  documentType: GstDocumentType,
  settings: { invoicePrefix: string; creditNotePrefix: string; debitNotePrefix: string },
): string {
  switch (documentType) {
    case "TAX_INVOICE":
      return normalize(settings.invoicePrefix);
    case "CREDIT_NOTE":
      return normalize(settings.creditNotePrefix);
    case "DEBIT_NOTE":
      return normalize(settings.debitNotePrefix);
    default:
      return "";
  }
}

function validateNumberingPrerequisites(request: GstNumberRequest): GstServiceResult<true> {
  if (!normalize(request.gstSettingsId)) {
    return { ok: false, error: "GST settings are required before reserving numbers" };
  }

  if (!GST_DOCUMENT_TYPES.includes(request.documentType)) {
    return { ok: false, error: `Unsupported documentType for numbering: ${String(request.documentType)}` };
  }

  if (!(request.documentDate instanceof Date) || Number.isNaN(request.documentDate.getTime())) {
    return { ok: false, error: "Valid documentDate is required for numbering" };
  }

  return { ok: true, data: true };
}

function getLegacyScope(documentType: GstDocumentType): string {
  switch (documentType) {
    case "TAX_INVOICE":
      return "INVOICE";
    case "CREDIT_NOTE":
      return "CREDIT_NOTE";
    case "DEBIT_NOTE":
      return "DEBIT_NOTE";
    default:
      return documentType;
  }
}

async function detectCounterSchemaProfile(): Promise<CounterSchemaProfile> {
  try {
    const columns = (await (gstDb as unknown as { $queryRawUnsafe: (q: string) => Promise<Array<{ column_name: string }>> })
      .$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='GstCounter'`,
      )) as Array<{ column_name: string }>;
    const names = new Set(columns.map((entry) => String(entry.column_name)));
    const hasLegacyColumns = names.has("settingsId") || names.has("scope") || names.has("currentValue");
    return { hasLegacyColumns };
  } catch {
    return { hasLegacyColumns: false };
  }
}

export async function reserveGstNumber(
  request: GstNumberRequest,
): Promise<GstServiceResult<GstReservedNumber>> {
  const prerequisites = validateNumberingPrerequisites(request);
  if (!prerequisites.ok) {
    return { ok: false, error: prerequisites.error };
  }

  try {
    const settings = await gstDb.gstSettings.findUnique({
      where: { id: request.gstSettingsId },
      select: {
        id: true,
        isActive: true,
        invoicePrefix: true,
        creditNotePrefix: true,
        debitNotePrefix: true,
        invoiceNumberStrategy: true,
        numberingConfig: true,
      },
    });

    if (!settings) {
      return { ok: false, error: "GST settings not found for numbering" };
    }

    if (!settings.isActive) {
      return {
        ok: false,
        error: "Selected GST settings are inactive. Activate GST settings before creating draft documents.",
      };
    }

    // MANUAL strategy still blocks automatic numbering, but only for shops that
    // have not configured explicit numbering (a numberingConfig supersedes the
    // legacy strategy field entirely).
    if (!settings.numberingConfig && settings.invoiceNumberStrategy === "MANUAL") {
      return {
        ok: false,
        error: "GST numbering strategy is MANUAL. Configure numbering before creating draft documents.",
      };
    }

    // Effective, per-document-type format: the merchant's numberingConfig when
    // present, else the legacy PREFIX/FY/00001 behaviour (unchanged output).
    const format: DocNumberFormat = resolveDocFormat(request.documentType, settings);
    const prefix = format.prefix;
    const financialYear = counterPeriodLabel(format.resetPeriod, request.documentDate);
    // Seed a brand-new counter to startNumber-1 so the first document lands on
    // the merchant's chosen starting number (GST continuity when migrating from
    // another app). Existing counters are never reseeded.
    const seed = Math.max(0, Math.floor(format.startNumber) - 1);
    const counterSchemaProfile = await detectCounterSchemaProfile();

    const result = await gstDb.$transaction(async (tx) => {
      if (counterSchemaProfile.hasLegacyColumns) {
        const legacyScope = getLegacyScope(request.documentType);
        const rows = (await (
          tx as unknown as { $queryRawUnsafe: (q: string, ...params: unknown[]) => Promise<Array<{ lastNumber: number }>> }
        ).$queryRawUnsafe(
          `INSERT INTO "GstCounter"
            ("id","settingsId","scope","financialYear","currentValue","prefix","padding","gstSettingsId","documentType","lastNumber","createdAt","updatedAt")
          VALUES
            (concat('gstc-', md5(random()::text || clock_timestamp()::text)), $1, $2, $3, $6, $4, 5, $1, $5::"GstDocumentType", $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("settingsId","scope","financialYear")
          DO UPDATE SET
            "currentValue" = "GstCounter"."currentValue" + 1,
            "lastNumber" = COALESCE("GstCounter"."lastNumber", "GstCounter"."currentValue", 0) + 1,
            "gstSettingsId" = EXCLUDED."gstSettingsId",
            "documentType" = EXCLUDED."documentType",
            "prefix" = EXCLUDED."prefix",
            "padding" = 5,
            "updatedAt" = CURRENT_TIMESTAMP
          RETURNING COALESCE("lastNumber","currentValue") AS "lastNumber"`,
          request.gstSettingsId,
          legacyScope,
          financialYear,
          prefix,
          request.documentType,
          seed + 1,
        )) as Array<{ lastNumber: number }>;

        const legacySequence = Number(rows?.[0]?.lastNumber || 0);
        if (!Number.isFinite(legacySequence) || legacySequence <= 0) {
          throw new Error("Legacy GstCounter upsert did not return a valid sequence");
        }

        return {
          documentNumber: buildFormattedDocumentNumber(format, request.documentDate, legacySequence),
          sequence: legacySequence,
          financialYear,
        };
      }

      await tx.gstCounter.upsert({
        where: {
          gstSettingsId_documentType_financialYear: {
            gstSettingsId: request.gstSettingsId,
            documentType: request.documentType,
            financialYear,
          },
        },
        create: {
          gstSettingsId: request.gstSettingsId,
          documentType: request.documentType,
          financialYear,
          lastNumber: seed,
        },
        update: {},
      });

      const counter = await tx.gstCounter.update({
        where: {
          gstSettingsId_documentType_financialYear: {
            gstSettingsId: request.gstSettingsId,
            documentType: request.documentType,
            financialYear,
          },
        },
        data: {
          lastNumber: {
            increment: 1,
          },
        },
      });

      return {
        documentNumber: buildFormattedDocumentNumber(format, request.documentDate, counter.lastNumber),
        sequence: counter.lastNumber,
        financialYear,
      };
    });

    console.info("[GST NUMBERING] Reserved GST document number", {
      gstSettingsId: request.gstSettingsId,
      documentType: request.documentType,
      documentNumber: result.documentNumber,
      isActiveSettings: Boolean(settings.isActive),
    });

    return { ok: true, data: result };
  } catch (error) {
    console.error("[GST NUMBERING] reserveGstNumber failed", {
      error: error instanceof Error ? error.message : String(error),
      gstSettingsId: request.gstSettingsId,
      documentType: request.documentType,
    });

    return {
      ok: false,
      error:
        "Failed to reserve GST document number. Ensure GST counter schema is initialized for this environment and numbering prefixes are configured.",
    };
  }
}
