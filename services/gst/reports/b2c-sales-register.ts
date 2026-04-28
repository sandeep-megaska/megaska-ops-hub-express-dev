import { gstDb } from "../db";
import { formatDateDdMmYyyy, toCsv } from "./csv";
import type { B2cSalesRegisterExport, B2cSalesRegisterRow, ReportWarning } from "./types";

type GstDocumentForReport = {
  id: string;
  documentNumber: string;
  documentDate: Date;
  placeOfSupplyStateCode: string;
  taxableAmount: unknown;
  cgstAmount: unknown;
  sgstAmount: unknown;
  igstAmount: unknown;
  cessAmount: unknown;
  totalAmount: unknown;
  jsonSnapshot: unknown;
  lines: Array<{
    lineNumber: number;
    hsnOrSac: string | null;
    taxableAmount: unknown;
    taxRate: unknown;
    cgstAmount: unknown;
    sgstAmount: unknown;
    igstAmount: unknown;
    cessAmount: unknown;
  }>;
};

export const B2C_SALES_REGISTER_HEADERS = [
  "Invoice Number",
  "Invoice Date",
  "Customer Name",
  "Customer GSTIN",
  "Place of Supply",
  "Invoice Value",
  "Taxable Value",
  "GST Rate",
  "CGST",
  "SGST",
  "IGST",
  "CESS",
  "HSN Code",
] as const;

function asFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function snapshotValue(snapshot: Record<string, unknown>, paths: string[][]): string {
  for (const path of paths) {
    let current: unknown = snapshot;
    for (const key of path) {
      if (typeof current !== "object" || current === null || !(key in current)) {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[key];
    }
    const text = asText(current);
    if (text.length > 0) return text;
  }
  return "";
}

function extractCustomer(snapshotRaw: unknown): { customerName: string; customerGstin: string } {
  const snapshot = typeof snapshotRaw === "object" && snapshotRaw !== null ? (snapshotRaw as Record<string, unknown>) : {};

  const customerName =
    snapshotValue(snapshot, [["buyer", "legalName"], ["buyer", "tradeName"], ["billingAddress", "name"], ["shippingAddress", "name"], ["metadata", "customerName"]]) ||
    "UNREGISTERED";

  const gstin = snapshotValue(snapshot, [["buyer", "gstin"], ["metadata", "customerGstin"], ["source", "customerGstin"]]);

  return {
    customerName,
    customerGstin: gstin || "UNREGISTERED",
  };
}

function toLineRow(document: GstDocumentForReport, line: GstDocumentForReport["lines"][number], customer: { customerName: string; customerGstin: string }): B2cSalesRegisterRow {
  return {
    invoiceNumber: document.documentNumber,
    invoiceDate: formatDateDdMmYyyy(document.documentDate),
    customerName: customer.customerName,
    customerGstin: customer.customerGstin,
    placeOfSupply: document.placeOfSupplyStateCode,
    invoiceValue: asFiniteNumber(document.totalAmount),
    taxableValue: asFiniteNumber(line.taxableAmount),
    gstRate: asFiniteNumber(line.taxRate),
    cgst: asFiniteNumber(line.cgstAmount),
    sgst: asFiniteNumber(line.sgstAmount),
    igst: asFiniteNumber(line.igstAmount),
    cess: asFiniteNumber(line.cessAmount),
    hsnCode: line.hsnOrSac?.trim() || "",
  };
}

function toDocumentFallbackRow(document: GstDocumentForReport, customer: { customerName: string; customerGstin: string }): B2cSalesRegisterRow {
  return {
    invoiceNumber: document.documentNumber,
    invoiceDate: formatDateDdMmYyyy(document.documentDate),
    customerName: customer.customerName,
    customerGstin: customer.customerGstin,
    placeOfSupply: document.placeOfSupplyStateCode,
    invoiceValue: asFiniteNumber(document.totalAmount),
    taxableValue: asFiniteNumber(document.taxableAmount),
    gstRate: 0,
    cgst: asFiniteNumber(document.cgstAmount),
    sgst: asFiniteNumber(document.sgstAmount),
    igst: asFiniteNumber(document.igstAmount),
    cess: asFiniteNumber(document.cessAmount),
    hsnCode: "",
  };
}

function serializeRows(rows: B2cSalesRegisterRow[]): string {
  const csvRows = rows.map((row) => [
    row.invoiceNumber,
    row.invoiceDate,
    row.customerName,
    row.customerGstin,
    row.placeOfSupply,
    row.invoiceValue,
    row.taxableValue,
    row.gstRate,
    row.cgst,
    row.sgst,
    row.igst,
    row.cess,
    row.hsnCode,
  ]);

  return toCsv([...B2C_SALES_REGISTER_HEADERS], csvRows);
}

export async function buildB2cSalesRegisterExport(input: {
  gstSettingsId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<B2cSalesRegisterExport> {
  let documents: GstDocumentForReport[];
  try {
    documents = (await gstDb.gstDocument.findMany({
      where: {
        gstSettingsId: input.gstSettingsId,
        documentType: "TAX_INVOICE",
        supplyType: "B2C",
        status: "ISSUED",
        documentDate: { gte: input.periodStart, lte: input.periodEnd },
      },
      select: {
        id: true,
        documentNumber: true,
        documentDate: true,
        placeOfSupplyStateCode: true,
        taxableAmount: true,
        cgstAmount: true,
        sgstAmount: true,
        igstAmount: true,
        cessAmount: true,
        totalAmount: true,
        jsonSnapshot: true,
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            lineNumber: true,
            hsnOrSac: true,
            taxableAmount: true,
            taxRate: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            cessAmount: true,
          },
        },
      },
      orderBy: [{ documentDate: "asc" }, { documentNumber: "asc" }],
    })) as unknown as GstDocumentForReport[];
  } catch (error) {
    console.error("[GST_B2C_REPORT] caught error:", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "Failed to load GST documents",
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
  console.log("[GST_B2C_REPORT] number of GstDocument rows found:", documents.length);

  const rows: B2cSalesRegisterRow[] = [];
  const warnings: ReportWarning[] = [];

  for (const document of documents) {
    const customer = extractCustomer(document.jsonSnapshot);

    if (customer.customerName === "UNREGISTERED") {
      warnings.push({
        code: "MISSING_CUSTOMER_NAME",
        message: "Customer name missing in jsonSnapshot; exported as UNREGISTERED",
        documentId: document.id,
        documentNumber: document.documentNumber,
      });
    }

    if (!document.lines.length) {
      warnings.push({
        code: "NO_LINES_FALLBACK_TO_DOCUMENT",
        message: "Document has no line-level rows; exported using document-level totals",
        documentId: document.id,
        documentNumber: document.documentNumber,
      });
      rows.push(toDocumentFallbackRow(document, customer));
      continue;
    }

    for (const line of document.lines) {
      if (!line.hsnOrSac?.trim()) {
        warnings.push({
          code: "MISSING_LINE_HSN",
          message: "Line has no HSN/SAC code",
          documentId: document.id,
          documentNumber: document.documentNumber,
          lineNumber: line.lineNumber,
        });
      }
      if (!asFiniteNumber(line.taxRate)) {
        warnings.push({
          code: "MISSING_LINE_TAX_RATE",
          message: "Line has missing GST rate; exported as 0",
          documentId: document.id,
          documentNumber: document.documentNumber,
          lineNumber: line.lineNumber,
        });
      }
      rows.push(toLineRow(document, line, customer));
    }
  }

  return {
    reportType: "B2C_SALES_REGISTER",
    headers: B2C_SALES_REGISTER_HEADERS,
    rows,
    warnings,
    rowCount: rows.length,
    csv: serializeRows(rows),
  };
}

export async function generateB2cSalesRegisterCsv(input: {
  gstSettingsId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ csv: string; rowCount: number; warnings: ReportWarning[] }> {
  const result = await buildB2cSalesRegisterExport(input);
  return { csv: result.csv, rowCount: result.rowCount, warnings: result.warnings };
}
