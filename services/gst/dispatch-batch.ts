import { gstDb } from "./db";
import { resolveGstStateCode } from "./state-codes";
import type { GstDocumentLineInput, GstServiceResult } from "./types";
import { buildInvoiceDraft } from "./invoice";
import { markOrderInvoiced } from "./order-import";
import { resolveSkuTaxMap } from "./sku-tax-map";
import { getTemplateById } from "./template";
import { gstPerfLog, gstPerfNow } from "./perf";

interface DispatchFilters {
  shopId?: string | null;
  from?: string | Date;
  to?: string | Date;
  invoiceStatus?: string;
  readiness?: string;
  syncRunId?: string;
}

interface BatchGenerateInput {
  shopId?: string | null;
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
const STALE_SUBTOTAL_WARNING = "Order amount sanity check failed: subtotal + tax does not match grand total";

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractSkuList(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  return Array.from(
    new Set(
      lines
        .map((line) => {
          const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
          return String(row.sku || "").trim();
        })
        .filter(Boolean)
    )
  );
}

function normalizeReadinessWarnings(readinessErrors: unknown, priceIncludesTax: boolean): string[] {
  const warnings = Array.isArray(readinessErrors) ? readinessErrors.map((warning) => String(warning || "").trim()).filter(Boolean) : [];
  if (!priceIncludesTax) {
    return warnings;
  }
  return warnings.filter((warning) => warning !== STALE_SUBTOTAL_WARNING);
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
    const totalStartedAtMs = gstPerfNow();
    const where: Record<string, unknown> = {};
    if (filters.shopId) {
      where.shopId = String(filters.shopId);
    }
    if (filters.from || filters.to) {
      where.orderCreatedAt = {
        ...(filters.from ? { gte: new Date(String(filters.from)) } : {}),
       ...(filters.to
  ? { lte: new Date(`${String(filters.to).slice(0, 10)}T23:59:59.999Z`) }
  : {}),
      };
    }

    const dbFetchStartedAtMs = gstPerfNow();
    const rows = await dispatchDb.gstOrderImport.findMany({
      where,
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            lineNumber: true,
            title: true,
            sku: true,
            shopifyProductId: true,
            shopifyVariantId: true,
            quantity: true,
            unitPrice: true,
            discount: true,
            taxableAmount: true,
            mappingStatus: true,
            mappedHsnCode: true,
            mappedTaxRate: true,
            mappedCessRate: true,
          },
        },
      },
      orderBy: [{ orderCreatedAt: "desc" }],
      take: 500,
    });
    gstPerfLog("gst.dispatchReady.dbFetch", dbFetchStartedAtMs, { rowCount: rows.length });

    const orderImportIds = rows.map((row) => String(row.id || "").trim()).filter(Boolean);
    const shopifyOrderIds = Array.from(new Set(rows.map((row) => String(row.shopifyOrderId || "").trim()).filter(Boolean)));
    const invoiceLookupStartedAtMs = gstPerfNow();
    const invoiceRows = orderImportIds.length || shopifyOrderIds.length
      ? await dispatchDb.gstDocument.findMany({
          where: {
            documentType: "TAX_INVOICE",
            OR: [
              ...(orderImportIds.length ? [{ sourceOrderId: { in: orderImportIds } }] : []),
              ...(shopifyOrderIds.length ? [{ shopifyOrderId: { in: shopifyOrderIds } }] : []),
            ],
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            documentNumber: true,
            status: true,
            sourceOrderId: true,
            shopifyOrderId: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            cessAmount: true,
          },
        })
      : [];
    const invoiceByOrderImportId = new Map<string, Record<string, unknown>>();
    const invoiceByShopifyOrderId = new Map<string, Record<string, unknown>>();
    for (const invoice of invoiceRows) {
      const sourceOrderId = String(invoice.sourceOrderId || "").trim();
      const shopifyOrderId = String(invoice.shopifyOrderId || "").trim();
      if (sourceOrderId && !invoiceByOrderImportId.has(sourceOrderId)) invoiceByOrderImportId.set(sourceOrderId, invoice);
      if (shopifyOrderId && !invoiceByShopifyOrderId.has(shopifyOrderId)) invoiceByShopifyOrderId.set(shopifyOrderId, invoice);
    }
    gstPerfLog("gst.dispatchReady.invoiceLookup", invoiceLookupStartedAtMs, { invoiceLookupMode: "bulk", orderCount: rows.length, foundCount: invoiceRows.length });

    const skuTaxMapCache = new Map<string, Awaited<ReturnType<typeof resolveSkuTaxMap>>>();
    let skuTaxMapCacheHits = 0;
    let skuTaxMapCacheMisses = 0;
    let lineCount = 0;
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
      const lineProcessingStartedAtMs = gstPerfNow();
      let mappingDurationMs = 0;
      const lineItems: Array<Record<string, unknown>> = [];
      lineCount += lines.length;
      for (const line of lines) {
        const quantity = parseNum(line.quantity);
        const unitPrice = parseNum(line.unitPrice);
        const discount = parseNum(line.discount);
        const grossAmount = round2(Math.max(0, quantity * unitPrice - discount));
        const sku = String(line.sku || "").trim();
        const storedHsnCode = String(line.mappedHsnCode || "").trim();
        const storedTaxRate = line.mappedTaxRate == null ? null : parseNum(line.mappedTaxRate);
        const hasStoredMapping = storedHsnCode && storedTaxRate !== null;
        let resolvedMap: Awaited<ReturnType<typeof resolveSkuTaxMap>> = { ok: true, data: null };
        if (!hasStoredMapping && sku) {
          const cacheKey = [String(row.shopId || ""), sku, String(line.shopifyProductId || ""), String(line.shopifyVariantId || "")].join("|");
          const cachedMap = skuTaxMapCache.get(cacheKey);
          if (cachedMap) {
            skuTaxMapCacheHits += 1;
            resolvedMap = cachedMap;
          } else {
            skuTaxMapCacheMisses += 1;
            const mappingStartedAtMs = gstPerfNow();
            resolvedMap = await resolveSkuTaxMap({ shopId: String(row.shopId || "") || null, sku, unitPrice });
            mappingDurationMs += gstPerfNow() - mappingStartedAtMs;
            skuTaxMapCache.set(cacheKey, resolvedMap);
          }
        }
        const resolvedTaxRate = resolvedMap.ok && resolvedMap.data ? parseNum(resolvedMap.data.taxRate) : null;
        lineItems.push({
          lineNumber: parseNum(line.lineNumber),
          title: String(line.title || ""),
          sku,
          quantity,
          unitPrice: round2(unitPrice),
          grossAmount,
          mappingStatus: String(line.mappingStatus || "UNMAPPED"),
          hsnCode: storedHsnCode || (resolvedMap.ok && resolvedMap.data?.hsnCode ? String(resolvedMap.data.hsnCode) : null),
          taxRate: storedTaxRate ?? resolvedTaxRate,
          taxableAmount: round2(parseNum(line.taxableAmount)),
        });
      }

      console.info("[GST PERF]", { phase: "gst.dispatchReady.skuHsnTaxMapping", durationMs: mappingDurationMs, orderImportId, lineCount: lines.length });
      gstPerfLog("gst.dispatchReady.lineProcessing", lineProcessingStartedAtMs, { orderImportId, lineCount: lines.length });

      const invoice = invoiceByOrderImportId.get(orderImportId) || invoiceByShopifyOrderId.get(String(row.shopifyOrderId || "").trim()) || null;

      // Reconciliation: the invoice GST (app HSN mapping) vs the tax actually
      // charged at checkout (Shopify orderTaxTotal). A divergence means the
      // product's app GST rate and the Shopify tax setting disagree - flag it on
      // the dashboard so a wrong rate is caught before the invoice ships.
      // Tolerance of Re. 1 covers rounding only. Null until an invoice exists.
      const taxReconciliation = invoice
        ? (() => {
            const invoiceTax = round2(
              parseNum(invoice.cgstAmount) +
                parseNum(invoice.sgstAmount) +
                parseNum(invoice.igstAmount) +
                parseNum(invoice.cessAmount),
            );
            const shopifyTax = round2(parseNum(row.orderTaxTotal));
            return { invoiceTax, shopifyTax, matches: Math.abs(invoiceTax - shopifyTax) <= 1 };
          })()
        : null;

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
        lineItems,
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
        taxReconciliation,
      });
    }

    const filteredData = data.filter((row) => {
        if (filters.invoiceStatus && String(row.invoiceStatus) !== String(filters.invoiceStatus)) return false;
        if (filters.readiness && String(row.readiness) !== String(filters.readiness)) return false;
        return true;
      });
    gstPerfLog("gst.dispatchReady.total", totalStartedAtMs, {
      rowCount: rows.length,
      returnedCount: filteredData.length,
      invoiceLookupMode: "bulk",
      skuTaxMapCacheHits,
      skuTaxMapCacheMisses,
      orderCount: rows.length,
      lineCount,
    });
    return {
      ok: true,
      data: filteredData,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to list dispatch-ready orders" };
  }
}

