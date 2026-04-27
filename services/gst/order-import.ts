import { gstDb } from "./db";
import { resolveLineTaxMapping } from "./product-tax-map";
import { getActiveGstSettings } from "./settings";
import { resolveGstStateCode } from "./state-codes";
import type { GstServiceResult } from "./types";
import { resolveShopConfig } from "../shopify/shop";

export interface GstOrderImportRecord {
  id: string;
  gstSettingsId: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  importStatus: string;
  eligibilityStatus: string;
  readinessErrors: string[];
  mappingCompleteness: number;
  unmappedSkus: string[];
  warnings: string[];
  orderCreatedAt: Date;
  lastSyncedAt: Date | null;
  customerName?: string | null;
  itemSummary?: string | null;
  itemCount?: number;
  skuCount?: number;
}

export interface GstOrderImportFilters {
  gstSettingsId?: string;
  importStatus?: string;
  eligibilityStatus?: string;
  from?: Date | string;
  to?: Date | string;
}

export interface SyncOrderRangeInput {
  from: Date | string;
  to: Date | string;
  gstSettingsId?: string;
}

export interface MarkOrderDocumentInput {
  gstOrderImportId: string;
  gstDocumentId: string;
}

interface ParsedOrderLine {
  lineNumber: number;
  shopifyLineItemId: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableAmount: number;
  mappedHsnCode: string | null;
  mappedTaxRate: number | null;
  mappedCessRate: number | null;
  mappingStatus: "MAPPED" | "UNMAPPED";
}

interface LineForReadiness {
  mappingStatus: string;
  sku?: string | null;
}

type OrderImportDbClient = {
  gstOrderImport: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  gstOrderImportLine: {
    createMany: (args: unknown) => Promise<{ count: number }>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  $transaction: <T>(fn: (tx: OrderImportDbClient) => Promise<T>) => Promise<T>;
};

const orderDb = gstDb as unknown as OrderImportDbClient;

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function parseDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractOrderPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as Record<string, unknown>;
}

async function mapLine(line: Record<string, unknown>, index: number, shopId?: string | null): Promise<ParsedOrderLine> {
  const quantity = parseNumber(line.quantity);
  const unitPrice = parseNumber(line.unitPrice ?? line.price);
  const discount = parseNumber(line.discount ?? 0);
  const taxableAmount = roundCurrency(Math.max(0, quantity * unitPrice - discount));

  const shopifyProductId = normalizeString(line.shopifyProductId || line.productId) || null;
  const shopifyVariantId = normalizeString(line.shopifyVariantId || line.variantId) || null;

  let mappedHsnCode: string | null = null;
  let mappedTaxRate: number | null = null;
  let mappedCessRate: number | null = null;
  let mappingStatus: "MAPPED" | "UNMAPPED" = "UNMAPPED";

  if (shopifyProductId || normalizeString(line.sku)) {
    const mapping = await resolveLineTaxMapping({ shopId, shopifyProductId, shopifyVariantId, sku: normalizeString(line.sku) || null });
    if (mapping.ok && mapping.data) {
      mappedHsnCode = normalizeString(mapping.data.hsnCode) || null;
      mappedTaxRate = Number.isFinite(mapping.data.taxRate) ? mapping.data.taxRate : null;
      mappedCessRate = Number.isFinite(mapping.data.cessRate) ? mapping.data.cessRate : null;
      mappingStatus = "MAPPED";
    }
  }

  return {
    lineNumber: index + 1,
    shopifyLineItemId: normalizeString(line.shopifyLineItemId || line.id) || null,
    shopifyProductId,
    shopifyVariantId,
    title: normalizeString(line.title) || `Line ${index + 1}`,
    sku: normalizeString(line.sku) || null,
    quantity,
    unitPrice,
    discount,
    taxableAmount,
    mappedHsnCode,
    mappedTaxRate: mappedTaxRate && mappedTaxRate > 0 ? mappedTaxRate : null,
    mappedCessRate: mappedCessRate && mappedCessRate > 0 ? mappedCessRate : null,
    mappingStatus,
  };
}

function calculateMappingCompleteness(lines: Array<{ mappingStatus: string }>): number {
  if (lines.length === 0) {
    return 0;
  }
  const mapped = lines.filter((line) => String(line.mappingStatus).toUpperCase() === "MAPPED").length;
  return Math.round((mapped / lines.length) * 10000) / 100;
}

