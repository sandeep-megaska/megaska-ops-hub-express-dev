import { gstDb } from "./db";
import { deriveStyleCodeFromSku } from "./product-tax-map";
import { recomputeImportedOrderMappings } from "./order-import";
import type { GstServiceResult } from "./types";

type SkuMapDbClient = {
  gstSkuTaxMap: {
    create: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  gstOrderImportLine: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

const skuMapDb = gstDb as unknown as SkuMapDbClient;

function norm(value: unknown): string {
  return String(value || "").trim();
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

  const lines = ["sku,styleCode,sampleTitle,orderCount,lineCount,currentStatus,hsnCode,taxRate,cessRate,notes"];

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
      ].join(","),
    );
  }

  return { ok: true, data: lines.join("\n") };
}

export async function importSkuMappingsCsv(
  csvText: string,
  shopId?: string | null,
): Promise<GstServiceResult<{ imported: number; skipped: number; errors: string[] }>> {
  const rows = parseCsv(csvText);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [idx, rawRow] of rows.entries()) {
    const rowNum = idx + 2;
    const sku = norm(rawRow.sku) || null;
    const styleCode = norm(rawRow.styleCode).toUpperCase() || deriveStyleCodeFromSku(sku);
    const hsnCode = norm(rawRow.hsnCode);
    const taxRate = Number(rawRow.taxRate);
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
    if (!Number.isFinite(taxRate)) {
      skipped += 1;
      errors.push(`Row ${rowNum}: taxRate must be numeric`);
      continue;
    }
    if (!Number.isFinite(cessRate)) {
      skipped += 1;
      errors.push(`Row ${rowNum}: cessRate must be numeric`);
      continue;
    }

    const existing = await skuMapDb.gstSkuTaxMap.findFirst({
      where: sku ? { shopId: shopId || null, sku } : { shopId: shopId || null, styleCode },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }],
    });

    const payload = {
      hsnCode,
      taxRate,
      cessRate,
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
          shopId: shopId || null,
          sku,
          styleCode,
          ...payload,
        },
      },
    }

    imported += 1;
  }

  return { ok: true, data: { imported, skipped, errors } };
}

export async function importSkuMappingsAndRecompute(csvText: string, shopId?: string | null) {
  const imported = await importSkuMappingsCsv(csvText, shopId);
  if (!imported.ok || !imported.data) {
    return imported;
  }

  const recompute = await recomputeImportedOrderMappings({ shopId: shopId || null });
  if (!recompute.ok) {
    return { ok: false as const, error: recompute.error || "Failed to recompute order readiness" };
  }

  return {
    ok: true as const,
    data: {
      ...imported.data,
      recompute: recompute.data,
    },
  };
}
