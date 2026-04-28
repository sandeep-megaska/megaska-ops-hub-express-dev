import { createHash } from "crypto";
import { gstDb } from "./db";
import { buildB2cSalesRegisterExport } from "./reports/b2c-sales-register";
import type { ReportWarning } from "./reports/types";
import type { GstServiceResult } from "./types";

export interface GenerateReportRunInput {
  gstSettingsId: string;
  reportType: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  format: "CSV" | "XLSX";
  filters?: Record<string, unknown>;
}

export interface GstReportRunRecord {
  id: string;
  gstSettingsId: string;
  reportType: string;
  periodStart: Date;
  periodEnd: Date;
  format: string;
  status: string;
  fileUrl: string | null;
  rowCount: number;
  generatedAt: Date | null;
  errorMessage: string | null;
  warnings?: ReportWarning[];
}

export interface ReportRunFilters {
  gstSettingsId?: string;
  reportType?: string;
  status?: string;
}

type ReportDocument = {
  id: string;
  documentType: string;
  documentNumber: string;
  documentDate: Date;
  status: string;
  taxableAmount: unknown;
  cgstAmount: unknown;
  sgstAmount: unknown;
  igstAmount: unknown;
  cessAmount?: unknown;
  totalAmount: unknown;
};

function toIsoDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeReportType(reportType: string): string {
  const normalized = reportType.trim().toLowerCase();
  if (normalized === "b2c_sales_register" || normalized === "b2c-sales-register") {
    return "B2C_SALES_REGISTER";
  }
  return normalized;
}

