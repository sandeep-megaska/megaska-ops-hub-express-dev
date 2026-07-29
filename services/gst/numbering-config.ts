import type { GstDocumentType, GstNumberingStrategy } from "./types";

// Configurable, GST-Pro-parity document numbering. Each document type (invoice,
// credit note, debit note) has its own format + independent counter.
//
// A composed number is `[prefix][period?][zero-padded sequence][suffix]`, the
// auto segments joined by `separator`. Continuity is preserved by seeding the
// counter to `startNumber - 1` on creation (see numbering.ts), so the first
// document lands exactly on the merchant's chosen start.

export type GstResetPeriod = "CONTINUOUS" | "FINANCIAL_YEAR" | "CALENDAR_YEAR" | "MONTHLY";
export type GstYearDisplay = "NONE" | "FINANCIAL_YEAR" | "CALENDAR_YEAR" | "MONTHLY";
export type GstNumberingDocKey = "invoice" | "creditNote" | "debitNote";

export interface DocNumberFormat {
  prefix: string;
  suffix: string;
  separator: string;
  minDigits: number; // leading-zero padding; 0 = none
  startNumber: number; // first number in a period (>= 1)
  resetPeriod: GstResetPeriod; // when the counter restarts
  yearDisplay: GstYearDisplay; // period label shown inside the number
}

export type GstNumberingConfig = Record<GstNumberingDocKey, DocNumberFormat>;

const GST_MAX_NUMBER_LENGTH = 16; // GST rule: document number <= 16 chars
const GST_NUMBER_CHARSET = /^[A-Za-z0-9/-]*$/; // GST rule: alphanumerics, "/" and "-"

export function docKeyFor(documentType: GstDocumentType): GstNumberingDocKey {
  switch (documentType) {
    case "CREDIT_NOTE":
      return "creditNote";
    case "DEBIT_NOTE":
      return "debitNote";
    default:
      return "invoice";
  }
}