function buildReadiness(
  order: {
    orderSubtotal: number;
    orderTaxTotal: number;
    orderGrandTotal: number;
    billingStateCode: string | null;
    shippingStateCode: string | null;
  },
  lines: ParsedOrderLine[],
  options?: { priceIncludesTax?: boolean },
): { readinessErrors: string[]; eligibilityStatus: string; importStatus: string } {
  const readinessErrors: string[] = [];
  const priceIncludesTax = options?.priceIncludesTax !== false;

  if (lines.length === 0) {
    readinessErrors.push("Order has no line items");
  }

  if (!order.shippingStateCode && !order.billingStateCode) {
    readinessErrors.push("Missing shipping/billing state for GST place of supply");
  }

  if (lines.some((line) => line.mappingStatus !== "MAPPED")) {
    readinessErrors.push("One or more line items are missing GST product tax mappings");
  }

  if (priceIncludesTax) {
    const computedLineGrossTotal = roundCurrency(
      lines.reduce((sum, line) => sum + Math.max(0, line.quantity * line.unitPrice - line.discount), 0),
    );
    if (Math.abs(computedLineGrossTotal - order.orderGrandTotal) > 0.5) {
      readinessErrors.push("Order amount sanity check failed: computed line gross total does not match grand total");
    }
  } else {
    const expectedGrandTotal = roundCurrency(order.orderSubtotal + order.orderTaxTotal);
    if (Math.abs(expectedGrandTotal - order.orderGrandTotal) > 0.5) {
      readinessErrors.push("Order amount sanity check failed: subtotal + tax does not match grand total");
    }
  }

  const hasCritical = readinessErrors.some((error) => error.includes("no line items"));
  const hasReviewOnly = readinessErrors.length > 0 && !hasCritical;

  const eligibilityStatus = hasCritical ? "NOT_ELIGIBLE" : hasReviewOnly ? "REVIEW_REQUIRED" : "ELIGIBLE";
  const importStatus = readinessErrors.length === 0 ? "INVOICE_READY" : "IMPORTED";

  return { readinessErrors, eligibilityStatus, importStatus };
}

function listStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function collectUnmappedSkus(lines: LineForReadiness[]): string[] {
  return Array.from(
    new Set(
      lines
        .filter((line) => String(line.mappingStatus || "").toUpperCase() !== "MAPPED")
        .map((line) => String(line.sku || "").trim())
        .filter(Boolean),
    ),
  );
}

function collectMissingMappingMessages(lines: LineForReadiness[]): string[] {
  return collectUnmappedSkus(lines).map((sku) => `Missing GST mapping for SKU ${sku}`);
}

function parseSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractCustomerName(snapshot: unknown): string | null {
  const parsed = parseSnapshot(snapshot);
  const customerName = normalizeString(parsed.customerName);
  return customerName || null;
}

function toOrderImportRecord(
  row: Record<string, unknown>,
  options: {
    mappingCompleteness: number;
    unmappedSkus?: string[];
    warnings?: string[];
    customerName?: string | null;
    itemSummary?: string | null;
    itemCount?: number;
    skuCount?: number;
  },
): GstOrderImportRecord {
  return {
    id: String(row.id),
    gstSettingsId: String(row.gstSettingsId),
    shopifyOrderId: String(row.shopifyOrderId),
    shopifyOrderName: String(row.shopifyOrderName),
    importStatus: String(row.importStatus),
    eligibilityStatus: String(row.eligibilityStatus),
    readinessErrors: listStrings(row.readinessErrors),
    mappingCompleteness: options.mappingCompleteness,
    unmappedSkus: options.unmappedSkus || [],
    warnings: options.warnings || [],
    orderCreatedAt: parseDate(row.orderCreatedAt),
    lastSyncedAt: row.lastSyncedAt ? parseDate(row.lastSyncedAt, new Date(0)) : null,
    customerName: options.customerName || null,
    itemSummary: options.itemSummary || null,
    itemCount: options.itemCount || 0,
    skuCount: options.skuCount || 0,
  };
}

