import { Prisma } from "../../generated/prisma";
import { writeGstAuditLog } from "./audit";
import { GST_DEFAULT_DOCUMENT_STATUS } from "./constants";
import { classifySupply } from "./classifier";
import { gstDb } from "./db";
import { getGstInvoiceById } from "./invoice";
import { reserveGstNumber } from "./numbering";
import { getActiveGstSettings, getGstSettingsById } from "./settings";
import { computeTotals } from "./tax-engine";
import type { GstNoteDraftInput, GstServiceResult } from "./types";
import { validateDocumentDraftPayload } from "./validation";

export interface GstNoteDraftResult {
  id: string;
  documentType: "CREDIT_NOTE" | "DEBIT_NOTE";
  documentNumber: string;
  originalDocumentId?: string;
  status: typeof GST_DEFAULT_DOCUMENT_STATUS;
}

function normalizeDate(value: Date | string | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isCompatibleNoteType(noteType: "CREDIT_NOTE" | "DEBIT_NOTE", originalDocumentType: string): boolean {
  return originalDocumentType === "TAX_INVOICE" || (noteType === "CREDIT_NOTE" && originalDocumentType === "DEBIT_NOTE") || (noteType === "DEBIT_NOTE" && originalDocumentType === "CREDIT_NOTE");
}

export async function buildNoteDraft(input: GstNoteDraftInput): Promise<GstServiceResult<GstNoteDraftResult>> {
  try {
    const payloadValidation = validateDocumentDraftPayload(input);
    if (!payloadValidation.ok || !payloadValidation.data) {
      return { ok: false, error: payloadValidation.error || "Invalid GST note draft payload" };
    }

    const settingsResult = input.gstSettingsId ? await getGstSettingsById(input.gstSettingsId) : await getActiveGstSettings();
    if (!settingsResult.ok || !settingsResult.data) {
      return { ok: false, error: settingsResult.error || "Unable to resolve GST settings" };
    }

    const settings = settingsResult.data;
    const payloadData = payloadValidation.data;
    let originalDocument: Record<string, unknown> | undefined;

    if (input.originalDocumentId) {
      const original = await getGstInvoiceById(input.originalDocumentId);
      if (!original.ok || !original.data) {
        return { ok: false, error: "Original GST document not found" };
      }
      if (!isCompatibleNoteType(input.noteType, String(original.data.documentType || ""))) {
        return { ok: false, error: "Invalid noteType for referenced original document type" };
      }
      originalDocument = original.data;
    }

    const documentDate = normalizeDate(input.documentDate);
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
    const classificationData = classification.data;

    const tax = computeTotals(input.lines, classificationData.isInterstate);
    if (!tax.ok || !tax.data) {
      return { ok: false, error: tax.error || "GST note tax computation failed" };
    }
    const taxData = tax.data;

    const numbering = await reserveGstNumber({ gstSettingsId: settings.id, documentType: input.noteType, documentDate });
    if (!numbering.ok || !numbering.data) {
      return { ok: false, error: numbering.error || "Failed to reserve GST document number" };
    }
    const numberingData = numbering.data;

    const snapshot = {
      settings,
      classification: classificationData,
      buyer: {
        ...(input.buyer || {}),
        gstin: payloadData.normalizedBuyerGstin,
        stateCode: payloadData.normalizedBuyerStateCode,
      },
      metadata: input.metadata || {},
      noteType: input.noteType,
      source: {
        sourceOrderId: input.sourceOrderId || null,
        sourceOrderNumber: input.sourceOrderNumber || null,
        sourceReference: input.sourceReference || null,
      },
      originalDocumentId: input.originalDocumentId || null,
      originalDocumentNumber: originalDocument?.documentNumber || null,
      computedAt: new Date().toISOString(),
      lines: taxData.lines,
      totals: taxData.totals,
    };

    const created = await gstDb.$transaction(async (tx) => {
      const document = await tx.gstDocument.create({
        data: {
          documentType: input.noteType,
          status: GST_DEFAULT_DOCUMENT_STATUS,
          documentNumber: numberingData.documentNumber,
          documentDate,
          gstSettingsId: settings.id,
          originalDocumentId: input.originalDocumentId || null,
          shopifyOrderId: input.shopifyOrderId || null,
          shopifyOrderName: input.shopifyOrderName || null,
          sourceOrderId: input.sourceOrderId || null,
          sourceOrderNumber: input.sourceOrderNumber || null,
          sourceReference: input.sourceReference || null,
          supplyType: classificationData.supplyType,
          placeOfSupplyStateCode: classificationData.placeOfSupplyStateCode,
          isInterstate: classificationData.isInterstate,
          currency: payloadData.normalizedCurrency,
          taxableAmount: new Prisma.Decimal(taxData.totals.taxableAmount),
          cgstAmount: new Prisma.Decimal(taxData.totals.cgstAmount),
          sgstAmount: new Prisma.Decimal(taxData.totals.sgstAmount),
          igstAmount: new Prisma.Decimal(taxData.totals.igstAmount),
          cessAmount: new Prisma.Decimal(taxData.totals.cessAmount),
          totalAmount: new Prisma.Decimal(taxData.totals.totalAmount),
          jsonSnapshot: snapshot,
          metadata: input.metadata || {},
        },
      });

      await tx.gstDocumentLine.createMany({
        data: taxData.lines.map((line) => ({
          gstDocumentId: document.id,
          lineNumber: line.lineNumber,
          description: line.description,
          hsnOrSac: line.hsnOrSac || null,
          quantity: new Prisma.Decimal(line.quantity),
          unit: line.unit || null,
          unitPrice: new Prisma.Decimal(line.unitPrice),
          discount: new Prisma.Decimal(line.discount),
          taxableAmount: new Prisma.Decimal(line.taxableAmount),
          taxRate: new Prisma.Decimal(line.taxRate),
          cgstAmount: new Prisma.Decimal(line.cgstAmount),
          sgstAmount: new Prisma.Decimal(line.sgstAmount),
          igstAmount: new Prisma.Decimal(line.igstAmount),
          cessAmount: new Prisma.Decimal(line.cessAmount),
          lineTotal: new Prisma.Decimal(line.lineTotal),
        })),
      });

      return document;
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

    return { ok: true, data: { id: created.id, documentType: input.noteType, documentNumber: created.documentNumber, originalDocumentId: input.originalDocumentId, status: GST_DEFAULT_DOCUMENT_STATUS } };
  } catch (error) {
    console.error("[GST NOTE] buildNoteDraft failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to create GST note draft" };
  }
}

export async function getGstNoteById(gstDocumentId: string): Promise<GstServiceResult<Record<string, unknown>>> {
  try {
    const document = await gstDb.gstDocument.findUnique({
      where: { id: String(gstDocumentId).trim() },
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
