import { Prisma } from "../../generated/prisma";
import { writeGstAuditLog } from "./audit";
import { GST_DEFAULT_DOCUMENT_STATUS } from "./constants";
import { classifySupply } from "./classifier";
import { gstDb } from "./db";
import { reserveGstNumber } from "./numbering";
import { getActiveGstSettings, getGstSettingsById } from "./settings";
import { computeTotals, round2 } from "./tax-engine";
import {
  generateUuid,
  persistGstDocumentWithLines,
  type NormalizedGstDocument,
} from "./document-persistence";
import type { GstDocumentLineInput, GstNoteDraftInput, GstServiceResult } from "./types";
import { validateDocumentDraftPayload } from "./validation";

export interface GstNoteDraftResult {
  id: string;
  documentType: "CREDIT_NOTE" | "DEBIT_NOTE";
  documentNumber: string;
  originalDocumentId?: string;
  status: typeof GST_DEFAULT_DOCUMENT_STATUS;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeDate(value: Date | string | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isCompatibleNoteType(noteType: "CREDIT_NOTE" | "DEBIT_NOTE", originalDocumentType: string): boolean {
  return (
    originalDocumentType === "TAX_INVOICE" ||
    (noteType === "CREDIT_NOTE" && originalDocumentType === "DEBIT_NOTE") ||
    (noteType === "DEBIT_NOTE" && originalDocumentType === "CREDIT_NOTE")
  );
}

/**
 * Rebuild note line inputs from a referenced original document's stored lines so
 * a full-reversal note inherits the exact rates the invoice resolved (including
 * price-cap slabs), rather than trusting rates re-typed by the caller.
 */
function deriveLinesFromOriginal(lines: Array<Record<string, unknown>>): GstDocumentLineInput[] {
  return lines.map((line) => {
    const taxable = Number(line.taxableAmount ?? 0);
    const cess = Number(line.cessAmount ?? 0);
    const cessRate = taxable > 0 ? round2((cess / taxable) * 100) : 0;
    return {
      description: normalize(line.description),
      quantity: Number(line.quantity ?? 0),
      unitPrice: Number(line.unitPrice ?? 0),
      taxRate: Number(line.taxRate ?? 0),
      cessRate,
      hsnOrSac: line.hsnOrSac ? String(line.hsnOrSac) : undefined,
      unit: line.unit ? String(line.unit) : undefined,
      discount: Number(line.discount ?? 0),
    };
  });
}

export async function buildNoteDraft(input: GstNoteDraftInput): Promise<GstServiceResult<GstNoteDraftResult>> {
  try {
    // Resolve settings first: they carry the authoritative shopId and the
    // price-inclusive-vs-exclusive flag that the tax math must honour.
    const requestedShopId = normalize(input.shopId) || null;
    const settingsResult = input.gstSettingsId
      ? await getGstSettingsById(input.gstSettingsId)
      : await getActiveGstSettings({ shopId: requestedShopId });
    if (!settingsResult.ok || !settingsResult.data) {
      return {
        ok: false,
        error: settingsResult.error || "Unable to resolve GST settings (provide shopId or gstSettingsId)",
      };
    }
    const settings = settingsResult.data;

    // Load the referenced original document (invoice OR note), with its lines.
    let originalDocument:
      | (Record<string, unknown> & { lines: Array<Record<string, unknown>> })
      | null = null;
    if (input.originalDocumentId) {
      const original = (await gstDb.gstDocument.findUnique({
        where: { id: String(input.originalDocumentId).trim() },
        include: { lines: { orderBy: { lineNumber: "asc" } } },
      })) as (Record<string, unknown> & { lines: Array<Record<string, unknown>> }) | null;

      if (!original) {
        return { ok: false, error: "Original GST document not found" };
      }
      if (!isCompatibleNoteType(input.noteType, String(original.documentType || ""))) {
        return { ok: false, error: "Invalid noteType for referenced original document type" };
      }
      // Multi-tenant integrity: a note may never reference another shop's document.
      if (normalize(original.shopId) && normalize(original.shopId) !== normalize(settings.shopId)) {
        return { ok: false, error: "Original GST document belongs to a different shop" };
      }
      originalDocument = original;
    }

    // Effective note lines: caller-supplied (e.g. a partial return) take
    // precedence; otherwise fall back to a full reversal of the original.
    const effectiveLines: GstDocumentLineInput[] =
      Array.isArray(input.lines) && input.lines.length > 0
        ? input.lines
        : originalDocument
          ? deriveLinesFromOriginal(originalDocument.lines)
          : [];

    if (effectiveLines.length === 0) {
      return {
        ok: false,
        error: "GST note requires line items, or an original document to reverse",
      };
    }

    const payloadValidation = validateDocumentDraftPayload({ ...input, lines: effectiveLines });
    if (!payloadValidation.ok || !payloadValidation.data) {
      return { ok: false, error: payloadValidation.error || "Invalid GST note draft payload" };
    }
    const payloadData = payloadValidation.data;

    // Supply classification: inherit from the original when present so the note's
    // CGST/SGST-vs-IGST split always matches the document it adjusts.
    let supplyType: string;
    let placeOfSupply: string;
    let isInterstate: boolean;
    if (originalDocument) {
      supplyType = String(originalDocument.supplyType || "");
      placeOfSupply = String(originalDocument.placeOfSupplyStateCode || "");
      isInterstate = Boolean(originalDocument.isInterstate);
    } else {
      const classification = classifySupply({
        sellerStateCode: settings.stateCode,
        billingStateCode: payloadData.normalizedBillingStateCode,
        shippingStateCode: payloadData.normalizedShippingStateCode,
        buyerStateCode: payloadData.normalizedBuyerStateCode,
        placeOfSupplyStateCode: payloadData.normalizedPlaceOfSupplyStateCode,
        buyerGstin: payloadData.normalizedBuyerGstin,
        explicitSupplyType: input.supplyType,
      });
      if (!classification.ok || !classification.data) {
        return { ok: false, error: classification.error || "GST note classification failed" };
      }
      supplyType = classification.data.supplyType;
      placeOfSupply = classification.data.placeOfSupplyStateCode;
      isInterstate = classification.data.isInterstate;
    }

    // Tax math: use the SAME options as the invoice path (price-inclusive flag +
    // per-line cess) so a note never diverges from the invoice it reverses.
    const tax = computeTotals(effectiveLines, isInterstate, {
      priceIncludesTax: settings.priceIncludesTax !== false,
      cessRates: effectiveLines.map((line) => Number(line.cessRate || 0)),
    });
    if (!tax.ok || !tax.data) {
      return { ok: false, error: tax.error || "GST note tax computation failed" };
    }
    const taxData = tax.data;

    const documentDate = normalizeDate(input.documentDate);
    const numbering = await reserveGstNumber({
      gstSettingsId: settings.id,
      documentType: input.noteType,
      documentDate,
    });
    if (!numbering.ok || !numbering.data) {
      return { ok: false, error: numbering.error || "Failed to reserve GST document number" };
    }
    const numberingData = numbering.data;

    const originalSnapshot =
      originalDocument && typeof originalDocument.jsonSnapshot === "object" && originalDocument.jsonSnapshot !== null
        ? (originalDocument.jsonSnapshot as Record<string, unknown>)
        : {};
    const originalBuyer =
      originalSnapshot.buyer && typeof originalSnapshot.buyer === "object"
        ? (originalSnapshot.buyer as Record<string, unknown>)
        : {};

    const buyer = {
      ...originalBuyer,
      ...(input.buyer || {}),
      gstin: payloadData.normalizedBuyerGstin,
      stateCode: payloadData.normalizedBuyerStateCode || (normalize(originalBuyer.stateCode) || null),
    };

    const snapshot = {
      settings,
      buyer,
      metadata: input.metadata || {},
      noteType: input.noteType,
      source: {
        sourceOrderId: input.sourceOrderId || null,
        sourceOrderNumber: input.sourceOrderNumber || null,
        sourceReference: input.sourceReference || null,
      },
      originalDocumentId: input.originalDocumentId || null,
      originalDocumentNumber: originalDocument ? normalize(originalDocument.documentNumber) || null : null,
      supplyType,
      placeOfSupplyStateCode: placeOfSupply,
      isInterstate,
      computedAt: new Date().toISOString(),
      lines: taxData.lines,
      totals: taxData.totals,
    };

    const documentToPersist: NormalizedGstDocument = {
      id: generateUuid(),
      documentType: input.noteType,
      status: GST_DEFAULT_DOCUMENT_STATUS,
      documentNumber: numberingData.documentNumber,
      documentDate,
      gstSettingsId: settings.id,
      shopId: String(settings.shopId),
      shopifyOrderId: input.shopifyOrderId || null,
      shopifyOrderName: input.shopifyOrderName || null,
      sourceOrderId: input.sourceOrderId || null,
      sourceOrderNumber: input.sourceOrderNumber || null,
      sourceReference: input.sourceReference || null,
      originalDocumentId: input.originalDocumentId || null,
      supplyType,
      placeOfSupplyStateCode: placeOfSupply,
      isInterstate,
      currency: payloadData.normalizedCurrency,
      taxableAmount: new Prisma.Decimal(taxData.totals.taxableAmount),
      cgstAmount: new Prisma.Decimal(taxData.totals.cgstAmount),
      sgstAmount: new Prisma.Decimal(taxData.totals.sgstAmount),
      igstAmount: new Prisma.Decimal(taxData.totals.igstAmount),
      cessAmount: new Prisma.Decimal(taxData.totals.cessAmount),
      totalAmount: new Prisma.Decimal(taxData.totals.totalAmount),
      jsonSnapshot: snapshot,
      metadata: input.metadata || {},
      updatedAt: new Date(),
    };

    const created = await persistGstDocumentWithLines({
      document: documentToPersist,
      taxLines: taxData.lines,
      sourceLines: effectiveLines as unknown as Array<Record<string, unknown>>,
    });

    await writeGstAuditLog(
      {
        action: "GST_DOCUMENT_DRAFT_CREATED",
        gstSettingsId: settings.id,
        gstDocumentId: created.id,
        nextState: snapshot,
      },
      { actorType: "SYSTEM" },
    );

    return {
      ok: true,
      data: {
        id: created.id,
        documentType: input.noteType,
        documentNumber: created.documentNumber,
        originalDocumentId: input.originalDocumentId,
        status: GST_DEFAULT_DOCUMENT_STATUS,
      },
    };
  } catch (error) {
    console.error("[GST NOTE] buildNoteDraft failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to create GST note draft" };
  }
}

export async function getGstNoteById(
  gstDocumentId: string,
  options: { shopId?: string } = {},
): Promise<GstServiceResult<Record<string, unknown>>> {
  try {
    // Tenant isolation: scope by shopId when provided so a foreign note id
    // resolves to "not found" instead of leaking another shop's note.
    const scopedShopId = String(options.shopId || "").trim();
    const document = await gstDb.gstDocument.findFirst({
      where: { id: String(gstDocumentId).trim(), ...(scopedShopId ? { shopId: scopedShopId } : {}) },
      include: { lines: { orderBy: { lineNumber: "asc" } }, gstSettings: true, originalDocument: true },
    });

    if (!document || (document.documentType !== "CREDIT_NOTE" && document.documentType !== "DEBIT_NOTE")) {
      return { ok: false, error: "GST note not found" };
    }

    return { ok: true, data: document };
  } catch (error) {
    console.error("[GST NOTE] getGstNoteById failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to fetch GST note" };
  }
}
