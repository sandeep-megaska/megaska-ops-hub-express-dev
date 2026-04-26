import { gstDb } from "./db";
import { upsertProductTaxMapping } from "./product-tax-map";
import type { GstServiceResult } from "./types";

export interface ProductTaxBulkRow {
  sku: string;
  hsnCode: string;
  slabId?: string;
  taxRate?: number;
  source?: string;
}

type ProductBulkDbClient = {
  gstOrderImportLine: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstHsnCode: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstHsnSlabMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstProductTaxMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
};

const productBulkDb = gstDb as unknown as ProductBulkDbClient;

function norm(value: unknown): string {
  return String(value || "").trim();
}

async function resolveSku(sku: string) {
  const row = await productBulkDb.gstOrderImportLine.findMany({
    where: { sku },
    select: { shopifyProductId: true, shopifyVariantId: true, title: true, sku: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  return row[0] || null;
}

async function resolveSlabId(hsnId: string, taxRate?: number): Promise<string | null> {
  if (typeof taxRate === "number" && Number.isFinite(taxRate)) {
    const rateMatch = await productBulkDb.gstHsnSlabMap.findFirst({
      where: {
        hsnId,
        slab: { taxRate },
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      select: { slabId: true },
    });
    if (rateMatch?.slabId) {
      return String(rateMatch.slabId);
    }
  }

  const map = await productBulkDb.gstHsnSlabMap.findFirst({
    where: { hsnId },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    select: { slabId: true },
  });
  return map?.slabId ? String(map.slabId) : null;
}

export async function previewBulkProductTaxMappings(rows: ProductTaxBulkRow[]): Promise<GstServiceResult<Record<string, unknown>>> {
  const normalized = (rows || []).map((row, index) => ({
    index,
    sku: norm(row.sku),
    hsnCode: norm(row.hsnCode),
    slabId: norm(row.slabId),
    taxRate: typeof row.taxRate === "number" ? row.taxRate : Number(row.taxRate),
    source: norm(row.source) || "bulk_sku",
  }));
  const seen = new Map<string, number[]>();

  normalized.forEach((row) => {
    const key = row.sku.toUpperCase();
    if (!key) return;
    seen.set(key, [...(seen.get(key) || []), row.index]);
  });

  const duplicates = Array.from(seen.entries())
    .filter(([, indexes]) => indexes.length > 1)
    .map(([sku, indexes]) => ({ sku, rowIndexes: indexes }));

  const matched: Array<Record<string, unknown>> = [];
  const unmatched: Array<Record<string, unknown>> = [];
  const invalidRows: Array<Record<string, unknown>> = [];

  for (const row of normalized) {
    if (!row.sku || !row.hsnCode) {
      invalidRows.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "sku and hsnCode are required" });
      continue;
    }

    const skuResolved = await resolveSku(row.sku);
    if (!skuResolved || !skuResolved.shopifyProductId) {
      unmatched.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "Unknown SKU" });
      continue;
    }

    const hsn = await productBulkDb.gstHsnCode.findUnique({ where: { hsnCode: row.hsnCode }, select: { id: true, hsnCode: true } });
    if (!hsn) {
      invalidRows.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "HSN code not found" });
      continue;
    }

    const slabId = row.slabId || (await resolveSlabId(String(hsn.id), Number.isFinite(row.taxRate) ? row.taxRate : undefined)) || "";
    if (!slabId) {
      invalidRows.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "No slab configured for HSN" });
      continue;
    }

    const existing = await productBulkDb.gstProductTaxMap.findFirst({
      where: {
        shopifyProductId: String(skuResolved.shopifyProductId),
        shopifyVariantId: skuResolved.shopifyVariantId ? String(skuResolved.shopifyVariantId) : null,
      },
      select: { id: true, hsnId: true, slabId: true, status: true },
    });

    matched.push({
      rowIndex: row.index,
      sku: row.sku,
      hsnCode: row.hsnCode,
      hsnId: String(hsn.id),
      slabId,
      shopifyProductId: String(skuResolved.shopifyProductId),
      shopifyVariantId: skuResolved.shopifyVariantId ? String(skuResolved.shopifyVariantId) : null,
      title: skuResolved.title ? String(skuResolved.title) : null,
      existingMappingId: existing?.id ? String(existing.id) : null,
      source: row.source,
    });
  }

  return {
    ok: true,
    data: {
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      duplicateCount: duplicates.length,
      invalidCount: invalidRows.length,
      matched,
      unmatched,
      duplicates,
      invalidRows,
    },
  };
}

export async function applyBulkProductTaxMappings(rows: ProductTaxBulkRow[]): Promise<GstServiceResult<Record<string, unknown>>> {
  const preview = await previewBulkProductTaxMappings(rows);
  if (!preview.ok || !preview.data) {
    return { ok: false, error: preview.error || "Preview failed" };
  }

  const data = preview.data;
  const matched = Array.isArray(data.matched) ? data.matched : [];
  let applied = 0;
  const failed: Array<Record<string, unknown>> = [];

  for (const row of matched) {
    const result = await upsertProductTaxMapping({
      shopifyProductId: String(row.shopifyProductId || ""),
      shopifyVariantId: row.shopifyVariantId ? String(row.shopifyVariantId) : null,
      hsnId: String(row.hsnId || ""),
      slabId: String(row.slabId || ""),
      source: String(row.source || "bulk_sku"),
      status: "ACTIVE",
      metadata: { sku: String(row.sku || ""), bulk: true },
    });

    if (!result.ok) {
      failed.push({ rowIndex: row.rowIndex, sku: row.sku, error: result.error || "Upsert failed" });
      continue;
    }

    applied += 1;
  }

  return {
    ok: true,
    data: {
      applied,
      failedCount: failed.length,
      failed,
      preview: data,
    },
  };
}

export async function exportUnmappedSkusCsv(): Promise<GstServiceResult<string>> {
  const rows = await productBulkDb.gstOrderImportLine.findMany({
    where: { sku: { not: null } },
    select: {
      sku: true,
      title: true,
      shopifyProductId: true,
      shopifyVariantId: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 5000,
  });

  const usage = new Map<string, { sku: string; title: string; count: number; lastOrderedAt: Date | null; productId: string; variantId: string }>();

  for (const row of rows) {
    const sku = norm(row.sku);
    if (!sku) continue;
    const existing = usage.get(sku) || {
      sku,
      title: norm(row.title),
      count: 0,
      lastOrderedAt: null,
      productId: norm(row.shopifyProductId),
      variantId: norm(row.shopifyVariantId),
    };

    existing.count += 1;
    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt || ""));
    if (!existing.lastOrderedAt || (!Number.isNaN(updatedAt.getTime()) && updatedAt > existing.lastOrderedAt)) {
      existing.lastOrderedAt = updatedAt;
    }

    usage.set(sku, existing);
  }

  const lines = ["SKU,product_title,variant_title,order_count,last_ordered_date,current_mapping_status"];

  for (const value of usage.values()) {
    const mapping = await productBulkDb.gstProductTaxMap.findFirst({
      where: {
        shopifyProductId: value.productId,
        shopifyVariantId: value.variantId || null,
      },
      select: { id: true },
    });

    if (mapping) continue;

    lines.push(
      [
        JSON.stringify(value.sku),
        JSON.stringify(value.title || ""),
        JSON.stringify(value.variantId || ""),
        value.count,
        value.lastOrderedAt ? value.lastOrderedAt.toISOString().slice(0, 10) : "",
        "UNMAPPED",
      ].join(",")
    );
  }

  return { ok: true, data: lines.join("\n") };
}
