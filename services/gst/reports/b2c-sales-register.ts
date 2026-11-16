import { gstDb } from "../db";
import { toCsv } from "./csv";
import type { B2cSalesRegisterExport, B2cSalesRegisterRow, ReportWarning } from "./types";
import { istDateString, itemTypeForHsn, orderStatusOf } from "./order-status";

type GstDocumentForReport = {
  id: string;
  documentNumber: string;
  documentType: string;
  documentDate: Date;
  sourceOrderId?: string | null;
  sourceOrderNumber: string | null;
  shopifyOrderName: string | null;
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
    description: string;
    hsnOrSac: string | null;
    quantity: unknown;
    unitPrice: unknown;
    taxableAmount?: unknown;
    taxRate: unknown;
    cgstAmount: unknown;
    sgstAmount: unknown;
    igstAmount: unknown;
    cessAmount: unknown;
    lineTotal: unknown;
  }>;
};

type SnapshotLine = {
  product: string;
  variant: string;
  hsn: string;
  quantity: unknown;
  taxable: unknown;
  gstRate: unknown;
  igst: unknown;
  cgst: unknown;
  sgst: unknown;
  cess: unknown;
  total: unknown;
};

export const B2C_SALES_REGISTER_HEADERS = [
  "Invoice Date",
  "Invoice Number",
  "Document Type",
  "Order Number",
  "Customer",
  "Place of Supply",
  "Product",
  "Variant",
  "HSN",
  "Quantity",
  "Price",
  "GST %",
  "IGST",
  "CGST",
  "SGST",
  "CESS",
  "Total",
  "Item Type",
  "Payment Status",
  "Payment Gateway",
  "Fulfillment Status",
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

// GST invoice dates are India-time calendar dates: an order placed at 00:30 IST on
// 2 Oct is a 2 Oct invoice, though it is still 1 Oct in UTC.
function formatDateYyyyMmDd(value: Date): string {
  return istDateString(value);
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

function extractSnapshot(snapshotRaw: unknown): Record<string, unknown> {
  return typeof snapshotRaw === "object" && snapshotRaw !== null ? (snapshotRaw as Record<string, unknown>) : {};
}

function extractCustomer(snapshot: Record<string, unknown>): string {
  return (
    snapshotValue(snapshot, [["buyer", "legalName"], ["buyer", "tradeName"], ["billingAddress", "name"], ["shippingAddress", "name"], ["metadata", "customerName"], ["customer", "displayName"], ["customer", "name"]]) ||
    "UNREGISTERED"
  );
}

function extractOrderNumber(document: GstDocumentForReport, snapshot: Record<string, unknown>): string {
  return (
    snapshotValue(snapshot, [["source", "sourceOrderNumber"], ["source", "shopifyOrderName"], ["metadata", "orderNumber"], ["metadata", "sourceOrderNumber"], ["orderNumber"], ["order", "name"], ["order", "orderNumber"]]) ||
    asText(document.sourceOrderNumber) ||
    asText(document.shopifyOrderName) ||
    ""
  );
}

function extractLineItems(snapshot: Record<string, unknown>): SnapshotLine[] {
  const lineGroups: unknown[] = [
    snapshot.lines,
    snapshot.lineItems,
    snapshot.orderLines,
    typeof snapshot.order === "object" && snapshot.order !== null ? (snapshot.order as Record<string, unknown>).lineItems : null,
    typeof snapshot.metadata === "object" && snapshot.metadata !== null ? (snapshot.metadata as Record<string, unknown>).lineItems : null,
  ];

  const lines = lineGroups.find((group) => Array.isArray(group));
  if (!Array.isArray(lines)) return [];

  return lines.map((item) => {
    const line = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      product: asText(line.product) || asText(line.productName) || asText(line.title) || asText(line.description),
      variant: asText(line.variant) || asText(line.variantName) || asText(line.variantTitle),
      hsn: asText(line.hsn) || asText(line.hsnCode) || asText(line.hsnOrSac),
      quantity: line.quantity,
      taxable: line.taxableAmount ?? line.taxable ?? line.taxableValue,
      gstRate: line.gstRate ?? line.taxRate,
      igst: line.igst ?? line.igstAmount,
      cgst: line.cgst ?? line.cgstAmount,
      sgst: line.sgst ?? line.sgstAmount,
      cess: line.cess ?? line.cessAmount,
      total: line.total ?? line.lineTotal,
    };
  });
}

function buildRow(input: {
  document: GstDocumentForReport;
  orderNumber: string;
  customer: string;
  product?: string;
  variant?: string;
  hsn?: string;
  quantity?: unknown;
  taxable?: unknown;
  gstRate?: unknown;
  igst?: unknown;
  cgst?: unknown;
  sgst?: unknown;
  cess?: unknown;
  total?: unknown;
  itemType?: string;
  paymentStatus?: string;
  paymentGateway?: string;
  fulfillmentStatus?: string;
}): B2cSalesRegisterRow {
  // Credit notes reduce GST liability; net them out so the register totals match
  // the GSTR-1 figures. Debit notes and invoices stay positive.
  const sign = input.document.documentType === "CREDIT_NOTE" ? -1 : 1;

  return {
    invoiceDate: formatDateYyyyMmDd(input.document.documentDate),
    invoiceNumber: input.document.documentNumber,
    documentType: input.document.documentType,
    orderNumber: input.orderNumber,
    customer: input.customer,
    placeOfSupply: input.document.placeOfSupplyStateCode,
    product: input.product || "",
    variant: input.variant || "",
    hsn: input.hsn || "",
    quantity: sign * asFiniteNumber(input.quantity),
    // "Price" is the line's taxable value (before GST), as GSTR-1 reports it:
    // Price + IGST + CGST + SGST + CESS = Total. Older snapshots without a
    // taxable amount get it from the total less the tax.
    price: sign * taxableValue(input),
    gstPercent: asFiniteNumber(input.gstRate),
    igst: sign * asFiniteNumber(input.igst),
    cgst: sign * asFiniteNumber(input.cgst),
    sgst: sign * asFiniteNumber(input.sgst),
    cess: sign * asFiniteNumber(input.cess),
    total: sign * asFiniteNumber(input.total),
    itemType: input.itemType || "",
    paymentStatus: input.paymentStatus || "",
    paymentGateway: input.paymentGateway || "",
    fulfillmentStatus: input.fulfillmentStatus || "",
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function taxableValue(input: { taxable?: unknown; total?: unknown; igst?: unknown; cgst?: unknown; sgst?: unknown; cess?: unknown }): number {
  const hasTaxable = input.taxable !== undefined && input.taxable !== null && String(input.taxable).trim() !== "";
  if (hasTaxable) return round2(asFiniteNumber(input.taxable));
  return round2(asFiniteNumber(input.total) - asFiniteNumber(input.igst) - asFiniteNumber(input.cgst) - asFiniteNumber(input.sgst) - asFiniteNumber(input.cess));
}

function serializeRows(rows: B2cSalesRegisterRow[]): string {
  const csvRows = rows.map((row) => [
    row.invoiceDate,
    row.invoiceNumber,
    row.documentType,
    row.orderNumber,
    row.customer,
    row.placeOfSupply,
    row.product,
    row.variant,
    row.hsn,
    row.quantity,
    row.price,
    row.gstPercent,
    row.igst,
    row.cgst,
    row.sgst,
    row.cess,
    row.total,
    row.itemType,
    row.paymentStatus,
    row.paymentGateway,
    row.fulfillmentStatus,
  ]);

  return toCsv([...B2C_SALES_REGISTER_HEADERS], csvRows);
}

type OrderImportForReport = { id: string; snapshot: unknown };

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Payment / fulfilment status and gateway: the order's current state, from its
 * GST order import (refreshed by every sync), else the copy saved on the invoice.
 */
function extractOrderStatusFields(orderSnapshot: unknown, documentSnapshot: Record<string, unknown>): {
  paymentStatus: string;
  paymentGateway: string;
  fulfillmentStatus: string;
} {
  const current = orderStatusOf(orderSnapshot);
  const saved = orderStatusOf(recordOf(documentSnapshot.metadata).orderSnapshot);
  return {
    paymentStatus: current.financialStatus || saved.financialStatus,
    paymentGateway: current.paymentGateway || saved.paymentGateway,
    fulfillmentStatus: current.fulfillmentStatus || saved.fulfillmentStatus,
  };
}

/** The order line an invoice line came from: by SKU ("SKU • title"), else by position. */
function variantFor(orderSnapshot: unknown, documentSnapshot: Record<string, unknown>, product: string, index: number): string {
  const lines = [recordOf(orderSnapshot).lines, recordOf(recordOf(documentSnapshot.metadata).orderSnapshot).lines].find(
    (candidate) => Array.isArray(candidate) && candidate.some((line) => asText(recordOf(line).variantTitle)),
  );
  if (!Array.isArray(lines)) return "";
  const sku = product.includes(" • ") ? product.split(" • ")[0].trim() : "";
  const bySku = sku ? lines.find((line) => asText(recordOf(line).sku) === sku) : undefined;
  return asText(recordOf(bySku ?? lines[index]).variantTitle);
}

export async function buildB2cSalesRegisterExport(input: {
  gstSettingsId: string;
  shopId?: string | null;
  periodStart: Date;
  periodEnd: Date;
}): Promise<B2cSalesRegisterExport> {
  const where = {
    gstSettingsId: input.gstSettingsId,
    // Multi-tenant safety: scope by shopId as well when supplied (gstSettingsId is
    // already shop-specific, but shopId is now a first-class column on every row).
    ...(input.shopId ? { shopId: input.shopId } : {}),
    // A GSTR-1-consistent B2C register nets sales against adjustments: include tax
    // invoices AND credit/debit notes. Credit notes are negated at row build time.
    documentType: { in: ["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"] as const },
    supplyType: "B2C" as const,
    documentDate: { gte: input.periodStart, lte: input.periodEnd },
    // Report preparation creates draft GST documents; B2C export includes DRAFT and ISSUED GstDocument records because GstDocument is the finalized tax snapshot for export.
    status: { in: ["DRAFT", "ISSUED"] as const },
  };

  let documents: GstDocumentForReport[];
  try {
    documents = (await gstDb.gstDocument.findMany({
      where,
      select: {
        id: true,
        documentNumber: true,
        documentType: true,
        documentDate: true,
        sourceOrderId: true,
        sourceOrderNumber: true,
        shopifyOrderName: true,
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
            description: true,
            hsnOrSac: true,
            quantity: true,
            unitPrice: true,
            taxableAmount: true,
            taxRate: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            cessAmount: true,
            lineTotal: true,
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
  const rows: B2cSalesRegisterRow[] = [];
  const warnings: ReportWarning[] = [];

  // The orders behind these documents, for their current payment/fulfilment status.
  const orderImportIds = Array.from(new Set(documents.map((document) => asText(document.sourceOrderId)).filter(Boolean)));
  const orderImports: OrderImportForReport[] = orderImportIds.length
    ? ((await (gstDb as unknown as { gstOrderImport: { findMany: (args: unknown) => Promise<OrderImportForReport[]> } }).gstOrderImport.findMany({
        where: { id: { in: orderImportIds }, ...(input.shopId ? { shopId: input.shopId } : {}) },
        select: { id: true, snapshot: true },
      })) ?? [])
    : [];
  const orderSnapshotById = new Map(orderImports.map((row) => [String(row.id), row.snapshot]));

  if (documents.length === 0) {
    warnings.push({
      code: "NO_INVOICES_IN_RANGE",
      message: "No GstDocument invoices found for selected range.",
      documentId: "",
      documentNumber: "",
    });
  }

  for (const document of documents) {
    const snapshot = extractSnapshot(document.jsonSnapshot);
    const customer = extractCustomer(snapshot);
    const orderNumber = extractOrderNumber(document, snapshot);
    const orderSnapshot = orderSnapshotById.get(asText(document.sourceOrderId));
    const statusFields = extractOrderStatusFields(orderSnapshot, snapshot);

    if (customer === "UNREGISTERED") {
      warnings.push({
        code: "MISSING_CUSTOMER_NAME",
        message: "Customer name missing in jsonSnapshot; exported as UNREGISTERED",
        documentId: document.id,
        documentNumber: document.documentNumber,
      });
    }

    const snapshotLines = extractLineItems(snapshot);
    if (snapshotLines.length > 0) {
      for (const [index, snapshotLine] of snapshotLines.entries()) {
        rows.push(
          buildRow({
            document,
            orderNumber,
            customer,
            product: snapshotLine.product,
            variant: snapshotLine.variant || variantFor(orderSnapshot, snapshot, snapshotLine.product, index),
            hsn: snapshotLine.hsn,
            itemType: itemTypeForHsn(snapshotLine.hsn),
            quantity: snapshotLine.quantity,
            taxable: snapshotLine.taxable,
            gstRate: snapshotLine.gstRate,
            igst: snapshotLine.igst,
            cgst: snapshotLine.cgst,
            sgst: snapshotLine.sgst,
            cess: snapshotLine.cess,
            total: snapshotLine.total,
            ...statusFields,
          })
        );
      }
      continue;
    }

    if (document.lines.length > 0) {
      warnings.push({
        code: "LINE_ITEMS_MISSING_IN_SNAPSHOT",
        message: "jsonSnapshot line items missing; exported from stored GstDocument lines",
        documentId: document.id,
        documentNumber: document.documentNumber,
      });

      for (const [index, line] of document.lines.entries()) {
        rows.push(
          buildRow({
            document,
            orderNumber,
            customer,
            product: line.description,
            variant: variantFor(orderSnapshot, snapshot, line.description, index),
            hsn: line.hsnOrSac || "",
            itemType: itemTypeForHsn(line.hsnOrSac || ""),
            quantity: line.quantity,
            taxable: line.taxableAmount,
            gstRate: line.taxRate,
            igst: line.igstAmount,
            cgst: line.cgstAmount,
            sgst: line.sgstAmount,
            cess: line.cessAmount,
            total: line.lineTotal,
            ...statusFields,
          })
        );
      }
      continue;
    }

    warnings.push({
      code: "NO_LINES_FALLBACK_TO_DOCUMENT",
      message: "No line items found; exported one document-level row using stored totals",
      documentId: document.id,
      documentNumber: document.documentNumber,
    });

    rows.push(
      buildRow({
        document,
        orderNumber,
        customer,
        itemType: itemTypeForHsn(""),
        taxable: document.taxableAmount,
        igst: document.igstAmount,
        cgst: document.cgstAmount,
        sgst: document.sgstAmount,
        cess: document.cessAmount,
        total: document.totalAmount,
        ...statusFields,
      })
    );
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