function financialYearShort(date: Date): string {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

function calendarYear(date: Date): string {
  return String(date.getUTCFullYear());
}

function monthly(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Counter bucket key — determines when the sequence restarts. */
export function counterPeriodLabel(resetPeriod: GstResetPeriod, date: Date): string {
  switch (resetPeriod) {
    case "FINANCIAL_YEAR":
      return financialYearShort(date);
    case "CALENDAR_YEAR":
      return calendarYear(date);
    case "MONTHLY":
      return monthly(date);
    case "CONTINUOUS":
    default:
      return "CONTINUOUS";
  }
}

function yearSegment(yearDisplay: GstYearDisplay, date: Date): string {
  switch (yearDisplay) {
    case "FINANCIAL_YEAR":
      return financialYearShort(date);
    case "CALENDAR_YEAR":
      return calendarYear(date);
    case "MONTHLY":
      return monthly(date);
    case "NONE":
    default:
      return "";
  }
}

/** Compose the visible document number for a given sequence value. */
export function buildFormattedDocumentNumber(format: DocNumberFormat, date: Date, sequence: number): string {
  const minDigits = Math.max(0, Math.min(12, Math.floor(Number(format.minDigits) || 0)));
  const padded = String(Math.max(0, Math.floor(sequence))).padStart(minDigits, "0");
  const separator = String(format.separator ?? "");
  const prefix = String(format.prefix ?? "").trim();
  const suffix = String(format.suffix ?? "").trim();

  const segments = [prefix, yearSegment(format.yearDisplay, date), padded].filter((segment) => segment !== "");
  return `${segments.join(separator)}${suffix}`;
}

export interface DocNumberFormatValidation {
  ok: boolean;
  error?: string;
}

export function validateDocNumberFormat(format: DocNumberFormat): DocNumberFormatValidation {
  if (!Number.isInteger(format.minDigits) || format.minDigits < 0 || format.minDigits > 12) {
    return { ok: false, error: "Minimum digits must be a whole number between 0 and 12" };
  }
  if (!Number.isInteger(format.startNumber) || format.startNumber < 1) {
    return { ok: false, error: "Starting number must be a whole number of at least 1" };
  }
  if (!GST_NUMBER_CHARSET.test(`${format.prefix ?? ""}${format.suffix ?? ""}${format.separator ?? ""}`)) {
    return { ok: false, error: "Prefix, suffix and separator may only contain letters, digits, / and -" };
  }
  // Longest realistic value governs the 16-char GST limit: a large sequence in
  // a leap-ish month, padded. Sample with a wide sequence to be safe.
  const sample = buildFormattedDocumentNumber(format, new Date(Date.UTC(2026, 3, 1)), Math.max(format.startNumber, 999999));
  if (sample.length > GST_MAX_NUMBER_LENGTH) {
    return { ok: false, error: `Composed number "${sample}" exceeds the ${GST_MAX_NUMBER_LENGTH}-character GST limit` };
  }
  return { ok: true };
}

export function normalizeDocNumberFormat(raw: unknown): DocNumberFormat | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const resetPeriod = ["CONTINUOUS", "FINANCIAL_YEAR", "CALENDAR_YEAR", "MONTHLY"].includes(String(value.resetPeriod))
    ? (String(value.resetPeriod) as GstResetPeriod)
    : "FINANCIAL_YEAR";
  const yearDisplay = ["NONE", "FINANCIAL_YEAR", "CALENDAR_YEAR", "MONTHLY"].includes(String(value.yearDisplay))
    ? (String(value.yearDisplay) as GstYearDisplay)
    : "NONE";
  return {
    prefix: String(value.prefix ?? "").trim(),
    suffix: String(value.suffix ?? "").trim(),
    separator: String(value.separator ?? ""),
    minDigits: Math.max(0, Math.min(12, Math.floor(Number(value.minDigits) || 0))),
    startNumber: Math.max(1, Math.floor(Number(value.startNumber) || 1)),
    resetPeriod,
    yearDisplay,
  };
}

/**
 * Normalize + validate a full numbering config (all three document types).
 * Returns `{ ok: true }` with no `data` when nothing was provided (leave the
 * stored config unchanged), `{ ok: true, data }` when a valid config is given,
 * or `{ ok: false, error }` on the first invalid document format.
 */
export function normalizeNumberingConfig(
  raw: unknown,
): { ok: boolean; error?: string; data?: GstNumberingConfig } {
  if (raw === null || raw === undefined) return { ok: true };
  if (typeof raw !== "object") return { ok: false, error: "numberingConfig must be an object" };

  const source = raw as Record<string, unknown>;
  const keys: GstNumberingDocKey[] = ["invoice", "creditNote", "debitNote"];
  const out = {} as GstNumberingConfig;
  for (const key of keys) {
    const normalized = normalizeDocNumberFormat(source[key]);
    if (!normalized) return { ok: false, error: `numberingConfig.${key} is required` };
    const validation = validateDocNumberFormat(normalized);
    if (!validation.ok) return { ok: false, error: `${key}: ${validation.error}` };
    out[key] = normalized;
  }
  return { ok: true, data: out };
}

function strategyToResetPeriod(strategy: GstNumberingStrategy): GstResetPeriod {
  switch (strategy) {
    case "CALENDAR_YEAR_SEQUENCE":
      return "CALENDAR_YEAR";
    case "MONTHLY_SEQUENCE":
      return "MONTHLY";
    case "FINANCIAL_YEAR_SEQUENCE":
    default:
      return "FINANCIAL_YEAR";
  }
}

/**
 * Backward-compatible fallback for shops that have no numberingConfig yet:
 * reproduces the historical `PREFIX/PERIOD/00001` output exactly so an existing
 * sequence never shifts.
 */
export function legacyDocFormat(
  documentType: GstDocumentType,
  settings: {
    invoicePrefix: string;
    creditNotePrefix: string;
    debitNotePrefix: string;
    invoiceNumberStrategy: GstNumberingStrategy;
  },
): DocNumberFormat {
  const prefix =
    documentType === "CREDIT_NOTE"
      ? settings.creditNotePrefix
      : documentType === "DEBIT_NOTE"
        ? settings.debitNotePrefix
        : settings.invoicePrefix;
  const resetPeriod = strategyToResetPeriod(settings.invoiceNumberStrategy);
  const yearDisplay: GstYearDisplay =
    resetPeriod === "CALENDAR_YEAR" ? "CALENDAR_YEAR" : resetPeriod === "MONTHLY" ? "MONTHLY" : "FINANCIAL_YEAR";
  return {
    prefix: String(prefix ?? "").trim(),
    suffix: "",
    separator: "/",
    minDigits: 5,
    startNumber: 1,
    resetPeriod,
    yearDisplay,
  };
}

/**
 * Resolve the effective format for one document type: the merchant's
 * numberingConfig when present, otherwise the legacy fallback.
 */
export function resolveDocFormat(
  documentType: GstDocumentType,
  settings: {
    invoicePrefix: string;
    creditNotePrefix: string;
    debitNotePrefix: string;
    invoiceNumberStrategy: GstNumberingStrategy;
    numberingConfig?: unknown;
  },
): DocNumberFormat {
  const config = settings.numberingConfig;
  if (config && typeof config === "object") {
    const key = docKeyFor(documentType);
    const normalized = normalizeDocNumberFormat((config as Record<string, unknown>)[key]);
    if (normalized) return normalized;
  }
  return legacyDocFormat(documentType, settings);
}
