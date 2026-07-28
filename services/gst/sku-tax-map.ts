import { gstDb } from "./db";
import type { GstServiceResult } from "./types";

type SkuMapDbClient = {
  gstSkuTaxMap: {
    create: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstOrderImportLine: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstHsnSlabMap: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
};

const skuMapDb = gstDb as unknown as SkuMapDbClient;

function norm(value: unknown): string {
  return String(value || "").trim();
}

/**
 * Normalise the optional price-cap slab trio. A slab exists only when a valid
 * threshold is provided; then taxRateAbove is required and cessRateAbove
 * defaults to 0. When no threshold is provided the slab is cleared (all null/0)
 * so an edit can turn a slab back into a flat rate.
 */
function parseSlabInput(input: {
  priceCapThreshold?: number | null;
  taxRateAbove?: number | null;
  cessRateAbove?: number | null;
}):
  | { ok: true; priceCapThreshold: number | null; taxRateAbove: number | null; cessRateAbove: number }
  | { ok: false; error: string } {
  const rawThreshold = input.priceCapThreshold;
  const hasThreshold =
    rawThreshold !== null && rawThreshold !== undefined && Number.isFinite(Number(rawThreshold));

  if (!hasThreshold) {
    return { ok: true, priceCapThreshold: null, taxRateAbove: null, cessRateAbove: 0 };
  }

  const threshold = Number(rawThreshold);
  if (threshold <= 0) return { ok: false, error: "priceCapThreshold must be greater than 0" };

  const aboveTax = Number(input.taxRateAbove);
  if (input.taxRateAbove === null || input.taxRateAbove === undefined || !Number.isFinite(aboveTax)) {
    return { ok: false, error: "taxRateAbove is required when priceCapThreshold is set" };
  }

  const aboveCess =
    input.cessRateAbove === null || input.cessRateAbove === undefined ? 0 : Number(input.cessRateAbove);
  if (!Number.isFinite(aboveCess)) return { ok: false, error: "cessRateAbove must be numeric" };

  return { ok: true, priceCapThreshold: threshold, taxRateAbove: aboveTax, cessRateAbove: aboveCess };
}

function deriveStyleCodeFromSku(sku: string | null | undefined): string | null {
  const normalizedSku = norm(sku);
  if (!normalizedSku) {
    return null;
  }
  const segments = normalizedSku.split(/[-_\/\s]+/).filter(Boolean);
  return segments.length > 0 ? segments[0].toUpperCase() : normalizedSku.toUpperCase();
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

export async function listSkuTaxMappings(input: { shopId?: string | null; search?: string }): Promise<GstServiceResult<Array<Record<string, unknown>>>> {
  const search = norm(input.search);
  const rows = await skuMapDb.gstSkuTaxMap.findMany({
    where: {
      shopId: input.shopId || null,
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: "insensitive" } },
              { styleCode: { contains: search, mode: "insensitive" } },
              { hsnCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 1000,
  });

  return { ok: true, data: rows };
}

export async function listUnmappedSkusFromImportedOrders(input: {
  shopId?: string | null;
  search?: string;
}): Promise<GstServiceResult<Array<Record<string, unknown>>>> {
  const where: Record<string, unknown> = { mappingStatus: "UNMAPPED" };
  if (input.shopId) {
    where.orderImport = { shopId: norm(input.shopId) };
  }

  const search = norm(input.search).toLowerCase();
  const rows = await skuMapDb.gstOrderImportLine.findMany({
    where,
    select: {
      sku: true,
      title: true,
      updatedAt: true,
      orderImport: {
        select: {
          id: true,
          shopifyOrderName: true,
        },
      },
    },
    take: 10000,
    orderBy: [{ updatedAt: "desc" }],
  });

  const usage = new Map<
    string,
    {
      sku: string;
      styleCode: string | null;
      sampleTitle: string;
      orderIds: Set<string>;
      orderNames: Set<string>;
      lineCount: number;
      lastSeenAt: string | null;
    }
  >();

  for (const row of rows) {
    const sku = norm(row.sku);
    const styleCode = deriveStyleCodeFromSku(sku);
    if (!sku && !styleCode) {
      continue;
    }

    if (search) {
      const haystack = `${sku} ${styleCode || ""} ${norm(row.title)}`.toLowerCase();
      if (!haystack.includes(search)) {
        continue;
      }
    }

    const key = `${sku || "_"}|${styleCode || "_"}`;
    const existing = usage.get(key) || {
      sku,
      styleCode,
      sampleTitle: norm(row.title),
      orderIds: new Set<string>(),
      orderNames: new Set<string>(),
      lineCount: 0,
      lastSeenAt: null,
    };
    existing.lineCount += 1;

    const orderImport = row.orderImport as { id?: unknown; shopifyOrderName?: unknown } | undefined;
    const orderId = norm(orderImport?.id);
    if (orderId) {
      existing.orderIds.add(orderId);
    }
    const orderName = norm(orderImport?.shopifyOrderName);
    if (orderName) {
      existing.orderNames.add(orderName);
    }
    if (!existing.sampleTitle) {
      existing.sampleTitle = norm(row.title);
    }

    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
    if (!existing.lastSeenAt || (updatedAt && updatedAt > existing.lastSeenAt)) {
      existing.lastSeenAt = updatedAt;
    }

    usage.set(key, existing);
  }

  const data: Array<Record<string, unknown>> = [];
  for (const item of usage.values()) {
    const mapping = await resolveSkuTaxMap({ shopId: input.shopId || null, sku: item.sku });
    if (mapping.ok && mapping.data) {
      continue;
    }

    data.push({
      sku: item.sku,
      styleCode: item.styleCode,
      sampleTitle: item.sampleTitle,
      orderCount: item.orderIds.size,
      lineCount: item.lineCount,
      sampleOrders: Array.from(item.orderNames).slice(0, 5),
      lastSeenAt: item.lastSeenAt,
    });
  }

  data.sort((a, b) => Number(b.lineCount || 0) - Number(a.lineCount || 0));
  return { ok: true, data };
}

/**
 * Select the effective tax/cess for a SKU mapping row given the line's per-unit
 * price. When the row defines a price-cap slab (priceCapThreshold + taxRateAbove)
 * and the unit price is strictly above the threshold, the "above" rates apply;
 * at or below the threshold - and whenever no slab is defined or no price is
 * available - the base taxRate/cessRate apply. Kept as a pure, exported helper so
 * both resolveSkuTaxMap and resolveLineTaxMapping select the band identically.
 */
export function selectSkuBandRate(
  row: Record<string, unknown>,
  unitPrice?: number | null,
): { taxRate: number; cessRate: number; appliedBand: "BASE" | "ABOVE" } {
  const baseTaxRate = Number(row.taxRate) || 0;
  const baseCessRate = Number(row.cessRate) || 0;

  const threshold = row.priceCapThreshold == null ? null : Number(row.priceCapThreshold);
  const aboveTaxRate = row.taxRateAbove == null ? null : Number(row.taxRateAbove);

  const hasSlab =
    threshold != null &&
    Number.isFinite(threshold) &&
    aboveTaxRate != null &&
    Number.isFinite(aboveTaxRate);
  const price = unitPrice == null ? null : Number(unitPrice);
  const hasComparablePrice = price != null && Number.isFinite(price);

  if (hasSlab && hasComparablePrice && (price as number) > (threshold as number)) {
    const aboveCessRate = row.cessRateAbove == null ? 0 : Number(row.cessRateAbove);
    return {
      taxRate: aboveTaxRate as number,
      cessRate: Number.isFinite(aboveCessRate) ? aboveCessRate : 0,
      appliedBand: "ABOVE",
    };
  }

  return { taxRate: baseTaxRate, cessRate: baseCessRate, appliedBand: "BASE" };
}

function toMapResult(row: Record<string, unknown>, source: "SKU" | "STYLE", unitPrice?: number | null) {
  const band = selectSkuBandRate(row, unitPrice);
  return {
    hsnCode: norm(row.hsnCode),
    taxRate: band.taxRate,
    cessRate: band.cessRate,
    source,
  };
}

export async function resolveSkuTaxMap(input: {
  shopId?: string | null;
  sku?: string | null;
  unitPrice?: number | null;
}): Promise<GstServiceResult<{ hsnCode: string; taxRate: number; cessRate: number; source: "SKU" | "STYLE" } | null>> {
  const sku = norm(input.sku);
  if (!sku) {
    return { ok: true, data: null };
  }

  const shopId = input.shopId || null;

  const exactSku = await skuMapDb.gstSkuTaxMap.findFirst({
    where: { shopId, sku, status: "ACTIVE" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (exactSku) {
    return { ok: true, data: toMapResult(exactSku, "SKU", input.unitPrice) };
  }

  const styleCode = deriveStyleCodeFromSku(sku);
  if (!styleCode) {
    return { ok: true, data: null };
  }

  const style = await skuMapDb.gstSkuTaxMap.findFirst({
    where: { shopId, styleCode, status: "ACTIVE" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (style) {
    return { ok: true, data: toMapResult(style, "STYLE", input.unitPrice) };
  }

  return { ok: true, data: null };
}

export async function upsertSkuTaxMapping(input: {
  shopId?: string | null;
  sku?: string | null;
  styleCode?: string | null;
  hsnCode: string;
  taxRate: number;
  cessRate?: number;
  priceCapThreshold?: number | null;
  taxRateAbove?: number | null;
  cessRateAbove?: number | null;
  source?: string;
}): Promise<GstServiceResult<Record<string, unknown>>> {
  const sku = norm(input.sku) || null;
  const styleCode = norm(input.styleCode).toUpperCase() || deriveStyleCodeFromSku(sku);
  const hsnCode = norm(input.hsnCode);
  const taxRate = Number(input.taxRate);
  const cessRate = input.cessRate === undefined ? 0 : Number(input.cessRate);

  if (!sku && !styleCode) return { ok: false, error: "sku or styleCode is required" };
  if (!hsnCode) return { ok: false, error: "hsnCode is required" };
  if (!Number.isFinite(taxRate)) return { ok: false, error: "taxRate must be numeric" };
  if (!Number.isFinite(cessRate)) return { ok: false, error: "cessRate must be numeric" };

  const slab = parseSlabInput(input);
  if (!slab.ok) return { ok: false, error: slab.error };

  // Every GST row must be shop-scoped (multi-tenant integrity). Reject rather
  // than persist a null-shop mapping that would leak across tenants.
  const shopId = norm(input.shopId);
  if (!shopId) return { ok: false, error: "A resolved shop is required to save a SKU mapping" };

  const existing = await skuMapDb.gstSkuTaxMap.findFirst({
    where: sku ? { shopId, sku } : { shopId, styleCode },
    select: { id: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  const payload = {
    hsnCode,
    taxRate,
    cessRate,
    priceCapThreshold: slab.priceCapThreshold,
    taxRateAbove: slab.taxRateAbove,
    cessRateAbove: slab.cessRateAbove,
    status: "ACTIVE",
    source: norm(input.source) || "MANUAL_UI",
  };

  const record = existing?.id
    ? await skuMapDb.gstSkuTaxMap.update({
        where: { id: String(existing.id) },
        data: payload,
      })
    : await skuMapDb.gstSkuTaxMap.create({
        data: {
          shopId,
          sku,
          styleCode,
          ...payload,
        },
      });

  return { ok: true, data: record };
}

export async function exportUnmappedSkuMappingsCsv(shopId?: string | null): Promise<GstServiceResult<string>> {
  const where: Record<string, unknown> = { mappingStatus: "UNMAPPED" };
  if (shopId) {
    where.orderImport = { shopId: norm(shopId) };
  }

  const rows = await skuMapDb.gstOrderImportLine.findMany({
    where,
    select: {
      sku: true,
      title: true,
      mappingStatus: true,
      orderImport: {
        select: {
          id: true,
        },
      },
    },
    take: 10000,
    orderBy: [{ updatedAt: "desc" }],
  });

  const usage = new Map<string, { sku: string; styleCode: string | null; sampleTitle: string; orderIds: Set<string>; lineCount: number }>();

  for (const row of rows) {
    const sku = norm(row.sku);
    const styleCode = deriveStyleCodeFromSku(sku);
    if (!sku && !styleCode) {
      continue;
    }

    const key = `${sku || "_"}|${styleCode || "_"}`;
    const existing = usage.get(key) || {
      sku,
      styleCode,
      sampleTitle: norm(row.title),
      orderIds: new Set<string>(),
      lineCount: 0,
    };
    existing.lineCount += 1;
    const orderId = norm((row.orderImport as { id?: string } | undefined)?.id);
    if (orderId) {
      existing.orderIds.add(orderId);
    }
    if (!existing.sampleTitle) {
      existing.sampleTitle = norm(row.title);
    }
    usage.set(key, existing);
  }

  const lines = [
    "sku,styleCode,sampleTitle,orderCount,lineCount,currentStatus,hsnCode,taxRate,cessRate,priceCapThreshold,taxRateAbove,cessRateAbove,notes",
  ];

  for (const value of usage.values()) {
    lines.push(
      [
        csvEscape(value.sku),
        csvEscape(value.styleCode || ""),
        csvEscape(value.sampleTitle),
        value.orderIds.size,
        value.lineCount,
        "UNMAPPED",
        "",
        "",
        "0",
        "",
        "",
        "0",
        "",
      ].join(","),
    );
  }

  return { ok: true, data: lines.join("\n") };
}

export async function importSkuMappingsCsv(
  csvText: string,
  shopId?: string | null,
): Promise<GstServiceResult<{ imported: number; skipped: number; errors: string[] }>> {
  const resolvedShopId = norm(shopId);
  if (!resolvedShopId) {
    return { ok: false, error: "A resolved shop is required to import SKU mappings" };
  }

  const rows = parseCsv(csvText);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [idx, rawRow] of rows.entries()) {
    const rowNum = idx + 2;
    const sku = norm(rawRow.sku) || null;
    const styleCode = norm(rawRow.styleCode).toUpperCase() || deriveStyleCodeFromSku(sku);
    const hsnCode = norm(rawRow.hsnCode);
    const parsedTaxRate = rawRow.taxRate === undefined || rawRow.taxRate === "" ? null : Number(rawRow.taxRate);
    const cessRate = rawRow.cessRate === undefined || rawRow.cessRate === "" ? 0 : Number(rawRow.cessRate);

    if (!sku && !styleCode) {
      skipped += 1;
      errors.push(`Row ${rowNum}: sku or styleCode is required`);
      continue;
    }
    if (!hsnCode) {
      skipped += 1;
      errors.push(`Row ${rowNum}: hsnCode is required`);
      continue;
    }
    if (parsedTaxRate !== null && !Number.isFinite(parsedTaxRate)) {
      skipped += 1;
      errors.push(`Row ${rowNum}: taxRate must be numeric`);
      continue;
    }
    if (!Number.isFinite(cessRate)) {
      skipped += 1;
      errors.push(`Row ${rowNum}: cessRate must be numeric`);
      continue;
    }

    const slab = parseSlabInput({
      priceCapThreshold:
        rawRow.priceCapThreshold === undefined || rawRow.priceCapThreshold === ""
          ? null
          : Number(rawRow.priceCapThreshold),
      taxRateAbove:
        rawRow.taxRateAbove === undefined || rawRow.taxRateAbove === "" ? null : Number(rawRow.taxRateAbove),
      cessRateAbove:
        rawRow.cessRateAbove === undefined || rawRow.cessRateAbove === "" ? 0 : Number(rawRow.cessRateAbove),
    });
    if (!slab.ok) {
      skipped += 1;
      errors.push(`Row ${rowNum}: ${slab.error}`);
      continue;
    }
    let taxRate = parsedTaxRate;
    if (taxRate === null) {
      const defaultSlab = await skuMapDb.gstHsnSlabMap.findFirst({
        where: { hsn: { hsnCode } },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        select: {
          slab: {
            select: {
              taxRate: true,
            },
          },
        },
      });

      const resolvedTaxRate = Number((defaultSlab as { slab?: { taxRate?: unknown } } | null)?.slab?.taxRate);
      if (!Number.isFinite(resolvedTaxRate)) {
        skipped += 1;
        errors.push(`Row ${rowNum}: taxRate is required when no default slab can be resolved for hsnCode ${hsnCode}`);
        continue;
      }
      taxRate = resolvedTaxRate;
    }

    const existing = await skuMapDb.gstSkuTaxMap.findFirst({
      where: sku ? { shopId: resolvedShopId, sku } : { shopId: resolvedShopId, styleCode },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    const payload = {
      hsnCode,
      taxRate,
      cessRate,
      priceCapThreshold: slab.priceCapThreshold,
      taxRateAbove: slab.taxRateAbove,
      cessRateAbove: slab.cessRateAbove,
      status: "ACTIVE",
      source: "BULK_CSV",
    };

    if (existing?.id) {
      await skuMapDb.gstSkuTaxMap.update({
        where: { id: String(existing.id) },
        data: payload,
      });
    } else {
      await skuMapDb.gstSkuTaxMap.create({
        data: {
          shopId: resolvedShopId,
          sku,
          styleCode,
          ...payload,
        },
      });
    }

    imported += 1;
  }

  return { ok: true, data: { imported, skipped, errors } };
}
