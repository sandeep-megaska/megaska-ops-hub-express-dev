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

const GST_DOCUMENT_REQUIRED_FIELDS = [
  "documentType",
  "status",
  "documentNumber",
  "documentDate",
  "gstSettingsId",
  "supplyType",
  "placeOfSupplyStateCode",
  "isInterstate",
  "currency",
  "taxableAmount",
  "cgstAmount",
  "sgstAmount",
  "igstAmount",
  "cessAmount",
  "totalAmount",
  "jsonSnapshot",
] as const;

type GstDocumentColumnInfo = {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
  column_default: string | null;
};

function isValidDateValue(value: unknown): boolean {
  if (!(value instanceof Date)) return false;
  return !Number.isNaN(value.getTime());
}

function isValidDecimalValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Prisma.Decimal) return value.isFinite();
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

function validateGstDocumentCreatePayload(
  createPayload: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const field of GST_DOCUMENT_REQUIRED_FIELDS) {
    const value = createPayload[field];
    if (value === null || value === undefined) {
      errors.push(`${field}: value is ${value === null ? "null" : "undefined"}`);
      continue;
    }

    if (
      (field === "documentType"
        || field === "status"
        || field === "documentNumber"
        || field === "gstSettingsId"
        || field === "supplyType"
        || field === "placeOfSupplyStateCode"
        || field === "currency")
      && String(value).trim().length === 0
    ) {
      errors.push(`${field}: value is empty`);
      continue;
    }

    if (field === "documentDate" && !isValidDateValue(value)) {
      errors.push(`${field}: invalid Date value`);
      continue;
    }

    if (field === "isInterstate" && typeof value !== "boolean") {
      errors.push(`${field}: expected boolean, got ${typeof value}`);
      continue;
    }

    if (
      (field === "taxableAmount"
        || field === "cgstAmount"
        || field === "sgstAmount"
        || field === "igstAmount"
        || field === "cessAmount"
        || field === "totalAmount")
      && !isValidDecimalValue(value)
    ) {
      errors.push(`${field}: invalid decimal value`);
      continue;
    }

    if (field === "jsonSnapshot" && (typeof value !== "object" || value === null)) {
      errors.push(`${field}: expected JSON object`);
    }
  }

  return errors;
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

    const scopedSettingsResult = requestedShopId
      ? await getActiveGstSettings({ shopId: requestedShopId })
      : { ok: false, data: null, error: "missing shopId" };
    const globalSettingsResult = await getActiveGstSettings({ shopId: null });
    const byIdSettingsResult = input.gstSettingsId ? await getGstSettingsById(input.gstSettingsId) : null;

    const settings =
      (scopedSettingsResult.ok && scopedSettingsResult.data)
        ? scopedSettingsResult.data
        : (globalSettingsResult.ok && globalSettingsResult.data)
          ? globalSettingsResult.data
          : (byIdSettingsResult?.ok && byIdSettingsResult.data)
            ? byIdSettingsResult.data
            : null;

    if (!settings) {
      return {
        ok: false,
        error: toInvoiceDraftError(
          scopedSettingsResult.error || globalSettingsResult.error || byIdSettingsResult?.error || "Unable to resolve GST settings",
        ),
      };
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

    const createPayload = {
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
    };

    console.info("[GST DEBUG][INVOICE][CREATE]", {
      resolvedShopId: requestedShopId,
      selectedGstSettingsId: settings.id,
      selectedGstSettingsShopId: settings.shopId ?? null,
      requiredGstDocumentFields: GST_DOCUMENT_REQUIRED_FIELDS,
      createPayloadKeys: Object.keys(createPayload).sort(),
    });

    const created = await gstDb.$transaction(async (tx) => {
      const txWithRaw = tx as typeof tx & {
        $queryRaw: <T = unknown>(...args: unknown[]) => Promise<T>;
      };

      const dbColumns = await txWithRaw.$queryRaw<GstDocumentColumnInfo[]>(Prisma.sql`
        SELECT column_name, is_nullable, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'GstDocument'
        ORDER BY ordinal_position
      `);

      const requiredDbColumns = dbColumns
        .filter((col) => col.is_nullable === "NO" && col.column_default === null)
        .map((col) => col.column_name);

      const payloadValidationErrors = validateGstDocumentCreatePayload(
        createPayload as Record<string, unknown>
      );

      console.info("[GST DEBUG][INVOICE][DB_SCHEMA][GstDocument]", {
        columns: dbColumns,
        requiredColumnsWithoutDefault: requiredDbColumns,
      });

      if (payloadValidationErrors.length > 0) {
        console.error("[GST INVOICE] pre-create payload validation failed", {
          payloadValidationErrors,
        });
        throw new Error(
          `GST document payload validation failed: ${payloadValidationErrors.join("; ")}`
        );
      }

      const createPayloadKeys = new Set(Object.keys(createPayload));
      const requiredColumnsMissingFromPayload = requiredDbColumns.filter(
        (columnName) => !createPayloadKeys.has(columnName)
      );

      if (requiredColumnsMissingFromPayload.length > 0) {
        console.error("[GST INVOICE] DB requires columns missing from createPayload", {
          requiredColumnsMissingFromPayload,
          requiredDbColumns,
          createPayloadKeys: [...createPayloadKeys].sort(),
        });
        throw new Error(
          `GstDocument createPayload missing required DB column(s): ${requiredColumnsMissingFromPayload.join(", ")}`
        );
      }

      const document = await tx.gstDocument.create({
        data: createPayload,
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
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[GST INVOICE] PrismaClientKnownRequestError", {
        code: error.code,
        meta: error.meta,
        message: error.message,
      });
    }
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
