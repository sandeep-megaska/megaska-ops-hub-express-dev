import { gstDb } from "../db";
import { toCsv } from "./csv";
import type { B2cSalesRegisterExport, B2cSalesRegisterRow, ReportWarning } from "./types";

type GstDocumentForReport = {
  id: string;
  documentNumber: string;
  documentDate: Date;
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
  price: unknown;
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

function formatDateYyyyMmDd(value: Date): string {
  return value.toISOString().slice(0, 10);
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
      price: line.price ?? line.unitPrice,
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
  price?: unknown;
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
  return {
    invoiceDate: formatDateYyyyMmDd(input.document.documentDate),
    invoiceNumber: input.document.documentNumber,
    orderNumber: input.orderNumber,
    customer: input.customer,
    placeOfSupply: input.document.placeOfSupplyStateCode,
    product: input.product || "",
    variant: input.variant || "",
    hsn: input.hsn || "",
    quantity: asFiniteNumber(input.quantity),
    price: asFiniteNumber(input.price),
    gstPercent: asFiniteNumber(input.gstRate),
    igst: asFiniteNumber(input.igst),
    cgst: asFiniteNumber(input.cgst),
    sgst: asFiniteNumber(input.sgst),
    cess: asFiniteNumber(input.cess),
    total: asFiniteNumber(input.total),
    itemType: input.itemType || "",
    paymentStatus: input.paymentStatus || "",
    paymentGateway: input.paymentGateway || "",
    fulfillmentStatus: input.fulfillmentStatus || "",
  };
}

function serializeRows(rows: B2cSalesRegisterRow[]): string {
  const csvRows = rows.map((row) => [
    row.invoiceDate,
    row.invoiceNumber,
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

function extractOrderStatusFields(snapshot: Record<string, unknown>): {
  paymentStatus: string;
  paymentGateway: string;
  fulfillmentStatus: string;
  itemType: string;
} {
  return {
    paymentStatus: snapshotValue(snapshot, [["paymentStatus"], ["order", "paymentStatus"], ["source", "paymentStatus"]]),
    paymentGateway: snapshotValue(snapshot, [["paymentGateway"], ["order", "paymentGateway"], ["source", "paymentGateway"]]),
    fulfillmentStatus: snapshotValue(snapshot, [["fulfillmentStatus"], ["order", "fulfillmentStatus"], ["source", "fulfillmentStatus"]]),
    itemType: snapshotValue(snapshot, [["itemType"], ["order", "itemType"], ["source", "itemType"]]),
  };
}

export async function buildB2cSalesRegisterExport(input: {
  gstSettingsId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<B2cSalesRegisterExport> {
  const documentCountForSettings = await gstDb.gstDocument.count({ where: { gstSettingsId: input.gstSettingsId } });
  console.log("[GST_B2C_REPORT] GstDocument count for gstSettings before filters:", documentCountForSettings);

  const invoiceTypeWhere = {
    gstSettingsId: input.gstSettingsId,
    documentType: "TAX_INVOICE" as const,
  };
  const invoiceTypeInRangeWhere = {
    ...invoiceTypeWhere,
    documentDate: { gte: input.periodStart, lte: input.periodEnd },
  };
  const invoiceTypeInRangeB2cWhere = {
    ...invoiceTypeInRangeWhere,
    supplyType: "B2C" as const,
  };

  const [
    taxInvoiceCount,
    taxInvoiceInRangeCount,
    taxInvoiceInRangeB2cCount,
    taxInvoiceInRangeB2cStatusCounts,
  ] = await Promise.all([
    gstDb.gstDocument.count({ where: invoiceTypeWhere }),
    gstDb.gstDocument.count({ where: invoiceTypeInRangeWhere }),
    gstDb.gstDocument.count({ where: invoiceTypeInRangeB2cWhere }),
    gstDb.gstDocument.groupBy({
      by: ["status"],
      where: invoiceTypeInRangeB2cWhere,
      _count: { _all: true },
    }),
  ]);

  const statusBreakdown = taxInvoiceInRangeB2cStatusCounts.reduce<Record<string, number>>((acc, row) => {
    acc[String(row.status)] = Number(row._count?._all || 0);
    return acc;
  }, {});

  const diagnostics = {
    gstSettingsDocumentCount: documentCountForSettings,
    taxInvoiceCount,
    taxInvoiceInRangeCount,
    taxInvoiceInRangeB2cCount,
    taxInvoiceInRangeB2cByStatus: statusBreakdown,
  };

  const where = {
    ...invoiceTypeInRangeB2cWhere,
    // Report preparation currently creates draft invoices first; include both until issuance is enforced in the generation flow.
    status: { in: ["DRAFT", "ISSUED"] as const },
  };

  const filteredDocumentCount = await gstDb.gstDocument.count({ where });
  console.log("[GST_B2C_REPORT] GstDocument count after filters:", filteredDocumentCount);
  console.log("[GST_B2C_REPORT] diagnostics:", diagnostics);
  console.log("[GST_B2C_REPORT] filters:", {
    gstSettingsId: input.gstSettingsId,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    where,
  });

  const sampleDocument = await gstDb.gstDocument.findFirst({
    where: { gstSettingsId: input.gstSettingsId },
    orderBy: { documentDate: "desc" },
    select: {
      id: true,
      documentNumber: true,
      documentDate: true,
      status: true,
      documentType: true,
      supplyType: true,
      placeOfSupplyStateCode: true,
      sourceOrderNumber: true,
      shopifyOrderName: true,
      jsonSnapshot: true,
    },
  });
  console.log("[GST_B2C_REPORT] sample GstDocument shape:", sampleDocument);

  let documents: GstDocumentForReport[];
  try {
    documents = (await gstDb.gstDocument.findMany({
      where,
      select: {
        id: true,
        documentNumber: true,
        documentDate: true,
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
  console.log("[GST_B2C_REPORT] number of GstDocument rows loaded:", documents.length);

  const rows: B2cSalesRegisterRow[] = [];
  const warnings: ReportWarning[] = [];

  warnings.push({
    code: "DIAGNOSTIC_COUNTS",
    message: `Temporary B2C export diagnostics: ${JSON.stringify(diagnostics)}`,
    documentId: "",
    documentNumber: "",
  });

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
    const statusFields = extractOrderStatusFields(snapshot);

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
      for (const snapshotLine of snapshotLines) {
        rows.push(
          buildRow({
            document,
            orderNumber,
            customer,
            product: snapshotLine.product,
            variant: snapshotLine.variant,
            hsn: snapshotLine.hsn,
            quantity: snapshotLine.quantity,
            price: snapshotLine.price,
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

      for (const line of document.lines) {
        rows.push(
          buildRow({
            document,
            orderNumber,
            customer,
            product: line.description,
            hsn: line.hsnOrSac || "",
            quantity: line.quantity,
            price: line.unitPrice,
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
