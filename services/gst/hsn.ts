import { gstDb } from "./db";
import type { GstServiceResult } from "./types";

export interface GstHsnCodeRecord {
  id: string;
  hsnCode: string;
  description: string;
  isService: boolean;
  isActive: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface GstTaxSlabRecord {
  id: string;
  slabCode: string;
  taxRate: number;
  cessRate: number;
  isActive: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export interface UpsertHsnCodeInput {
  id?: string;
  hsnCode: string;
  description: string;
  isService?: boolean;
  isActive?: boolean;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpsertTaxSlabInput {
  id?: string;
  slabCode: string;
  taxRate: number;
  cessRate?: number;
  isActive?: boolean;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
}

export interface AssignSlabToHsnInput {
  hsnId: string;
  slabId: string;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
  priority?: number;
}

export interface GstHsnSlabMapRecord {
  id: string;
  hsnId: string;
  slabId: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  hsnCode?: string;
  slabCode?: string;
  taxRate?: number;
  cessRate?: number;
}

type HsnDbClient = {
  gstHsnCode: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
    delete: (args: unknown) => Promise<{ id: string }>;
  };
  gstTaxSlab: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
    delete: (args: unknown) => Promise<{ id: string }>;
  };
  gstHsnSlabMap: {
    findFirst: (args: unknown) => Promise<{ id: string } | (Record<string, unknown> & { slab: Record<string, unknown> }) | null>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

const hsnDb = gstDb as unknown as HsnDbClient;

function toDate(value?: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toHsnRecord(row: {
  id: string;
  hsnCode: string;
  description: string;
  isService: boolean;
  isActive: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  metadata: unknown;
}): GstHsnCodeRecord {
  const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;

  return {
    id: row.id,
    hsnCode: row.hsnCode,
    description: row.description,
    isService: row.isService,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    metadata,
  };
}

function toTaxSlabRecord(row: {
  id: string;
  slabCode: string;
  taxRate: { toNumber: () => number } | number;
  cessRate: { toNumber: () => number } | number;
  isActive: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}): GstTaxSlabRecord {
  const taxRate = typeof row.taxRate === "number" ? row.taxRate : row.taxRate.toNumber();
  const cessRate = typeof row.cessRate === "number" ? row.cessRate : row.cessRate.toNumber();

  return {
    id: row.id,
    slabCode: row.slabCode,
    taxRate,
    cessRate,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}


function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
    return ((value as { toNumber: () => number }).toNumber());
  }

  const casted = Number(value);
  return Number.isFinite(casted) ? casted : undefined;
}

function toHsnSlabMapRecord(row: Record<string, unknown>): GstHsnSlabMapRecord {
  const hsn = row.hsn && typeof row.hsn === "object" ? (row.hsn as Record<string, unknown>) : null;
  const slab = row.slab && typeof row.slab === "object" ? (row.slab as Record<string, unknown>) : null;

  return {
    id: String(row.id || ""),
    hsnId: String(row.hsnId || ""),
    slabId: String(row.slabId || ""),
    effectiveFrom: row.effectiveFrom instanceof Date ? row.effectiveFrom : null,
    effectiveTo: row.effectiveTo instanceof Date ? row.effectiveTo : null,
    priority: Number(row.priority || 0),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(0),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(0),
    hsnCode: hsn?.hsnCode ? String(hsn.hsnCode) : undefined,
    slabCode: slab?.slabCode ? String(slab.slabCode) : undefined,
    taxRate: toNumber(slab?.taxRate),
    cessRate: toNumber(slab?.cessRate),
  };
}

export async function listHsnSlabMaps(): Promise<GstServiceResult<GstHsnSlabMapRecord[]>> {
  try {
    const rows = await hsnDb.gstHsnSlabMap.findMany({
      include: {
        hsn: { select: { hsnCode: true } },
        slab: { select: { slabCode: true, taxRate: true, cessRate: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    return { ok: true, data: rows.map((row) => toHsnSlabMapRecord(row)) };
  } catch (error) {
    console.error("[GST HSN] listHsnSlabMaps failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to list GST HSN slab maps" };
  }
}

export async function listHsnCodes(): Promise<GstServiceResult<GstHsnCodeRecord[]>> {
  try {
    const rows = await hsnDb.gstHsnCode.findMany({ orderBy: [{ hsnCode: "asc" }] });
    return { ok: true, data: rows.map((row) => toHsnRecord(row as never)) };
  } catch (error) {
    console.error("[GST HSN] listHsnCodes failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to list HSN codes" };
  }
}

export async function upsertHsnCode(input: UpsertHsnCodeInput): Promise<GstServiceResult<GstHsnCodeRecord>> {
  const hsnCode = String(input.hsnCode || "").trim();
  const description = String(input.description || "").trim();
  if (!hsnCode || !description) {
    return { ok: false, error: "hsnCode and description are required" };
  }

  try {
    const effectiveFrom = toDate(input.effectiveFrom);
    const effectiveTo = toDate(input.effectiveTo);

    const row = input.id
      ? await hsnDb.gstHsnCode.update({
          where: { id: String(input.id) },
          data: {
            hsnCode,
            description,
            isService: Boolean(input.isService),
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
            metadata: input.metadata ?? null,
          },
        })
      : await hsnDb.gstHsnCode.upsert({
          where: { hsnCode },
          create: {
            hsnCode,
            description,
            isService: Boolean(input.isService),
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
            metadata: input.metadata ?? null,
          },
          update: {
            description,
            isService: Boolean(input.isService),
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
            metadata: input.metadata ?? null,
          },
        });

    return { ok: true, data: toHsnRecord(row as never) };
  } catch (error) {
    console.error("[GST HSN] upsertHsnCode failed", { error: error instanceof Error ? error.message : String(error), hsnCode });
    return { ok: false, error: "Failed to upsert HSN code" };
  }
}

export async function deleteHsnCode(id: string): Promise<GstServiceResult<{ id: string }>> {
  try {
    const deleted = await hsnDb.gstHsnCode.delete({ where: { id: String(id) }, select: { id: true } });
    return { ok: true, data: { id: deleted.id } };
  } catch (error) {
    console.error("[GST HSN] deleteHsnCode failed", { error: error instanceof Error ? error.message : String(error), id });
    return { ok: false, error: "Failed to delete HSN code" };
  }
}

export async function listTaxSlabs(): Promise<GstServiceResult<GstTaxSlabRecord[]>> {
  try {
    const rows = await hsnDb.gstTaxSlab.findMany({ orderBy: [{ taxRate: "asc" }, { slabCode: "asc" }] });
    return { ok: true, data: rows.map((row) => toTaxSlabRecord(row as never)) };
  } catch (error) {
    console.error("[GST HSN] listTaxSlabs failed", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "Failed to list GST slabs" };
  }
}

export async function upsertTaxSlab(input: UpsertTaxSlabInput): Promise<GstServiceResult<GstTaxSlabRecord>> {
  const slabCode = String(input.slabCode || "").trim().toUpperCase();
  if (!slabCode || Number.isNaN(Number(input.taxRate))) {
    return { ok: false, error: "slabCode and taxRate are required" };
  }

  try {
    const effectiveFrom = toDate(input.effectiveFrom);
    const effectiveTo = toDate(input.effectiveTo);
    const taxRate = Number(input.taxRate);
    const cessRate = Number(input.cessRate ?? 0);

    const row = input.id
      ? await hsnDb.gstTaxSlab.update({
          where: { id: String(input.id) },
          data: {
            slabCode,
            taxRate,
            cessRate,
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
          },
        })
      : await hsnDb.gstTaxSlab.upsert({
          where: { slabCode },
          create: {
            slabCode,
            taxRate,
            cessRate,
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
          },
          update: {
            taxRate,
            cessRate,
            isActive: input.isActive ?? true,
            effectiveFrom,
            effectiveTo,
          },
        });

    return { ok: true, data: toTaxSlabRecord(row as never) };
  } catch (error) {
    console.error("[GST HSN] upsertTaxSlab failed", { error: error instanceof Error ? error.message : String(error), slabCode });
    return { ok: false, error: "Failed to upsert GST slab" };
  }
}

export async function deleteTaxSlab(id: string): Promise<GstServiceResult<{ id: string }>> {
  try {
    const deleted = await hsnDb.gstTaxSlab.delete({ where: { id: String(id) }, select: { id: true } });
    return { ok: true, data: { id: deleted.id } };
  } catch (error) {
    console.error("[GST HSN] deleteTaxSlab failed", { error: error instanceof Error ? error.message : String(error), id });
    return { ok: false, error: "Failed to delete GST slab" };
  }
}

export async function assignSlabToHsn(input: AssignSlabToHsnInput): Promise<GstServiceResult<{ id: string }>> {
  const hsnId = String(input.hsnId || "").trim();
  const slabId = String(input.slabId || "").trim();
  if (!hsnId || !slabId) {
    return { ok: false, error: "hsnId and slabId are required" };
  }

  try {
    const effectiveFrom = toDate(input.effectiveFrom);
    const effectiveTo = toDate(input.effectiveTo);

    const row = await hsnDb.gstHsnSlabMap.create({
      data: {
        hsnId,
        slabId,
        effectiveFrom,
        effectiveTo,
        priority: Number(input.priority ?? 0),
      },
      select: { id: true },
    });

    return { ok: true, data: { id: row.id } };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "P2002") {
      return { ok: false, error: "HSN slab assignment already exists for the selected effective dates" };
    }

    console.error("[GST HSN] assignSlabToHsn failed", {
      error: error instanceof Error ? error.message : String(error),
      hsnId: input.hsnId,
      slabId: input.slabId,
    });
    return { ok: false, error: "Failed to assign slab to HSN" };
  }
}

export async function resolveApplicableSlab(hsnCode: string, asOfDate?: Date): Promise<GstServiceResult<GstTaxSlabRecord | null>> {
  const normalizedHsnCode = String(hsnCode || "").trim();
  if (!normalizedHsnCode) {
    return { ok: false, error: "hsnCode is required" };
  }

  const refDate = asOfDate ?? new Date();

  try {
    const map = (await hsnDb.gstHsnSlabMap.findFirst({
      where: {
        hsn: {
          hsnCode: normalizedHsnCode,
          isActive: true,
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: refDate } }],
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: refDate } }] }],
        },
        slab: {
          isActive: true,
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: refDate } }],
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: refDate } }] }],
        },
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: refDate } }],
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: refDate } }] }],
      },
      include: { slab: true },
      orderBy: [{ priority: "desc" }, { effectiveFrom: "desc" }, { updatedAt: "desc" }],
    })) as ({ slab: Record<string, unknown> } & Record<string, unknown>) | null;

    if (!map) {
      return { ok: true, data: null };
    }

    return { ok: true, data: toTaxSlabRecord(map.slab as never) };
  } catch (error) {
    console.error("[GST HSN] resolveApplicableSlab failed", {
      error: error instanceof Error ? error.message : String(error),
      hsnCode: normalizedHsnCode,
    });
    return { ok: false, error: "Failed to resolve slab for HSN" };
  }
}