export async function generateInvoiceBatch(input: BatchGenerateInput) {
  const batchStartedAtMs = gstPerfNow();
  const ids = Array.from(new Set((input.orderImportIds || []).map((id) => String(id).trim()).filter(Boolean)));

  if (input.templateId) {
    const template = await getTemplateById(input.templateId);
    if (!template.ok || !template.data) {
      return { ok: false, error: "missing template" };
    }
  }
  if (!ids.length) {
    return { ok: false, error: "orderImportIds[] is required" } as const;
  }

  const summary = { generated: 0, skippedAlreadyInvoiced: 0, warningOnly: 0, failed: 0, results: [] as Array<Record<string, unknown>> };

  for (const id of ids) {
    const orderStartedAtMs = gstPerfNow();
    const order = await dispatchDb.gstOrderImport.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        gstSettings: { select: { priceIncludesTax: true } },
      },
    });

    if (!order) {
      summary.failed += 1;
      summary.results.push({ id, status: "FAILED", error: "Order import not found" });
      gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "FAILED", reason: "not_found" });
      continue;
    }
    if (input.shopId && String(order.shopId || "") !== String(input.shopId)) {
      summary.failed += 1;
      summary.results.push({ id, status: "FAILED", error: "Order does not belong to current shop context" });
      gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "FAILED", reason: "shop_mismatch" });
      continue;
    }

    const priceIncludesTax = ((order.gstSettings as { priceIncludesTax?: unknown } | null)?.priceIncludesTax ?? true) !== false;
    const readinessErrors = normalizeReadinessWarnings(order.readinessErrors, priceIncludesTax);
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
      gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "SKIPPED_ALREADY_INVOICED" });
      continue;
    }

    const snapshot = parseJson(order.snapshot);
    const shippingAddress = snapshot.shippingAddress && typeof snapshot.shippingAddress === "object" ? (snapshot.shippingAddress as Record<string, unknown>) : null;
    const customer = snapshot.customer && typeof snapshot.customer === "object" ? (snapshot.customer as Record<string, unknown>) : null;
    const skuList = extractSkuList(order.lines);
    const customerDefaultStateCode = extractCustomerDefaultStateCode(snapshot);
    const mappingStartedAtMs = gstPerfNow();
    const invoiceLines: GstDocumentLineInput[] = [];
    const lineErrors: Array<Record<string, unknown>> = [];
    for (const line of Array.isArray(order.lines) ? order.lines : []) {
      const row = line as Record<string, unknown>;
      const sku = String(row.sku || "").trim();
      const mapping = await resolveSkuTaxMap({
        shopId: String(order.shopId || "") || null,
        sku,
        unitPrice: parseNum(row.unitPrice ?? row.price),
      });
      if (!mapping.ok) {
        lineErrors.push({
          lineNumber: parseNum(row.lineNumber),
          sku: sku || null,
          error: mapping.error || `Missing GST mapping for SKU ${sku || `LINE-${String(row.lineNumber || "")}`}`,
        });
        continue;
      }
      if (!mapping.data) {
        lineErrors.push({
          lineNumber: parseNum(row.lineNumber),
          sku: sku || null,
          error: `Missing GST mapping for SKU ${sku || `LINE-${String(row.lineNumber || "")}`}`,
        });
        continue;
      }
      invoiceLines.push({
        description: sku ? `${sku} • ${String(row.title || "Item")}` : String(row.title || "Item"),
        quantity: parseNum(row.quantity),
        unitPrice: parseNum(row.unitPrice),
        taxRate: Number(mapping.data.taxRate || 0),
        cessRate: Number(mapping.data.cessRate || 0),
        hsnOrSac: mapping.data.hsnCode || undefined,
        discount: parseNum(row.discount),
      });
    }

    gstPerfLog("gst.generateInvoiceBatch.orderSkuHsnTaxMapping", mappingStartedAtMs, { orderImportId: id, lineCount: Array.isArray(order.lines) ? order.lines.length : 0, errors: lineErrors.length });

    if (lineErrors.length > 0) {
      summary.failed += 1;
      summary.results.push({
        id,
        orderName: String(order.shopifyOrderName || order.shopifyOrderId || ""),
        orderNumber: String(order.shopifyOrderName || "").replace(/^#/, ""),
        skuList,
        customerPresent: Boolean(customer || snapshot.customerName || snapshot.customerEmail || snapshot.email),
        shippingAddressPresent: Boolean(shippingAddress),
        readinessWarnings: readinessErrors,
        status: "FAILED",
        error: "Missing SKU mappings",
        lineErrors,
        invoiceGenerationErrorMessage: "Missing SKU mappings",
        invoiceGenerationStackTrace: null,
        gstDocumentCreateAttempted: false,
        gstDocumentCreateFailureReason: "Invoice draft creation skipped because SKU mappings are missing",
      });
      gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "FAILED", reason: "missing_sku_mappings" });
      continue;
    }

    const buyer = {
      legalName:
        String(snapshot.shippingAddress && typeof snapshot.shippingAddress === "object" ? (snapshot.shippingAddress as Record<string, unknown>).name || "" : "") ||
        String(snapshot.billingAddress && typeof snapshot.billingAddress === "object" ? (snapshot.billingAddress as Record<string, unknown>).name || "" : "") ||
        String(snapshot.customerName || "") ||
        "Customer",
      email:
        (snapshot.email ? String(snapshot.email) : null) ||
        (snapshot.contactEmail ? String(snapshot.contactEmail) : null) ||
        (snapshot.customer && typeof snapshot.customer === "object" && (snapshot.customer as Record<string, unknown>).email
          ? String((snapshot.customer as Record<string, unknown>).email)
          : null),
      phone:
        (snapshot.shippingAddress && typeof snapshot.shippingAddress === "object" && (snapshot.shippingAddress as Record<string, unknown>).phone
          ? String((snapshot.shippingAddress as Record<string, unknown>).phone)
          : null) ||
        (snapshot.billingAddress && typeof snapshot.billingAddress === "object" && (snapshot.billingAddress as Record<string, unknown>).phone
          ? String((snapshot.billingAddress as Record<string, unknown>).phone)
          : null) ||
        (snapshot.phone ? String(snapshot.phone) : null),
      stateCode: order.shippingStateCode || order.billingStateCode || customerDefaultStateCode ? String(order.shippingStateCode || order.billingStateCode || customerDefaultStateCode) : null,
      gstin: null,
    };
    const metadata = {
      dispatchBatch: true,
      templateId: input.templateId || null,
      gstOrderImportId: String(order.id),
      orderCreatedAt: asDate(order.orderCreatedAt)?.toISOString() || null,
      orderSnapshot: snapshot,
      orderImportId: String(order.id),
    };

    const invoice = await buildInvoiceDraft({
      shopId: String(order.shopId || "") || null,
      gstSettingsId: String(order.gstSettingsId || ""),
      sourceOrderId: String(order.id),
      sourceOrderNumber: String(order.shopifyOrderName || order.shopifyOrderId || ""),
      sourceReference: "GST_DISPATCH_BATCH",
      shopifyOrderId: String(order.shopifyOrderId || ""),
      shopifyOrderName: String(order.shopifyOrderName || ""),
      documentDate: asDate(order.orderCreatedAt)?.toISOString() || new Date().toISOString(),
      billingStateCode: order.billingStateCode ? String(order.billingStateCode) : null,
      shippingStateCode: order.shippingStateCode ? String(order.shippingStateCode) : null,
      buyer,
      currency: String(order.orderCurrency || "INR"),
      lines: invoiceLines,
      metadata,
    });

    if (!invoice.ok || !invoice.data) {
      summary.failed += 1;
      summary.results.push({
        id,
        orderName: String(order.shopifyOrderName || order.shopifyOrderId || ""),
        orderNumber: String(order.shopifyOrderName || "").replace(/^#/, ""),
        skuList,
        customerPresent: Boolean(customer || snapshot.customerName || snapshot.customerEmail || snapshot.email),
        shippingAddressPresent: Boolean(shippingAddress),
        readinessWarnings: readinessErrors,
        status: "FAILED",
        error: invoice.error || "Invoice generation failed",
        invoiceGenerationErrorMessage: invoice.error || "Invoice generation failed",
        invoiceGenerationStackTrace:
          invoice.errorDetails && typeof invoice.errorDetails.stack === "string"
            ? invoice.errorDetails.stack
            : null,
        gstDocumentCreateAttempted: Boolean(invoice.errorDetails?.gstDocumentCreateAttempted),
        gstDocumentCreateFailureReason:
          invoice.errorDetails && typeof invoice.errorDetails.gstDocumentCreateFailedReason === "string"
            ? invoice.errorDetails.gstDocumentCreateFailedReason
            : invoice.errorDetails && typeof invoice.errorDetails.phase === "string"
              ? `Failed before GstDocument.create during phase ${invoice.errorDetails.phase}`
              : "Unknown failure before GstDocument.create",
      });
      gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "FAILED", reason: "invoice_generation_failed" });
      continue;
    }

    await markOrderInvoiced({ gstOrderImportId: id, gstDocumentId: invoice.data.id });
    summary.generated += 1;
    summary.results.push({
      id,
      status: "GENERATED",
      documentId: invoice.data.id,
      documentNumber: invoice.data.documentNumber,
      placeOfSupplyStateCode: invoice.data.placeOfSupplyStateCode,
      isInterstate: invoice.data.isInterstate,
      warnings: invoice.data.warnings,
      readinessWarnings: readinessErrors,
    });
    gstPerfLog("gst.generateInvoiceBatch.order", orderStartedAtMs, { orderImportId: id, status: "GENERATED" });
  }

  gstPerfLog("gst.generateInvoiceBatch.total", batchStartedAtMs, { requestedCount: ids.length, generated: summary.generated, skippedAlreadyInvoiced: summary.skippedAlreadyInvoiced, warningOnly: summary.warningOnly, failed: summary.failed });
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
