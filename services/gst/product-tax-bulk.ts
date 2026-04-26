import { gstDb } from "./db";
import { recomputeImportedOrderMappings } from "./order-import";
import { deriveStyleCodeFromSku } from "./product-tax-map";
import type { GstServiceResult } from "./types";

export interface ProductTaxBulkRow {
  sku: string;
  styleCode?: string;
  hsnCode: string;
  taxRate?: number;
  cessRate?: number;
  source?: string;
}

type ProductBulkDbClient = {
  gstHsnCode: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstHsnSlabMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstSkuTaxMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  gstOrderImportLine: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

const productBulkDb = gstDb as unknown as ProductBulkDbClient;

function norm(value: unknown): string {
  return String(value || "").trim();
}

function toUpperOrEmpty(value: unknown): string {
  return norm(value).toUpperCase();
}

async function resolveTaxForHsn(hsnId: string): Promise<{ taxRate: number; cessRate: number } | null> {
  const map = await productBulkDb.gstHsnSlabMap.findFirst({
    where: { hsnId },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    select: { slab: { select: { taxRate: true, cessRate: true } } },
  });

  const slab = map?.slab as { taxRate?: unknown; cessRate?: unknown } | undefined;
  if (!slab) {
    return null;
  }

  return {
    taxRate: Number(slab.taxRate),
    cessRate: Number(slab.cessRate ?? 0),
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function previewBulkProductTaxMappings(
  rows: ProductTaxBulkRow[],
  shopId?: string | null,
): Promise<GstServiceResult<Record<string, unknown>>> {
  const normalized = (rows || []).map((row, index) => ({
    index,
    sku: toUpperOrEmpty(row.sku),
    styleCode: toUpperOrEmpty(row.styleCode) || deriveStyleCodeFromSku(row.sku),
    hsnCode: norm(row.hsnCode),
    taxRate: toOptionalNumber(row.taxRate),
    cessRate: toOptionalNumber(row.cessRate),
    source: norm(row.source) || "PASTE",
  }));

  const seen = new Map<string, number[]>();
  normalized.forEach((row) => {
    const key = row.sku;
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

    const hsn = await productBulkDb.gstHsnCode.findUnique({ where: { hsnCode: row.hsnCode }, select: { id: true, hsnCode: true } });
    if (!hsn) {
      invalidRows.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "HSN code not found" });
      continue;
    }

    const resolvedTax = await resolveTaxForHsn(String(hsn.id));
    const finalTaxRate = row.taxRate ?? resolvedTax?.taxRate;
    const finalCessRate = row.cessRate ?? resolvedTax?.cessRate;

    if (!Number.isFinite(finalTaxRate) || !Number.isFinite(finalCessRate)) {
      invalidRows.push({ rowIndex: row.index, sku: row.sku, hsnCode: row.hsnCode, error: "No slab configured for HSN" });
      continue;
    }

    const existing = await productBulkDb.gstSkuTaxMap.findFirst({
      where: { shopId: shopId || null, sku: row.sku },
      select: { id: true, hsnCode: true, taxRate: true, cessRate: true, status: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    matched.push({
      rowIndex: row.index,
      sku: row.sku,
      styleCode: row.styleCode,
      hsnCode: row.hsnCode,
      taxRate: finalTaxRate,
      cessRate: finalCessRate,
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

export async function applyBulkProductTaxMappings(
  rows: ProductTaxBulkRow[],
  shopId?: string | null,
): Promise<GstServiceResult<Record<string, unknown>>> {
  const preview = await previewBulkProductTaxMappings(rows, shopId);
  if (!preview.ok || !preview.data) {
    return { ok: false, error: preview.error || "Preview failed" };
  }

  const data = preview.data;
  const matched = Array.isArray(data.matched) ? data.matched : [];
  const invalidRows = Array.isArray(data.invalidRows) ? data.invalidRows : [];
  const duplicates = Array.isArray(data.duplicates) ? data.duplicates : [];
  let applied = 0;
  const errors: string[] = [];

  for (const row of matched) {
    try {
      const existing = await productBulkDb.gstSkuTaxMap.findFirst({
        where: { shopId: shopId || null, sku: String(row.sku || "") },
        select: { id: true },
        orderBy: [{ updatedAt: "desc" }],
      });

      const payload = {
        hsnCode: String(row.hsnCode || ""),
        taxRate: Number(row.taxRate),
        cessRate: Number(row.cessRate),
        status: "ACTIVE",
        source: "PASTE",
      };

      const styleCode = toUpperOrEmpty(row.styleCode) || deriveStyleCodeFromSku(String(row.sku || ""));

      if (existing?.id) {
        await productBulkDb.gstSkuTaxMap.update({
          where: { id: String(existing.id) },
          data: { ...payload, styleCode },
        });
      } else {
        await productBulkDb.gstSkuTaxMap.create({
          data: {
            shopId: shopId || null,
            sku: String(row.sku || ""),
            styleCode,
            ...payload,
          },
        });
      }

      applied += 1;
    } catch (error) {
      errors.push(`Row ${String(row.rowIndex)} (${String(row.sku || "")}): ${error instanceof Error ? error.message : "Upsert failed"}`);
    }
  }

  for (const row of invalidRows) {
    const rowIndex = Number(row.rowIndex);
    const rowRef = Number.isFinite(rowIndex) ? rowIndex + 1 : row.rowIndex;
    errors.push(`Row ${String(rowRef)} (${String(row.sku || "")}): ${String(row.error || "Validation failed")}`);
  }

  for (const duplicate of duplicates) {
    const sku = String(duplicate.sku || "");
    const indexes = Array.isArray(duplicate.rowIndexes) ? duplicate.rowIndexes : [];
    const rowRefs = indexes
      .map((index: unknown): number => Number(index) + 1)
      .filter((value: number) => Number.isFinite(value));
    if (rowRefs.length > 1) {
      errors.push(`Duplicate SKU ${sku} in rows: ${rowRefs.join(", ")}`);
    }
  }

  const recompute = await recomputeImportedOrderMappings({ shopId: shopId || null });
  if (!recompute.ok) {
    return { ok: false, error: recompute.error || "Failed to recompute imported order mappings" };
  }

  return {
    ok: true,
    data: {
      appliedCount: applied,
      errors,
      recompute: recompute.data,
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
    const mapping = await productBulkDb.gstSkuTaxMap.findFirst({
      where: {
        sku: value.sku,
      },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }],
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
