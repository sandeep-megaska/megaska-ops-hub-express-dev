import { gstDb } from "./db";
import { GST_DOCUMENT_TYPES } from "./constants";
import type { GstDocumentType, GstServiceResult } from "./types";

export interface GstDocumentListFilters {
  gstSettingsId: string;
  documentType?: GstDocumentType;
  status?: string;
  search?: string;
  limit?: number;
}

export interface GstDocumentListItem {
  id: string;
  documentType: string;
  documentNumber: string;
  status: string;
  documentDate: Date;
  supplyType: string;
  placeOfSupplyStateCode: string;
  totalAmount: unknown;
  taxableAmount: unknown;
  originalDocumentId?: string | null;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeLimit(limit?: number): number {
  const parsed = Number(limit || 50);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 200);
}

export async function listGstDocuments(
  filters: GstDocumentListFilters,
): Promise<GstServiceResult<GstDocumentListItem[]>> {
  try {
    const gstSettingsId = normalize(filters.gstSettingsId);
    if (!gstSettingsId) {
      return { ok: false, error: "gstSettingsId is required to list GST documents" };
    }

    const where: Record<string, unknown> = {
      gstSettingsId,
    };

    if (filters.documentType && GST_DOCUMENT_TYPES.includes(filters.documentType)) {
      where.documentType = filters.documentType;
    }

    if (filters.status) {
      where.status = normalize(filters.status).toUpperCase();
    }

    const search = normalize(filters.search);
    if (search) {
      where.OR = [
        { documentNumber: { contains: search, mode: "insensitive" } },
        { sourceOrderId: { contains: search, mode: "insensitive" } },
        { sourceOrderNumber: { contains: search, mode: "insensitive" } },
        { sourceReference: { contains: search, mode: "insensitive" } },
      ];
    }

    const rows = await gstDb.gstDocument.findMany({
      where,
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
      take: normalizeLimit(filters.limit),
      select: {
        id: true,
        documentType: true,
        documentNumber: true,
        status: true,
        documentDate: true,
        supplyType: true,
        placeOfSupplyStateCode: true,
        totalAmount: true,
        taxableAmount: true,
        originalDocumentId: true,
      },
    });

    return { ok: true, data: rows as unknown as GstDocumentListItem[] };
  } catch (error) {
    console.error("[GST DOCUMENTS] listGstDocuments failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to list GST documents" };
  }
}

export async function getGstDocumentById(
  documentId: string,
  options: { shopId?: string } = {},
): Promise<GstServiceResult<Record<string, unknown>>> {
  try {
    const cleanedId = normalize(documentId);
    if (!cleanedId) {
      return { ok: false, error: "document id is required" };
    }

    // Tenant isolation: when a shopId is supplied the row only resolves if it
    // belongs to that shop, so a foreign document id returns "not found".
    const scopedShopId = normalize(options.shopId);
    const document = await gstDb.gstDocument.findFirst({
      where: { id: cleanedId, ...(scopedShopId ? { shopId: scopedShopId } : {}) },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        gstSettings: true,
        originalDocument: {
          select: {
            id: true,
            documentNumber: true,
            documentType: true,
            documentDate: true,
          },
        },
      },
    });

    if (!document) {
      return { ok: false, error: "GST document not found" };
    }

    return { ok: true, data: document };
  } catch (error) {
    console.error("[GST DOCUMENTS] getGstDocumentById failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to load GST document" };
  }
}