export async function importOrderByShopifyId(
  orderId: string,
  orderPayload?: Record<string, unknown> | null,
  context?: { shopDomain?: string | null; shopId?: string | null },
): Promise<GstServiceResult<GstOrderImportRecord>> {
  const shopifyOrderId = normalizeString(orderId);
  if (!shopifyOrderId) {
    return { ok: false, error: "shopifyOrderId is required" };
  }

  const payload = extractOrderPayload(orderPayload);
  if (!payload) {
    return { ok: false, error: "order payload is required" };
  }

  try {
    const resolvedShopId = normalizeString(context?.shopId) || normalizeString((await resolveShopConfig(context?.shopDomain)).id) || null;
    const existing = await orderDb.gstOrderImport.findUnique({
      where: { shopId_shopifyOrderId: { shopId: resolvedShopId, shopifyOrderId } },
      include: { lines: true },
    });

    if (existing) {
      const existingLines = ((existing.lines as Array<Record<string, unknown>> | undefined) || []).map((line) => ({
        mappingStatus: String(line.mappingStatus || "UNMAPPED"),
        sku: line.sku == null ? null : String(line.sku),
      }));
      const mappingCompleteness = calculateMappingCompleteness(existingLines);
      const unmappedSkus = collectUnmappedSkus(existingLines);
      const updated = await orderDb.gstOrderImport.update({
        where: { id: String(existing.id) },
        data: { lastSyncedAt: new Date() },
      });
      return {
        ok: true,
        data: toOrderImportRecord(updated, {
          mappingCompleteness,
          unmappedSkus,
          warnings: collectMissingMappingMessages(existingLines),
        }),
      };
    }

    const activeSettings = await getActiveGstSettings({ shopId: resolvedShopId });
    if (!activeSettings.ok || !activeSettings.data) {
      return { ok: false, error: activeSettings.error || "No active GST settings configured" };
    }

    const rawLines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : [];
    const mappedLines: ParsedOrderLine[] = [];
    for (const [index, line] of rawLines.entries()) {
      mappedLines.push(await mapLine(line, index, resolvedShopId));
    }

    const normalizedOrder = {
      shopifyOrderName: normalizeString(payload.shopifyOrderName || payload.orderName || payload.name || shopifyOrderId),
      orderCreatedAt: parseDate(payload.orderCreatedAt || payload.createdAt),
      orderCurrency: normalizeString(payload.orderCurrency || payload.currency || activeSettings.data.defaultCurrency || "INR") || "INR",
      orderSubtotal: roundCurrency(parseNumber(payload.orderSubtotal ?? payload.subtotal ?? payload.subtotalPrice)),
      orderTaxTotal: roundCurrency(parseNumber(payload.orderTaxTotal ?? payload.taxTotal ?? payload.totalTax)),
      orderGrandTotal: roundCurrency(parseNumber(payload.orderGrandTotal ?? payload.grandTotal ?? payload.totalPrice)),
      shippingStateCode: resolveGstStateCode(normalizeString(payload.shippingStateCode || payload.shippingState)) || null,
      billingStateCode: resolveGstStateCode(normalizeString(payload.billingStateCode || payload.billingState)) || null,
    };

    const readiness = buildReadiness(normalizedOrder, mappedLines, {
      priceIncludesTax: activeSettings.data.priceIncludesTax !== false,
    });
    const mappingCompleteness = calculateMappingCompleteness(mappedLines);

    const created = await orderDb.$transaction(async (tx) => {
      const orderImport = await tx.gstOrderImport.create({
        data: {
          shopId: resolvedShopId,
          gstSettingsId: activeSettings.data?.id,
          shopifyOrderId,
          shopifyOrderName: normalizedOrder.shopifyOrderName,
          orderCreatedAt: normalizedOrder.orderCreatedAt,
          orderCurrency: normalizedOrder.orderCurrency,
          orderSubtotal: normalizedOrder.orderSubtotal,
          orderTaxTotal: normalizedOrder.orderTaxTotal,
          orderGrandTotal: normalizedOrder.orderGrandTotal,
          shippingStateCode: normalizedOrder.shippingStateCode,
          billingStateCode: normalizedOrder.billingStateCode,
          importStatus: readiness.importStatus,
          eligibilityStatus: readiness.eligibilityStatus,
          readinessErrors: readiness.readinessErrors,
          snapshot: payload,
          lastSyncedAt: new Date(),
        },
      });

      if (mappedLines.length > 0) {
        await tx.gstOrderImportLine.createMany({
          data: mappedLines.map((line) => ({
            gstOrderImportId: String(orderImport.id),
            lineNumber: line.lineNumber,
            shopifyLineItemId: line.shopifyLineItemId,
            shopifyProductId: line.shopifyProductId,
            shopifyVariantId: line.shopifyVariantId,
            title: line.title,
            sku: line.sku,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            taxableAmount: line.taxableAmount,
            mappedHsnCode: line.mappedHsnCode,
            mappedTaxRate: line.mappedTaxRate,
            mappedCessRate: line.mappedCessRate,
            mappingStatus: line.mappingStatus,
          })),
        });
      }

      return orderImport;
    });

    return {
      ok: true,
      data: toOrderImportRecord(created, {
        mappingCompleteness,
        unmappedSkus: collectUnmappedSkus(mappedLines),
        warnings: collectMissingMappingMessages(mappedLines),
      }),
    };
  } catch (error) {
    console.error("[GST ORDER IMPORT] importOrderByShopifyId failed", {
      error: error instanceof Error ? error.message : String(error),
      shopifyOrderId,
    });
    return { ok: false, error: "Failed to import order" };
  }
}

