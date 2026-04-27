import { Prisma } from "../../generated/prisma";
import { writeGstAuditLog } from "./audit";
import { GST_DEFAULT_DOCUMENT_STATUS } from "./constants";
import { classifySupply } from "./classifier";
import { gstDb } from "./db";
import { reserveGstNumber } from "./numbering";
import { getActiveGstSettings, getGstSettingsById } from "./settings";
import { computeTotals } from "./tax-engine";
import type { GstInvoiceDraftInput, GstServiceResult } from "./types";
import { validateDocumentDraftPayload } from "./validation";

export interface GstInvoiceDraftResult {
  id: string;
  documentNumber: string;
  status: typeof GST_DEFAULT_DOCUMENT_STATUS;
  placeOfSupplyStateCode: string;
  isInterstate: boolean;
  warnings: string[];
}

function toInvoiceDraftError(reason: unknown): string {
  const message = String(reason || "").trim();
  const lc = message.toLowerCase();

  if (!message) return "Failed to create GST invoice draft";
  if (lc.includes("missing placeofsupplystatecode")) return "missing placeOfSupplyStateCode";
  if (lc.includes("missing gst mapping") || lc.includes("missing sku mapping")) return "missing SKU mapping";
  if (lc.includes("template")) return "missing template";
  if (lc.includes("totals") || lc.includes("tax computation")) return `invalid totals: ${message}`;
  if (lc.includes("gst settings") || lc.includes("statecode is required") || lc.includes("unable to resolve")) {
    return `invalid GST settings: ${message}`;
  }
  return message;
}

function normalizeDate(value: Date | string | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

async function ensureBuyerParty(input: GstInvoiceDraftInput) {
  const normalizedBuyer = {
    ...(input.buyer || {}),
    legalName: String(input.buyer?.legalName || "").trim() || null,
    gstin: String(input.buyer?.gstin || "")
      .trim()
      .toUpperCase() || null,
    stateCode: String(input.buyer?.stateCode || "").trim() || null,
    email: input.buyer?.email || null,
    phone: input.buyer?.phone || null,
  };
  return normalizedBuyer;
}

export async function buildInvoiceDraft(
  input: GstInvoiceDraftInput
): Promise<GstServiceResult<GstInvoiceDraftResult>> {
  try {
    const payloadValidation = validateDocumentDraftPayload(input);
    if (!payloadValidation.ok || !payloadValidation.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(payloadValidation.error || "Invalid GST document payload"),
      };
    }

    const payloadData = payloadValidation.data;

    const requestedShopId = normalizeText(input.shopId) || null;
    const settingsResult = input.gstSettingsId
      ? await getGstSettingsById(input.gstSettingsId)
      : await getActiveGstSettings({ shopId: requestedShopId });

    if (!settingsResult.ok || !settingsResult.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(settingsResult.error || "Unable to resolve GST settings"),
      };
    }

    let settings = settingsResult.data;
    if (requestedShopId && settings.shopId !== requestedShopId) {
      const scopedSettings = await getActiveGstSettings({ shopId: requestedShopId });
      if (scopedSettings.ok && scopedSettings.data) {
        settings = scopedSettings.data;
      }
    }
    const documentDate = normalizeDate(input.documentDate);

    const classification = classifySupply({
      sellerStateCode: settings.stateCode,
      billingStateCode: payloadData.normalizedBillingStateCode || input.billingStateCode,
      shippingStateCode: payloadData.normalizedShippingStateCode || input.shippingStateCode,
      shopifyShippingProvince: input.shopifyShippingProvince,
      shopifyBillingProvince: input.shopifyBillingProvince,
      buyerStateCode: payloadData.normalizedBuyerStateCode,
      placeOfSupplyStateCode: payloadData.normalizedPlaceOfSupplyStateCode,
      buyerGstin: payloadData.normalizedBuyerGstin,
      explicitSupplyType: input.supplyType,
    });

    if (!classification.ok || !classification.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(classification.error || "GST classification failed"),
      };
    }

    const classificationData = classification.data;

    const taxResult = computeTotals(input.lines, classificationData.isInterstate, {
      priceIncludesTax: settings.priceIncludesTax !== false,
      cessRates: input.lines.map((line) => Number(line.cessRate || 0)),
    });

    if (!taxResult.ok || !taxResult.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(taxResult.error || "GST tax computation failed"),
      };
    }

    const taxData = taxResult.data;

    const numberingResult = await reserveGstNumber({
      gstSettingsId: settings.id,
      documentType: "TAX_INVOICE",
      documentDate,
    });

    if (!numberingResult.ok || !numberingResult.data) {
      return {
        ok: false,
        error: numberingResult.error || "GST numbering failed",
      };
    }

    const numberingData = numberingResult.data;

    const invoiceWarnings = [...classificationData.warnings];
    const buyerParty = await ensureBuyerParty({
      ...input,
      buyer: {
        ...input.buyer,
        gstin: payloadData.normalizedBuyerGstin,
        stateCode: payloadData.normalizedBuyerStateCode,
      },
    });

    const snapshot = {
      settings,
      classification: classificationData,
      buyer: {
        ...(input.buyer || {}),
        gstin: payloadData.normalizedBuyerGstin,
        stateCode: payloadData.normalizedBuyerStateCode,
      },
      buyerParty,
      metadata: input.metadata || {},
      reverseCharge: Boolean(input.reverseCharge),
      source: {
        sourceOrderId: input.sourceOrderId || null,
        sourceOrderNumber: input.sourceOrderNumber || null,
        sourceReference: input.sourceReference || null,
        shopifyOrderId: input.shopifyOrderId || null,
        shopifyOrderName: input.shopifyOrderName || null,
      },
      computedAt: new Date().toISOString(),
      lines: taxData.lines,
      totals: taxData.totals,
    };

    const created = await gstDb.$transaction(async (tx) => {
      const document = await tx.gstDocument.create({
        data: {
          documentType: "TAX_INVOICE",
          status: GST_DEFAULT_DOCUMENT_STATUS,
          documentNumber: numberingData.documentNumber,
          documentDate,
          gstSettingsId: settings.id,
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
      { actorType: "SYSTEM" }
    );

    return {
      ok: true,
      data: {
        id: created.id,
        documentNumber: created.documentNumber,
        status: GST_DEFAULT_DOCUMENT_STATUS,
        placeOfSupplyStateCode: classificationData.placeOfSupplyStateCode,
        isInterstate: classificationData.isInterstate,
        warnings: invoiceWarnings,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[GST INVOICE] buildInvoiceDraft failed", {
      error: reason,
    });
    return { ok: false, error: toInvoiceDraftError(reason) };
  }
}

export async function getGstInvoiceById(
  gstDocumentId: string
): Promise<GstServiceResult<Record<string, unknown>>> {
  try {
    const document = await gstDb.gstDocument.findUnique({
      where: { id: String(gstDocumentId).trim() },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        gstSettings: true,
        originalDocument: true,
      },
    });

    if (!document || document.documentType !== "TAX_INVOICE") {
      return { ok: false, error: "GST invoice not found" };
    }

    return { ok: true, data: { ...document } };
  } catch (error) {
    console.error("[GST INVOICE] getGstInvoiceById failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Failed to fetch GST invoice" };
  }
}
