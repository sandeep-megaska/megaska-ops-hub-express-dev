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
import { gstPerfLog, gstPerfNow } from "./perf";
import {
  generateUuid,
  persistGstDocumentWithLines,
  type NormalizedGstDocument,
} from "./document-persistence";

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
function pickFirstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

function joinName(first?: unknown, last?: unknown): string | null {
  return pickFirstText([first, last].map((v) => String(v ?? "").trim()).filter(Boolean).join(" "));
}

function normalizeAddress(raw: unknown) {
  const address = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const name =
    pickFirstText(
      address.name,
      address.fullName,
      joinName(address.firstName, address.lastName)
    ) || null;

  return {
    name,
    address1: pickFirstText(address.address1, address.line1, address.addressLine1),
    address2: pickFirstText(address.address2, address.line2, address.addressLine2),
    city: pickFirstText(address.city),
    state: pickFirstText(address.province, address.state, address.stateProvince),
    stateCode: pickFirstText(address.provinceCode, address.stateCode),
    pincode: pickFirstText(address.zip, address.postalCode, address.pincode),
    country: pickFirstText(address.country, address.countryCode) || "India",
    phone: pickFirstText(address.phone),
  };
}

function extractCustomerDetailsForInvoice(input: GstInvoiceDraftInput) {
  const metadata = input.metadata && typeof input.metadata === "object"
    ? (input.metadata as Record<string, unknown>)
    : {};

  const orderSnapshot =
    (metadata.orderSnapshot && typeof metadata.orderSnapshot === "object"
      ? (metadata.orderSnapshot as Record<string, unknown>)
      : null) ||
    (metadata.order && typeof metadata.order === "object"
      ? (metadata.order as Record<string, unknown>)
      : null) ||
    metadata;

  const customer =
    orderSnapshot.customer && typeof orderSnapshot.customer === "object"
      ? (orderSnapshot.customer as Record<string, unknown>)
      : {};

  const shippingAddress = normalizeAddress(
    orderSnapshot.shippingAddress ||
    orderSnapshot.shipping_address ||
    metadata.shippingAddress
  );

  const billingAddress = normalizeAddress(
    orderSnapshot.billingAddress ||
    orderSnapshot.billing_address ||
    metadata.billingAddress
  );

  const customerName =
    pickFirstText(
      input.buyer?.legalName,
      shippingAddress.name,
      billingAddress.name,
      customer.displayName,
      customer.name,
      joinName(customer.firstName, customer.lastName),
      orderSnapshot.customerName,
      orderSnapshot.name,
      orderSnapshot.email,
      orderSnapshot.contactEmail
    ) || "Customer";

  const email =
    pickFirstText(
      input.buyer?.email,
      customer.email,
      orderSnapshot.email,
      orderSnapshot.contactEmail,
      metadata.email
    ) || null;

  const phone =
    pickFirstText(
      input.buyer?.phone,
      shippingAddress.phone,
      billingAddress.phone,
      customer.phone,
      orderSnapshot.phone,
      metadata.phone
    ) || null;

  const resolvedShipping = {
    ...shippingAddress,
    name: shippingAddress.name || customerName,
    phone: shippingAddress.phone || phone,
  };

  const resolvedBilling = {
    ...billingAddress,
    name: billingAddress.name || customerName,
    phone: billingAddress.phone || phone,
  };

  return {
    buyer: {
      legalName: customerName,
      gstin: input.buyer?.gstin || null,
      stateCode: input.buyer?.stateCode || resolvedBilling.stateCode || resolvedShipping.stateCode || null,
      email,
      phone,
      billingAddress: resolvedBilling,
      shippingAddress: resolvedShipping,
    },
    billingAddress: resolvedBilling,
    shippingAddress: resolvedShipping,
  };
}
async function ensureBuyerParty(input: GstInvoiceDraftInput) {
  return {
    ...(input.buyer || {}),
    legalName: String(input.buyer?.legalName || "").trim() || null,
    gstin:
      String(input.buyer?.gstin || "")
        .trim()
        .toUpperCase() || null,
    stateCode: String(input.buyer?.stateCode || "").trim() || null,
    email: input.buyer?.email || null,
    phone: input.buyer?.phone || null,
  };
}