export async function syncOrderRange(_input: SyncOrderRangeInput): Promise<GstServiceResult<{ queued: boolean }>> {
  return { ok: true, data: { queued: false } };
}

export async function listImportedOrders(filters: GstOrderImportFilters): Promise<GstServiceResult<GstOrderImportRecord[]>> {
  try {
    const where: Record<string, unknown> = {};
    if (filters.gstSettingsId) {
      where.gstSettingsId = String(filters.gstSettingsId);
    }
    if (filters.importStatus) {
      where.importStatus = String(filters.importStatus);
    }
    if (filters.eligibilityStatus) {
      where.eligibilityStatus = String(filters.eligibilityStatus);
    }

    const fromDate = filters.from ? parseDate(filters.from, new Date(0)) : null;
    const toDate = filters.to ? parseDate(filters.to, new Date()) : null;
    if (fromDate || toDate) {
      where.orderCreatedAt = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };
    }

    const rows = await orderDb.gstOrderImport.findMany({
      where,
      include: {
        lines: {
          select: {
            mappingStatus: true,
            sku: true,
            title: true,
          },
        },
      },
      orderBy: [{ orderCreatedAt: "desc" }, { createdAt: "desc" }],
    });

    const data = rows.map((row) => {
      const lines = ((row.lines as Array<Record<string, unknown>> | undefined) || []).map((line) => ({
        mappingStatus: String(line.mappingStatus || "UNMAPPED"),
        sku: line.sku == null ? null : String(line.sku),
        title: normalizeString(line.title) || null,
      }));
      const unmappedSkus = collectUnmappedSkus(lines);
      const customerName = extractCustomerName(row.snapshot);
      const skuSet = new Set(lines.map((line) => String(line.sku || "").trim()).filter(Boolean));
      const lineLabels = Array.from(
        new Set(lines.map((line) => String(line.sku || line.title || "").trim()).filter(Boolean)),
      );
      const itemSummary = lineLabels.length > 0 ? lineLabels.slice(0, 3).join(", ") : null;
      return toOrderImportRecord(row, {
        mappingCompleteness: calculateMappingCompleteness(lines),
        unmappedSkus,
        warnings: collectMissingMappingMessages(lines),
        customerName,
        itemSummary,
        itemCount: lines.length,
        skuCount: skuSet.size,
      });
    });

    return { ok: true, data };
  } catch (error) {
    console.error("[GST ORDER IMPORT] listImportedOrders failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to list imported orders" };
  }
}

export async function getImportedOrderDetail(id: string): Promise<GstServiceResult<Record<string, unknown> | null>> {
  const orderImportId = normalizeString(id);
  if (!orderImportId) {
    return { ok: false, error: "Order import id is required" };
  }

  try {
    const row = await orderDb.gstOrderImport.findUnique({
      where: { id: orderImportId },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
        },
      },
    });

    if (!row) {
      return { ok: true, data: null };
    }

    const lines = ((row.lines as Array<Record<string, unknown>> | undefined) || []).map((line) => ({
      ...line,
      quantity: parseNumber(line.quantity),
      unitPrice: parseNumber(line.unitPrice),
      discount: parseNumber(line.discount),
      taxableAmount: parseNumber(line.taxableAmount),
      mappedTaxRate: line.mappedTaxRate == null ? null : parseNumber(line.mappedTaxRate),
      mappedCessRate: line.mappedCessRate == null ? null : parseNumber(line.mappedCessRate),
      mappingStatus: String(line.mappingStatus || "UNMAPPED"),
    }));

    const detail = {
      ...row,
      mappingCompleteness: calculateMappingCompleteness(lines.map((line) => ({ mappingStatus: line.mappingStatus }))),
      lines,
    };

    return { ok: true, data: detail };
  } catch (error) {
    console.error("[GST ORDER IMPORT] getImportedOrderDetail failed", {
      error: error instanceof Error ? error.message : String(error),
      orderImportId,
    });
    return { ok: false, error: "Failed to load imported order detail" };
  }
}