function normalizeTypeFilter(reportType: string): string[] | undefined {
  if (reportType === "invoice_register") return ["TAX_INVOICE"];
  if (reportType === "notes_register") return ["CREDIT_NOTE", "DEBIT_NOTE"];
  if (reportType === "credit_note_register") return ["CREDIT_NOTE"];
  if (reportType === "debit_note_register") return ["DEBIT_NOTE"];
  return undefined;
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(documents: ReportDocument[]): { csv: string; rowCount: number } {
  const headers = [
    "gstDocumentId",
    "documentType",
    "documentNumber",
    "documentDate",
    "status",
    "taxableAmount",
    "cgstAmount",
    "sgstAmount",
    "igstAmount",
    "cessAmount",
    "totalAmount",
  ];

  const rows = documents
    .map((doc) => [
      doc.id,
      doc.documentType,
      doc.documentNumber,
      doc.documentDate.toISOString().slice(0, 10),
      doc.status,
      String(doc.taxableAmount ?? "0"),
      String(doc.cgstAmount ?? "0"),
      String(doc.sgstAmount ?? "0"),
      String(doc.igstAmount ?? "0"),
      String(doc.cessAmount ?? "0"),
      String(doc.totalAmount ?? "0"),
    ])
    .sort((a, b) => a[3].localeCompare(b[3]) || a[2].localeCompare(b[2]));

  const csv = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
  return { csv, rowCount: rows.length };
}

function toDataUrl(csv: string): string {
  return `data:text/csv;base64,${Buffer.from(csv, "utf-8").toString("base64")}`;
}

function pickRun(record: Record<string, unknown>): GstReportRunRecord {
  const filters = (record.filters && typeof record.filters === "object" ? (record.filters as Record<string, unknown>) : {}) as {
    warnings?: ReportWarning[];
  };

  return {
    id: String(record.id),
    gstSettingsId: String(record.gstSettingsId),
    reportType: String(record.reportType),
    periodStart: new Date(String(record.periodStart)),
    periodEnd: new Date(String(record.periodEnd)),
    format: String(record.format),
    status: String(record.status),
    fileUrl: record.fileUrl ? String(record.fileUrl) : null,
    rowCount: Number(record.rowCount || 0),
    generatedAt: record.generatedAt ? new Date(String(record.generatedAt)) : null,
    errorMessage: record.errorMessage ? String(record.errorMessage) : null,
    warnings: Array.isArray(filters.warnings) ? filters.warnings : [],
  };
}

export async function generateReportRun(input: GenerateReportRunInput): Promise<GstServiceResult<GstReportRunRecord>> {
  console.log("[GST_REPORT_EXPORT] requested reportType:", input.reportType);
  const periodStart = toIsoDate(input.periodStart);
  const periodEnd = toIsoDate(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return { ok: false, error: "periodStart and periodEnd must be valid ISO dates" };
  }

  if (input.format !== "CSV") {
    return { ok: false, error: "Only CSV format is supported right now" };
  }

  const normalizedReportType = normalizeReportType(input.reportType);

  const reportRun = await gstDb.gstReportRun.create({
    data: {
      gstSettingsId: input.gstSettingsId,
      reportType: normalizedReportType,
      periodStart,
      periodEnd,
      format: input.format,
      status: "PROCESSING",
      filters: input.filters || {},
      rowCount: 0,
    },
  });

  try {
    let csv: string;
    let rowCount = 0;
    let warnings: ReportWarning[] = [];

    if (normalizedReportType === "B2C_SALES_REGISTER") {
      const result = await buildB2cSalesRegisterExport({
        gstSettingsId: input.gstSettingsId,
        periodStart,
        periodEnd,
      });
      csv = result.csv;
      rowCount = result.rowCount;
      warnings = result.warnings;
    } else {
      const typeFilter = normalizeTypeFilter(normalizedReportType);
      const documents = await gstDb.gstDocument.findMany({
        where: {
          gstSettingsId: input.gstSettingsId,
          documentDate: { gte: periodStart, lte: periodEnd },
          ...(typeFilter ? { documentType: { in: typeFilter } } : {}),
        },
        orderBy: [{ documentDate: "asc" }, { documentNumber: "asc" }],
      });
      console.log("[GST_REPORT_EXPORT] number of GstDocument rows found:", documents.length);

      const result = toCsv(documents as ReportDocument[]);
      csv = result.csv;
      rowCount = result.rowCount;
    }

    const checksum = createHash("sha256").update(csv).digest("hex");
    const fileUrl = toDataUrl(csv);

    const updated = await gstDb.gstReportRun.update({
      where: { id: reportRun.id },
      data: {
        status: "GENERATED",
        rowCount,
        fileUrl,
        checksum,
        filters: {
          ...((input.filters || {}) as Record<string, unknown>),
          warnings,
        },
        generatedAt: new Date(),
        errorMessage: null,
      },
    });

    return { ok: true, data: pickRun(updated as Record<string, unknown>) };
  } catch (error) {
    console.error("[GST_REPORT_EXPORT] caught error:", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "Failed to generate report",
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof Error ? error.message : "Failed to generate report";
    await gstDb.gstReportRun.update({
      where: { id: reportRun.id },
      data: {
        status: "FAILED",
        errorMessage: message,
        generatedAt: new Date(),
      },
    });
    return { ok: false, error: message };
  }
}

export async function getReportRun(id: string): Promise<GstServiceResult<GstReportRunRecord | null>> {
  try {
    const run = await gstDb.gstReportRun.findUnique({ where: { id: String(id).trim() } });
    return { ok: true, data: run ? pickRun(run as Record<string, unknown>) : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load report run" };
  }
}

export async function listReportRuns(filters: ReportRunFilters): Promise<GstServiceResult<GstReportRunRecord[]>> {
  try {
    const where = {
      ...(filters.gstSettingsId ? { gstSettingsId: String(filters.gstSettingsId).trim() } : {}),
      ...(filters.reportType ? { reportType: String(filters.reportType).trim() } : {}),
      ...(filters.status ? { status: String(filters.status).trim() } : {}),
    };

    const runs = await gstDb.gstReportRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return { ok: true, data: (runs as Record<string, unknown>[]).map(pickRun) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to list report runs" };
  }
}

export async function downloadReportFile(id: string): Promise<GstServiceResult<{ fileUrl: string | null }>> {
  const run = await getReportRun(id);
  if (!run.ok) return { ok: false, error: run.error };
  return { ok: true, data: { fileUrl: run.data?.fileUrl || null } };
}