export async function buildInvoiceDraft(input: GstInvoiceDraftInput): Promise<GstServiceResult<GstInvoiceDraftResult>> {
  const diagnosticState: {
    phase: string;
    gstDocumentCreateAttempted: boolean;
    gstDocumentCreateFailedReason: string | null;
  } = {
    phase: "VALIDATE_DRAFT_PAYLOAD",
    gstDocumentCreateAttempted: false,
    gstDocumentCreateFailedReason: null,
  };

  try {
    const totalStartedAtMs = gstPerfNow();
    const validationStartedAtMs = gstPerfNow();
    const payloadValidation = validateDocumentDraftPayload(input);
    if (!payloadValidation.ok || !payloadValidation.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(payloadValidation.error || "Invalid GST document payload"),
      };
    }

    gstPerfLog("gst.buildInvoiceDraft.validation", validationStartedAtMs, { sourceOrderId: input.sourceOrderId || null, lineCount: input.lines.length });

    const payloadData = payloadValidation.data;
    const settingsStartedAtMs = gstPerfNow();
    const requestedShopId = normalizeText(input.shopId) || null;

    const scopedSettingsResult = requestedShopId
      ? await getActiveGstSettings({ shopId: requestedShopId })
      : { ok: false, data: null, error: "missing shopId" };

    const globalSettingsResult = await getActiveGstSettings({ shopId: null });
    const byIdSettingsResult = input.gstSettingsId ? await getGstSettingsById(input.gstSettingsId) : null;

    const settings =
      scopedSettingsResult.ok && scopedSettingsResult.data
        ? scopedSettingsResult.data
        : globalSettingsResult.ok && globalSettingsResult.data
          ? globalSettingsResult.data
          : byIdSettingsResult?.ok && byIdSettingsResult.data
            ? byIdSettingsResult.data
            : null;

    gstPerfLog("gst.buildInvoiceDraft.settingsResolution", settingsStartedAtMs, { sourceOrderId: input.sourceOrderId || null, requestedShopId, resolved: Boolean(settings) });

    if (!settings) {
      return {
        ok: false,
        error: toInvoiceDraftError(
          scopedSettingsResult.error ||
            globalSettingsResult.error ||
            byIdSettingsResult?.error ||
            "Unable to resolve GST settings"
        ),
      };
    }

    const documentDate = normalizeDate(input.documentDate);

    diagnosticState.phase = "CLASSIFY_SUPPLY";
    const classificationStartedAtMs = gstPerfNow();
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

    gstPerfLog("gst.buildInvoiceDraft.supplyClassification", classificationStartedAtMs, { sourceOrderId: input.sourceOrderId || null, ok: classification.ok });

    if (!classification.ok || !classification.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(classification.error || "GST classification failed"),
      };
    }

    const classificationData = classification.data;

    diagnosticState.phase = "COMPUTE_TOTALS";
    const taxStartedAtMs = gstPerfNow();
    const taxResult = computeTotals(input.lines, classificationData.isInterstate, {
      priceIncludesTax: settings.priceIncludesTax !== false,
      cessRates: input.lines.map((line) => Number(line.cessRate || 0)),
    });

    gstPerfLog("gst.buildInvoiceDraft.taxTotalComputation", taxStartedAtMs, { sourceOrderId: input.sourceOrderId || null, lineCount: input.lines.length, ok: taxResult.ok });

    if (!taxResult.ok || !taxResult.data) {
      return {
        ok: false,
        error: toInvoiceDraftError(taxResult.error || "GST tax computation failed"),
      };
    }

    const taxData = taxResult.data;

    diagnosticState.phase = "RESERVE_GST_NUMBER";
    const numberingStartedAtMs = gstPerfNow();
    const numberingResult = await reserveGstNumber({
      gstSettingsId: settings.id,
      documentType: "TAX_INVOICE",
      documentDate,
    });

    gstPerfLog("gst.buildInvoiceDraft.documentNumberReservation", numberingStartedAtMs, { sourceOrderId: input.sourceOrderId || null, ok: numberingResult.ok });

    if (!numberingResult.ok || !numberingResult.data) {
      return {
        ok: false,
        error: numberingResult.error || "GST numbering failed",
      };
    }

    const numberingData = numberingResult.data;
    const invoiceWarnings = [...classificationData.warnings];

    const customerDetails = extractCustomerDetailsForInvoice(input);

    const resolvedBuyer = {
      ...customerDetails.buyer,
      gstin: payloadData.normalizedBuyerGstin || customerDetails.buyer.gstin,
      stateCode:
        payloadData.normalizedBuyerStateCode ||
        customerDetails.buyer.stateCode,
    };

    diagnosticState.phase = "ENSURE_BUYER_PARTY";
    const buyerParty = await ensureBuyerParty({
      ...input,
      buyer: resolvedBuyer,
    });

    const snapshot = {
      settings,
      classification: classificationData,
      buyer: resolvedBuyer,
      billingAddress: customerDetails.billingAddress,
      shippingAddress: customerDetails.shippingAddress,
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

    const gstDocumentId = generateUuid();
    const gstSubtotalAmount = new Prisma.Decimal(taxData.totals.taxableAmount);

    const documentToPersist: NormalizedGstDocument = {
      id: gstDocumentId,
      documentType: "TAX_INVOICE",
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
      originalDocumentId: null,
      supplyType: classificationData.supplyType,
      placeOfSupplyStateCode: classificationData.placeOfSupplyStateCode,
      isInterstate: classificationData.isInterstate,
      currency: payloadData.normalizedCurrency,
      taxableAmount: gstSubtotalAmount,
      cgstAmount: new Prisma.Decimal(taxData.totals.cgstAmount),
      sgstAmount: new Prisma.Decimal(taxData.totals.sgstAmount),
      igstAmount: new Prisma.Decimal(taxData.totals.igstAmount),
      cessAmount: new Prisma.Decimal(taxData.totals.cessAmount),
      totalAmount: new Prisma.Decimal(taxData.totals.totalAmount),
      jsonSnapshot: snapshot,
      metadata: input.metadata || {},
      updatedAt: new Date(),
    };

    console.info("[GST DEBUG][INVOICE][CREATE]", {
      resolvedShopId: requestedShopId,
      selectedGstSettingsId: settings.id,
      selectedGstSettingsShopId: settings.shopId ?? null,
      documentShopId: documentToPersist.shopId,
    });

    diagnosticState.phase = "PERSIST_GST_DOCUMENT";
    diagnosticState.gstDocumentCreateAttempted = true;
    const documentCreationStartedAtMs = gstPerfNow();
    let created: { id: string; documentNumber: string };
    try {
      created = await persistGstDocumentWithLines({
        document: documentToPersist,
        taxLines: taxData.lines,
        sourceLines: input.lines as unknown as Array<Record<string, unknown>>,
      });
    } catch (error) {
      diagnosticState.gstDocumentCreateFailedReason = error instanceof Error ? error.message : String(error);
      throw error;
    }

    gstPerfLog("gst.buildInvoiceDraft.persistDocument", documentCreationStartedAtMs, { sourceOrderId: input.sourceOrderId || null, gstDocumentId: created.id, lineCount: input.lines.length });

    await writeGstAuditLog(
      {
        action: "GST_DOCUMENT_DRAFT_CREATED",
        gstSettingsId: settings.id,
        gstDocumentId: created.id,
        nextState: snapshot,
      },
      { actorType: "SYSTEM" }
    );

    gstPerfLog("gst.buildInvoiceDraft.total", totalStartedAtMs, { sourceOrderId: input.sourceOrderId || null, gstDocumentId: created.id, lineCount: input.lines.length });

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
    const stack = error instanceof Error ? error.stack : undefined;

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[GST INVOICE] PrismaClientKnownRequestError", {
        code: error.code,
        meta: error.meta,
        message: error.message,
      });
    }

    console.error("[GST INVOICE] buildInvoiceDraft failed", {
      error: reason,
      stack,
      diagnosticState,
    });

    return {
      ok: false,
      error: toInvoiceDraftError(reason),
      errorDetails: {
        phase: diagnosticState.phase,
        stack,
        gstDocumentCreateAttempted: diagnosticState.gstDocumentCreateAttempted,
        gstDocumentCreateFailedReason: diagnosticState.gstDocumentCreateFailedReason,
      },
    };
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
