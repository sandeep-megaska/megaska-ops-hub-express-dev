import { gstDb } from "./db";
import { resolveGstStateCode } from "./state-codes";
import type { GstDocumentLineInput, GstServiceResult } from "./types";
import { buildInvoiceDraft } from "./invoice";
import { markOrderInvoiced } from "./order-import";
import { resolveSkuTaxMap } from "./sku-tax-map";

interface DispatchFilters {
  from?: string | Date;
  to?: string | Date;
  invoiceStatus?: string;
  readiness?: string;
  syncRunId?: string;
}

interface BatchGenerateInput {
  orderImportIds: string[];
  templateId?: string;
  regenerate?: boolean;
}

interface PrintBatchInput {
  documentIds?: string[];
  orderImportIds?: string[];
}

type DispatchDbClient = {
  gstOrderImport: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstDocument: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

const dispatchDb = gstDb as unknown as DispatchDbClient;

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractCustomerDefaultStateCode(snapshot: Record<string, unknown>): string | null {
  const customer = snapshot.customer && typeof snapshot.customer === "object" ? (snapshot.customer as Record<string, unknown>) : {};
  const defaultAddress = customer.defaultAddress && typeof customer.defaultAddress === "object"
    ? (customer.defaultAddress as Record<string, unknown>)
    : {};
  return (
    resolveGstStateCode(defaultAddress.provinceCode as string | null | undefined) ||
    resolveGstStateCode(defaultAddress.province as string | null | undefined) ||
    resolveGstStateCode(snapshot.customerDefaultStateCode as string | null | undefined) ||
    resolveGstStateCode(snapshot.customerDefaultState as string | null | undefined) ||
    resolveGstStateCode(snapshot.stateProvince as string | null | undefined) ||
    null
  );
}

export async function listDispatchReadyOrders(filters: DispatchFilters): Promise<GstServiceResult<Array<Record<string, unknown>>>> {
  try {
    const where: Record<string, unknown> = {};
    if (filters.from || filters.to) {
      where.orderCreatedAt = {
        ...(filters.from ? { gte: new Date(String(filters.from)) } : {}),
        ...(filters.to ? { lte: new Date(String(filters.to)) } : {}),
      };
    }

    const rows = await dispatchDb.gstOrderImport.findMany({
      where,
      include: {
        lines: { select: { sku: true, mappingStatus: true } },
      },
      orderBy: [{ orderCreatedAt: "desc" }],
      take: 500,
    });

    const data: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const orderImportId = String(row.id);
      const lines = Array.isArray(row.lines) ? (row.lines as Array<Record<string, unknown>>) : [];
      const mappedLines = lines.filter((line) => String(line.mappingStatus || "") === "MAPPED").length;
      const mappingCompleteness = lines.length === 0 ? 0 : Math.round((mappedLines / lines.length) * 10000) / 100;
      const unmappedSkus = Array.from(
        new Set(
          lines
            .filter((line) => String(line.mappingStatus || "").toUpperCase() !== "MAPPED")
            .map((line) => String(line.sku || "").trim())
            .filter(Boolean),
        ),
      );
      const invoice = await dispatchDb.gstDocument.findFirst({
        where: {
          documentType: "TAX_INVOICE",
          OR: [{ sourceOrderId: orderImportId }, { shopifyOrderId: String(row.shopifyOrderId || "") }],
        },
        orderBy: [{ createdAt: "desc" }],
        select: { id: true, documentNumber: true, status: true },
      });

      const readinessErrors = Array.isArray(row.readinessErrors) ? row.readinessErrors : [];
      const readiness = readinessErrors.length === 0 ? "READY" : "NOT_READY";
      const warnings = unmappedSkus.length > 0 ? ["Missing GST mapping for one or more SKU(s)"] : [];
      const eligibilityStatus = String(row.eligibilityStatus || "");

      data.push({
        id: orderImportId,
        orderName: String(row.shopifyOrderName || row.shopifyOrderId || ""),
        orderNumber: String(row.shopifyOrderName || "").replace(/^#/, ""),
        orderDate: asDate(row.orderCreatedAt)?.toISOString() || null,
        customerSummary: String(parseJson(row.snapshot).customerName || "-") || "-",
        skuCount: new Set(lines.map((line) => String(line.sku || "").trim()).filter(Boolean)).size,
        itemCount: lines.length,
        mappingCompleteness,
        readinessErrors,
        unmappedSkus,
        warnings,
        mappingActionUrl: unmappedSkus.length > 0 ? "/admin/gst/products" : null,
        importStatus: String(row.importStatus || ""),
        eligibilityStatus,
        readiness,
        invoiceStatus: invoice ? String(invoice.status || "") : "NOT_INVOICED",
        invoiceDocumentId: invoice ? String(invoice.id) : null,
        invoiceDocumentNumber: invoice ? String(invoice.documentNumber || "") : null,
      });
    }

    return {
      ok: true,
      data: data.filter((row) => {
        if (filters.invoiceStatus && String(row.invoiceStatus) !== String(filters.invoiceStatus)) return false;
        if (filters.readiness && String(row.readiness) !== String(filters.readiness)) return false;
        return true;
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to list dispatch-ready orders" };
  }
}

export async function generateInvoiceBatch(input: BatchGenerateInput) {
  const ids = Array.from(new Set((input.orderImportIds || []).map((id) => String(id).trim()).filter(Boolean)));
  if (!ids.length) {
    return { ok: false, error: "orderImportIds[] is required" } as const;
  }

  const summary = { generated: 0, skippedAlreadyInvoiced: 0, warningOnly: 0, failed: 0, results: [] as Array<Record<string, unknown>> };

  for (const id of ids) {
    const order = await dispatchDb.gstOrderImport.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });

    if (!order) {
      summary.failed += 1;
      summary.results.push({ id, status: "FAILED", error: "Order import not found" });
      continue;
    }

    const readinessErrors = Array.isArray(order.readinessErrors) ? order.readinessErrors : [];
    if (readinessErrors.length > 0) summary.warningOnly += 1;

    const existing = await dispatchDb.gstDocument.findFirst({
      where: {
        documentType: "TAX_INVOICE",
        OR: [{ sourceOrderId: id }, { shopifyOrderId: String(order.shopifyOrderId || "") }],
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, documentNumber: true },
    });

    if (existing && !input.regenerate) {
      summary.skippedAlreadyInvoiced += 1;
      summary.results.push({ id, status: "SKIPPED_ALREADY_INVOICED", documentId: String(existing.id) });
      continue;
    }

    const snapshot = parseJson(order.snapshot);
    const customerDefaultStateCode = extractCustomerDefaultStateCode(snapshot);
    const invoiceLines: GstDocumentLineInput[] = [];
    const lineErrors: string[] = [];
    for (const line of Array.isArray(order.lines) ? order.lines : []) {
      const row = line as Record<string, unknown>;
      const sku = String(row.sku || "").trim();
      const mapping = await resolveSkuTaxMap({ shopId: String(order.shopId || "") || null, sku });
      if (!mapping.ok) {
        lineErrors.push(mapping.error || `Missing GST mapping for SKU ${sku || `LINE-${String(row.lineNumber || "")}`}`);
        continue;
      }
      if (!mapping.data) {
        lineErrors.push(`Missing GST mapping for SKU ${sku || `LINE-${String(row.lineNumber || "")}`}`);
        continue;
      }
      invoiceLines.push({
        description: String(row.title || sku || "Item"),
        quantity: parseNum(row.quantity),
        unitPrice: parseNum(row.unitPrice),
        taxRate: Number(mapping.data.taxRate || 0),
        cessRate: Number(mapping.data.cessRate || 0),
        hsnOrSac: mapping.data.hsnCode || undefined,
        discount: parseNum(row.discount),
      });
    }

    if (lineErrors.length > 0) {
      summary.failed += 1;
      summary.results.push({ id, status: "FAILED", error: "Line mapping missing", lineErrors });
      continue;
    }

    const invoice = await buildInvoiceDraft({
      gstSettingsId: String(order.gstSettingsId || ""),
      sourceOrderId: String(order.id),
      sourceOrderNumber: String(order.shopifyOrderName || order.shopifyOrderId || ""),
      sourceReference: "GST_DISPATCH_BATCH",
      shopifyOrderId: String(order.shopifyOrderId || ""),
      shopifyOrderName: String(order.shopifyOrderName || ""),
      documentDate: asDate(order.orderCreatedAt)?.toISOString() || new Date().toISOString(),
      billingStateCode: order.billingStateCode ? String(order.billingStateCode) : null,
      shippingStateCode: order.shippingStateCode ? String(order.shippingStateCode) : null,
      buyer: {
        legalName: String(snapshot.customerName || "Customer"),
        gstin: null,
        stateCode: (order.shippingStateCode || order.billingStateCode || customerDefaultStateCode)
          ? String(order.shippingStateCode || order.billingStateCode || customerDefaultStateCode)
          : null,
      },
      currency: String(order.orderCurrency || "INR"),
      lines: invoiceLines,
      metadata: { dispatchBatch: true, templateId: input.templateId || null, gstOrderImportId: String(order.id) },
    });

    if (!invoice.ok || !invoice.data) {
      summary.failed += 1;
      summary.results.push({ id, status: "FAILED", error: invoice.error || "Invoice generation failed", readinessErrors });
      continue;
    }

    await markOrderInvoiced({ gstOrderImportId: id, gstDocumentId: invoice.data.id });
    summary.generated += 1;
    summary.results.push({ id, status: "GENERATED", documentId: invoice.data.id, documentNumber: invoice.data.documentNumber, readinessWarnings: readinessErrors });
  }

  return { ok: true, data: summary } as const;
}

export async function prepareInvoicePrintBatch(input: PrintBatchInput): Promise<GstServiceResult<Record<string, unknown>>> {
  const documentIds = Array.from(new Set((input.documentIds || []).map((id) => String(id).trim()).filter(Boolean)));

  try {
    let resolvedDocumentIds = [...documentIds];
    if (!resolvedDocumentIds.length && (input.orderImportIds || []).length) {
      const imports = Array.from(new Set((input.orderImportIds || []).map((id) => String(id).trim()).filter(Boolean)));
      const docs = await dispatchDb.gstDocument.findMany({
        where: {
          documentType: "TAX_INVOICE",
          sourceOrderId: { in: imports },
        },
        select: { id: true },
      });
      resolvedDocumentIds = docs.map((doc) => String(doc.id));
    }

    if (!resolvedDocumentIds.length) {
      return { ok: false, error: "No GST invoice generated because place of supply is missing." };
    }

    const documents = await dispatchDb.gstDocument.findMany({
      where: { id: { in: resolvedDocumentIds } },
      select: { id: true, documentNumber: true, sourceOrderNumber: true, documentDate: true, status: true },
      orderBy: [{ documentDate: "asc" }, { documentNumber: "asc" }],
    });

    const files = documents.map((doc) => ({
      documentId: String(doc.id),
      documentNumber: String(doc.documentNumber || ""),
      sourceOrderNumber: String(doc.sourceOrderNumber || ""),
      status: String(doc.status || ""),
      documentDate: asDate(doc.documentDate)?.toISOString() || null,
      pdfUrl: `/api/gst/documents/${String(doc.id)}/pdf`,
    }));

    return {
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        count: files.length,
        manifest: files,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to prepare print batch" };
  }
}