export async function recomputeImportedOrderMappings(options?: {
  shopId?: string | null;
}): Promise<GstServiceResult<{ ordersUpdated: number; linesUpdated: number }>> {
  try {
    const where: Record<string, unknown> = {};
    if (options?.shopId) {
      where.shopId = normalizeString(options.shopId);
    }

    const orders = await orderDb.gstOrderImport.findMany({
      where,
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
        },
        gstSettings: {
          select: { priceIncludesTax: true },
        },
      },
    });

    let linesUpdated = 0;
    let ordersUpdated = 0;

    for (const order of orders) {
      const orderLines = ((order.lines as Array<Record<string, unknown>> | undefined) || []).map((line) => ({
        id: String(line.id),
        shopifyProductId: normalizeString(line.shopifyProductId) || null,
        shopifyVariantId: normalizeString(line.shopifyVariantId) || null,
        sku: normalizeString(line.sku) || null,
      }));

      const recalculated: Array<LineForReadiness> = [];

      for (const line of orderLines) {
        const mapping = await resolveLineTaxMapping({
          shopId: normalizeString(order.shopId) || null,
          shopifyProductId: line.shopifyProductId,
          shopifyVariantId: line.shopifyVariantId,
          sku: line.sku,
        });

        const mapped = mapping.ok && mapping.data;
        await orderDb.gstOrderImportLine.update({
          where: { id: line.id },
          data: {
            mappedHsnCode: mapped ? normalizeString(mapping.data?.hsnCode) : null,
            mappedTaxRate: mapped ? mapping.data?.taxRate || 0 : null,
            mappedCessRate: mapped ? mapping.data?.cessRate || 0 : null,
            mappingStatus: mapped ? "MAPPED" : "UNMAPPED",
          },
        });
        linesUpdated += 1;
        recalculated.push({ mappingStatus: mapped ? "MAPPED" : "UNMAPPED", sku: line.sku });
      }

      const readiness = buildReadiness(
        {
          orderSubtotal: parseNumber(order.orderSubtotal),
          orderTaxTotal: parseNumber(order.orderTaxTotal),
          orderGrandTotal: parseNumber(order.orderGrandTotal),
          billingStateCode: normalizeString(order.billingStateCode) || null,
          shippingStateCode: normalizeString(order.shippingStateCode) || null,
        },
        recalculated.map((line, index) => ({
          lineNumber: index + 1,
          shopifyLineItemId: null,
          shopifyProductId: null,
          shopifyVariantId: null,
          title: "",
          sku: line.sku || null,
          quantity: 0,
          unitPrice: 0,
          discount: 0,
          taxableAmount: 0,
          mappedHsnCode: null,
          mappedTaxRate: null,
          mappedCessRate: null,
          mappingStatus: line.mappingStatus === "MAPPED" ? "MAPPED" : "UNMAPPED",
        })),
        {
          priceIncludesTax:
            ((order.gstSettings as { priceIncludesTax?: unknown } | null)?.priceIncludesTax ?? true) !== false,
        },
      );

      await orderDb.gstOrderImport.update({
        where: { id: String(order.id) },
        data: {
          importStatus: readiness.importStatus,
          eligibilityStatus: readiness.eligibilityStatus,
          readinessErrors: readiness.readinessErrors,
          lastSyncedAt: new Date(),
        },
      });
      ordersUpdated += 1;
    }

    return { ok: true, data: { ordersUpdated, linesUpdated } };
  } catch (error) {
    console.error("[GST ORDER IMPORT] recomputeImportedOrderMappings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to recompute imported order mappings" };
  }
}

export async function markOrderInvoiced(input: MarkOrderDocumentInput): Promise<GstServiceResult<{ updated: boolean }>> {
  try {
    await orderDb.gstOrderImport.update({
      where: { id: normalizeString(input.gstOrderImportId) },
      data: {
        importStatus: "INVOICED",
        lastSyncedAt: new Date(),
      },
    });

    return { ok: true, data: { updated: true } };
  } catch (error) {
    console.error("[GST ORDER IMPORT] markOrderInvoiced failed", {
      error: error instanceof Error ? error.message : String(error),
      gstOrderImportId: input.gstOrderImportId,
      gstDocumentId: input.gstDocumentId,
    });
    return { ok: false, error: "Failed to mark order invoiced" };
  }
}

export async function markOrderNoteIssued(input: MarkOrderDocumentInput): Promise<GstServiceResult<{ updated: boolean }>> {
  try {
    await orderDb.gstOrderImport.update({
      where: { id: normalizeString(input.gstOrderImportId) },
      data: {
        importStatus: "NOTE_ISSUED",
        lastSyncedAt: new Date(),
      },
    });

    return { ok: true, data: { updated: true } };
  } catch (error) {
    console.error("[GST ORDER IMPORT] markOrderNoteIssued failed", {
      error: error instanceof Error ? error.message : String(error),
      gstOrderImportId: input.gstOrderImportId,
      gstDocumentId: input.gstDocumentId,
    });
    return { ok: false, error: "Failed to mark order note issued" };
  }
}
