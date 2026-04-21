import { gstDb } from "./db";
import type { GstServiceResult } from "./types";
import { importOrderByShopifyId } from "./order-import";
import { getShopifyOrdersForGstSync, getSingleShopifyOrderForGstSync } from "../shopify/admin";
import { resolveShopConfig } from "../shopify/shop-resolver";

interface SyncFilters {
  from: string | Date;
  to: string | Date;
  financialStatus?: string[];
  fulfillmentStatus?: string[];
  forceResync?: boolean;
  shopDomain?: string;
}

interface ShopifyOrderLine {
  id?: string;
  productId?: string;
  variantId?: string;
  title?: string;
  sku?: string | null;
  quantity?: number;
  price?: number;
  discount?: number;
}

interface ShopifyOrderLike {
  id?: string;
  name?: string;
  createdAt?: string;
  currency?: string;
  subtotalPrice?: number;
  totalTax?: number;
  totalPrice?: number;
  shippingStateCode?: string | null;
  billingStateCode?: string | null;
  lines?: ShopifyOrderLine[];
}

interface ImportedOrderLike {
  importStatus?: string;
  eligibilityStatus?: string;
  readinessErrors?: unknown;
  mappingCompleteness?: number;
  unmappedSkus?: unknown;
  warnings?: unknown;
}

export interface GstOrderSyncSummary {
  fetched: number;
  imported: number;
  alreadySynced: number;
  notReady: number;
  failed: number;
  warnings: string[];
  perOrder: Array<Record<string, unknown>>;
}

type SyncDbClient = {
  gstOrderImport: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
};

const syncDb = gstDb as unknown as SyncDbClient;

function parseDate(value: string | Date, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return parsed;
}

function normalizeOrderPayload(order: ShopifyOrderLike): Record<string, unknown> {
  return {
    shopifyOrderName: String(order.name || order.id || ""),
    orderCreatedAt: order.createdAt || new Date().toISOString(),
    orderCurrency: String(order.currency || "INR"),
    orderSubtotal: Number(order.subtotalPrice || 0),
    orderTaxTotal: Number(order.totalTax || 0),
    orderGrandTotal: Number(order.totalPrice || 0),
    shippingStateCode: order.shippingStateCode || null,
    billingStateCode: order.billingStateCode || null,
    lines: Array.isArray(order.lines)
      ? order.lines.map((line) => ({
          shopifyLineItemId: line.id ? String(line.id) : undefined,
          shopifyProductId: line.productId ? String(line.productId) : undefined,
          shopifyVariantId: line.variantId ? String(line.variantId) : undefined,
          title: String(line.title || "Item"),
          sku: line.sku ? String(line.sku) : null,
          quantity: Number(line.quantity || 0),
          unitPrice: Number(line.price || 0),
          discount: Number(line.discount || 0),
        }))
      : [],
  };
}

function listStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

export function deriveSyncReadinessMetrics(order: ImportedOrderLike): {
  readinessErrors: string[];
  mappingCompleteness: number;
  unmappedSkus: string[];
  warnings: string[];
  isNotReady: boolean;
} {
  const readinessErrors = listStrings(order.readinessErrors);
  const unmappedSkus = listStrings(order.unmappedSkus);
  const warnings = listStrings(order.warnings);
  const mappingCompleteness = Number(order.mappingCompleteness || 0);
  const eligibilityStatus = String(order.eligibilityStatus || "");
  const isNotReady = readinessErrors.length > 0 || eligibilityStatus === "REVIEW_REQUIRED" || eligibilityStatus === "NOT_ELIGIBLE";

  return {
    readinessErrors,
    mappingCompleteness: Number.isFinite(mappingCompleteness) ? mappingCompleteness : 0,
    unmappedSkus,
    warnings,
    isNotReady,
  };
}

export function computeSyncCountersForImportedOrder(order: ImportedOrderLike): { imported: number; notReady: number } {
  const readiness = deriveSyncReadinessMetrics(order);
  return { imported: 1, notReady: readiness.isNotReady ? 1 : 0 };
}

