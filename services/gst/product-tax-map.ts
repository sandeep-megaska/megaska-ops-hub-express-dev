import { gstDb } from "./db";
import type { GstServiceResult } from "./types";

export interface GstProductTaxMapRecord {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  hsnId: string;
  slabId: string;
  source: string;
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  lastValidatedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface GstResolvedTaxMapping {
  hsnCode: string;
  taxRate: number;
  cessRate: number;
  sourceType: "PRODUCT_VARIANT" | "PRODUCT" | "SKU" | "STYLE";
  productMapId: string | null;
  skuMapId: string | null;
}

export interface ProductTaxMappingFilters {
  status?: string;
  shopifyProductId?: string;
  shopifyVariantId?: string;
  search?: string;
}

export interface UpsertProductTaxMappingInput {
  id?: string;
  shopifyProductId: string;
  shopifyVariantId?: string | null;
  hsnId: string;
  slabId: string;
  source: string;
  status: string;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolveLineTaxMappingInput {
  shopId?: string | null;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  sku?: string | null;
}

type ProductTaxDbClient = {
  gstProductTaxMap: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstSkuTaxMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstOrderImportLine: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

const productTaxDb = gstDb as unknown as ProductTaxDbClient;

function toDate(value?: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalize(value: unknown): string {
  return String(value || "").trim();
}

export function deriveStyleCodeFromSku(sku: string | null | undefined): string | null {
  const normalizedSku = normalize(sku);
  if (!normalizedSku) {
    return null;
  }

  const segments = normalizedSku.split(/[-_\/\s]+/).filter(Boolean);
  return segments.length > 0 ? segments[0].toUpperCase() : normalizedSku.toUpperCase();
}

function toRecord(row: {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  hsnId: string;
  slabId: string;
  source: string;
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  lastValidatedAt: Date | null;
  metadata: unknown;
}): GstProductTaxMapRecord {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;

  return {
    id: row.id,
    shopifyProductId: row.shopifyProductId,
    shopifyVariantId: row.shopifyVariantId,
    hsnId: row.hsnId,
    slabId: row.slabId,
    source: row.source,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    lastValidatedAt: row.lastValidatedAt,
    metadata,
  };
}

function isActiveStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "APPROVED";
}

function buildWhere(filters: ProductTaxMappingFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    where.status = String(filters.status);
  }

  if (filters.shopifyProductId) {
    where.shopifyProductId = String(filters.shopifyProductId);
  }

  if (filters.shopifyVariantId) {
    where.shopifyVariantId = String(filters.shopifyVariantId);
  }

  if (filters.search) {
    const search = String(filters.search).trim();
    if (search) {
      where.OR = [
        { shopifyProductId: { contains: search, mode: "insensitive" } },
        { shopifyVariantId: { contains: search, mode: "insensitive" } },
        { source: { contains: search, mode: "insensitive" } },
      ];
    }
  }

  return where;
}

export async function listProductTaxMappings(filters: ProductTaxMappingFilters): Promise<GstServiceResult<GstProductTaxMapRecord[]>> {
  try {
    const rows = await productTaxDb.gstProductTaxMap.findMany({
      where: buildWhere(filters),
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return { ok: true, data: rows.map((row) => toRecord(row as never)) };
  } catch (error) {
    console.error("[GST PRODUCT TAX MAP] listProductTaxMappings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to list product tax mappings" };
  }
}

export async function upsertProductTaxMapping(input: UpsertProductTaxMappingInput): Promise<GstServiceResult<GstProductTaxMapRecord>> {
  const shopifyProductId = String(input.shopifyProductId || "").trim();
  const shopifyVariantId = input.shopifyVariantId ? String(input.shopifyVariantId).trim() : null;
  const hsnId = String(input.hsnId || "").trim();
  const slabId = String(input.slabId || "").trim();

  if (!shopifyProductId || !hsnId || !slabId) {
    return { ok: false, error: "shopifyProductId, hsnId and slabId are required" };
  }

  try {
    const effectiveFrom = toDate(input.effectiveFrom);
    const effectiveTo = toDate(input.effectiveTo);

    const payload = {
      shopifyProductId,
      shopifyVariantId,
      hsnId,
      slabId,
      source: String(input.source || "manual"),
      status: String(input.status || "ACTIVE").toUpperCase(),
      effectiveFrom,
      effectiveTo,
      metadata: input.metadata ?? null,
      lastValidatedAt: new Date(),
    };

    const row = input.id
      ? await productTaxDb.gstProductTaxMap.update({ where: { id: String(input.id) }, data: payload })
      : await productTaxDb.gstProductTaxMap.upsert({
          where: {
            shopifyProductId_shopifyVariantId: {
              shopifyProductId,
              shopifyVariantId,
            },
          },
          create: payload,
          update: payload,
        });

    return { ok: true, data: toRecord(row as never) };
  } catch (error) {
    console.error("[GST PRODUCT TAX MAP] upsertProductTaxMapping failed", {
      error: error instanceof Error ? error.message : String(error),
      shopifyProductId,
      shopifyVariantId,
    });
    return { ok: false, error: "Failed to upsert product tax mapping" };
  }
}

export async function bulkUpsertProductTaxMappings(rows: UpsertProductTaxMappingInput[]): Promise<GstServiceResult<{ processed: number }>> {
  try {
    let processed = 0;

    for (const row of rows) {
      const result = await upsertProductTaxMapping(row);
      if (!result.ok) {
        return { ok: false, error: result.error || `Failed after ${processed} rows` };
      }
      processed += 1;
    }

    return { ok: true, data: { processed } };
  } catch (error) {
    console.error("[GST PRODUCT TAX MAP] bulkUpsertProductTaxMappings failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to bulk upsert product tax mappings" };
  }
}

export async function listUnmappedProducts(filters: ProductTaxMappingFilters): Promise<GstServiceResult<Array<Record<string, unknown>>>> {
  try {
    const search = String(filters.search || "").trim().toLowerCase();
    const lines = (await productTaxDb.gstOrderImportLine.findMany({
      where: { shopifyProductId: { not: null } },
      select: {
        shopifyProductId: true,
        shopifyVariantId: true,
        title: true,
        sku: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    })) as Array<Record<string, unknown>>;

    const seen = new Set<string>();
    const unmapped: Array<Record<string, unknown>> = [];

    for (const line of lines) {
      const productId = String(line.shopifyProductId || "").trim();
      if (!productId) {
        continue;
      }
      const variantId = line.shopifyVariantId ? String(line.shopifyVariantId) : null;
      const sku = normalize(line.sku) || null;
      const key = `${productId}:${variantId || "_product"}:${sku || "_sku"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const resolved = await resolveLineTaxMapping({ shopifyProductId: productId, shopifyVariantId: variantId, sku });
      if (!resolved.ok) {
        return { ok: false, error: resolved.error || "Failed to resolve tax mapping" };
      }

      if (resolved.data) {
        continue;
      }

      const searchable = `${productId} ${variantId || ""} ${line.title || ""} ${line.sku || ""}`.toLowerCase();
      if (search && !searchable.includes(search)) {
        continue;
      }

      unmapped.push({
        shopifyProductId: productId,
        shopifyVariantId: variantId,
        title: line.title ?? null,
        sku: line.sku ?? null,
        styleCode: deriveStyleCodeFromSku(sku),
      });
    }

    return { ok: true, data: unmapped };
  } catch (error) {
    console.error("[GST PRODUCT TAX MAP] listUnmappedProducts failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to list unmapped products" };
  }
}

function toRate(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object" && "toNumber" in (value as Record<string, unknown>)) {
    const fn = (value as { toNumber: () => number }).toNumber;
    return Number(fn());
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapResolvedResponse(
  sourceType: GstResolvedTaxMapping["sourceType"],
  productMapId: string | null,
  skuMapId: string | null,
  hsnCode: unknown,
  taxRate: unknown,
  cessRate: unknown,
): GstResolvedTaxMapping {
  return {
    sourceType,
    productMapId,
    skuMapId,
    hsnCode: normalize(hsnCode),
    taxRate: toRate(taxRate),
    cessRate: toRate(cessRate),
  };
}

export async function resolveLineTaxMapping(input: ResolveLineTaxMappingInput): Promise<GstServiceResult<GstResolvedTaxMapping | null>> {
  const shopId = normalize(input.shopId) || null;
  const shopifyProductId = normalize(input.shopifyProductId) || null;
  const shopifyVariantId = normalize(input.shopifyVariantId) || null;
  const sku = normalize(input.sku) || null;
  const styleCode = deriveStyleCodeFromSku(sku);

  if (!shopifyProductId && !sku && !styleCode) {
    return { ok: false, error: "At least one identifier is required to resolve tax mapping" };
  }

  const now = new Date();
  const activeWindowFilter = {
    OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
    AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }],
  };

  try {
    if (shopifyProductId && shopifyVariantId) {
      const variantMapping = await productTaxDb.gstProductTaxMap.findFirst({
        where: {
          shopifyProductId,
          shopifyVariantId,
          ...activeWindowFilter,
        },
        include: {
          hsn: { select: { hsnCode: true } },
          slab: { select: { taxRate: true, cessRate: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });

      if (variantMapping && isActiveStatus(String(variantMapping.status || ""))) {
        return {
          ok: true,
          data: mapResolvedResponse(
            "PRODUCT_VARIANT",
            normalize(variantMapping.id) || null,
            null,
            (variantMapping.hsn as { hsnCode?: string } | undefined)?.hsnCode,
            (variantMapping.slab as { taxRate?: unknown } | undefined)?.taxRate,
            (variantMapping.slab as { cessRate?: unknown } | undefined)?.cessRate,
          ),
        };
      }
    }

    if (shopifyProductId) {
      const productMapping = await productTaxDb.gstProductTaxMap.findFirst({
        where: {
          shopifyProductId,
          shopifyVariantId: null,
          ...activeWindowFilter,
        },
        include: {
          hsn: { select: { hsnCode: true } },
          slab: { select: { taxRate: true, cessRate: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });

      if (productMapping && isActiveStatus(String(productMapping.status || ""))) {
        return {
          ok: true,
          data: mapResolvedResponse(
            "PRODUCT",
            normalize(productMapping.id) || null,
            null,
            (productMapping.hsn as { hsnCode?: string } | undefined)?.hsnCode,
            (productMapping.slab as { taxRate?: unknown } | undefined)?.taxRate,
            (productMapping.slab as { cessRate?: unknown } | undefined)?.cessRate,
          ),
        };
      }
    }

    if (sku) {
      const skuMap = await productTaxDb.gstSkuTaxMap.findFirst({
        where: {
          shopId,
          sku,
          status: "ACTIVE",
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
      if (skuMap) {
        return {
          ok: true,
          data: mapResolvedResponse("SKU", null, normalize(skuMap.id) || null, skuMap.hsnCode, skuMap.taxRate, skuMap.cessRate),
        };
      }
    }

    if (styleCode) {
      const styleMap = await productTaxDb.gstSkuTaxMap.findFirst({
        where: {
          shopId,
          styleCode,
          status: "ACTIVE",
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
      if (styleMap) {
        return {
          ok: true,
          data: mapResolvedResponse("STYLE", null, normalize(styleMap.id) || null, styleMap.hsnCode, styleMap.taxRate, styleMap.cessRate),
        };
      }
    }

    return { ok: true, data: null };
  } catch (error) {
    console.error("[GST PRODUCT TAX MAP] resolveLineTaxMapping failed", {
      error: error instanceof Error ? error.message : String(error),
      shopId,
      shopifyProductId,
      shopifyVariantId,
      sku,
      styleCode,
    });
    return { ok: false, error: "Failed to resolve line tax mapping" };
  }
}