export async function syncOrdersByDateRange(input: SyncFilters): Promise<GstServiceResult<GstOrderSyncSummary>> {
  try {
    const from = parseDate(input.from, "from");
    const to = parseDate(input.to, "to");
    const resolvedShop = await resolveShopConfig(input.shopDomain);
    const resolvedShopId = resolvedShop.id ? String(resolvedShop.id).trim() : null;

    if (from > to) {
      return { ok: false, error: "from must be less than or equal to to" };
    }

    const shopifyOrders = await getShopifyOrdersForGstSync({
      from,
      to,
      financialStatus: input.financialStatus,
      fulfillmentStatus: input.fulfillmentStatus,
    });

    const summary: GstOrderSyncSummary = {
      fetched: shopifyOrders.length,
      imported: 0,
      alreadySynced: 0,
      notReady: 0,
      failed: 0,
      warnings: [],
      perOrder: [],
    };

    for (const order of shopifyOrders) {
      const shopifyOrderId = String(order.id || "").trim();
      const orderName = String(order.name || shopifyOrderId);
      if (!shopifyOrderId) {
        summary.failed += 1;
        summary.perOrder.push({ orderName, status: "FAILED", error: "Missing Shopify order id" });
        continue;
      }

      const existing = await syncDb.gstOrderImport.findUnique({
        where: { shopId_shopifyOrderId: { shopId: resolvedShopId, shopifyOrderId } },
        select: { id: true },
      });
      if (existing && !input.forceResync) {
        summary.alreadySynced += 1;
        summary.perOrder.push({ orderName, shopifyOrderId, status: "ALREADY_SYNCED" });
        continue;
      }

      const result = await importOrderByShopifyId(shopifyOrderId, normalizeOrderPayload(order), { shopId: resolvedShopId });
      if (!result.ok || !result.data) {
        summary.failed += 1;
        summary.perOrder.push({ orderName, shopifyOrderId, status: "FAILED", error: result.error || "Import failed" });
        continue;
      }

      const counters = computeSyncCountersForImportedOrder(result.data);
      summary.imported += counters.imported;
      summary.notReady += counters.notReady;
      const readiness = deriveSyncReadinessMetrics(result.data);

      summary.perOrder.push({
        orderName,
        shopifyOrderId,
        status: result.data.importStatus,
        eligibilityStatus: result.data.eligibilityStatus,
        mappingCompleteness: readiness.mappingCompleteness,
        readinessErrors: readiness.readinessErrors,
        unmappedSkus: readiness.unmappedSkus,
        warnings: readiness.warnings,
      });
    }

    if (summary.failed > 0) {
      summary.warnings.push(`${summary.failed} orders failed during sync`);
    }

    return { ok: true, data: summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to sync orders" };
  }
}

export async function syncSingleOrder(input: { orderName?: string; orderNumber?: string; forceResync?: boolean; shopDomain?: string }) {
  const key = String(input.orderName || input.orderNumber || "").trim();
  if (!key) {
    return { ok: false, error: "orderName or orderNumber is required" } as const;
  }

  try {
    const resolvedShop = await resolveShopConfig(input.shopDomain);
    const resolvedShopId = resolvedShop.id ? String(resolvedShop.id).trim() : null;

    const order = await getSingleShopifyOrderForGstSync(key);
    if (!order) {
      return { ok: false, error: "Order not found in Shopify" } as const;
    }
    const shopifyOrderId = String(order.id || "").trim();
    if (!shopifyOrderId) {
      return { ok: false, error: "Shopify order id missing for selected order" } as const;
    }

    const existing = await syncDb.gstOrderImport.findUnique({
      where: { shopId_shopifyOrderId: { shopId: resolvedShopId, shopifyOrderId } },
      select: { id: true },
    });
    if (existing && !input.forceResync) {
      return {
        ok: true,
        data: {
          fetched: 1,
          imported: 0,
          alreadySynced: 1,
          notReady: 0,
          failed: 0,
          warnings: [],
          perOrder: [{ orderName: order.name, shopifyOrderId, status: "ALREADY_SYNCED" }],
        } satisfies GstOrderSyncSummary,
      } as const;
    }

    const imported = await importOrderByShopifyId(shopifyOrderId, normalizeOrderPayload(order), { shopId: resolvedShopId });
    if (!imported.ok || !imported.data) {
      return { ok: false, error: imported.error || "Failed to import single order" } as const;
    }

    const readiness = deriveSyncReadinessMetrics(imported.data);
    const counters = computeSyncCountersForImportedOrder(imported.data);
    return {
      ok: true,
      data: {
        fetched: 1,
        imported: counters.imported,
        alreadySynced: 0,
        notReady: counters.notReady,
        failed: 0,
        warnings: [],
        perOrder: [{
          orderName: order.name,
          shopifyOrderId,
          status: imported.data.importStatus,
          eligibilityStatus: imported.data.eligibilityStatus,
          mappingCompleteness: readiness.mappingCompleteness,
          readinessErrors: readiness.readinessErrors,
          unmappedSkus: readiness.unmappedSkus,
          warnings: readiness.warnings,
        }],
      } satisfies GstOrderSyncSummary,
    } as const;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to sync single order" } as const;
  }
}
