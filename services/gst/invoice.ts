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

type GstColumnInfo = {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
  column_default: string | null;
};

type GstDocumentLineInsertRow = {
  [key: string]: string | number | boolean | Date | Prisma.Decimal | null;
};

const GST_DOCUMENT_LINE_PRISMA_COLUMNS = new Set([
  "id",
  "gstDocumentId",
  "lineNumber",
  "description",
  "hsnOrSac",
  "quantity",
  "unit",
  "unitPrice",
  "discount",
  "taxableAmount",
  "taxRate",
  "cgstAmount",
  "sgstAmount",
  "igstAmount",
  "cessAmount",
  "lineTotal",
  "createdAt",
  "updatedAt",
]);

function isValidDateValue(value: unknown): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidDecimalValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Prisma.Decimal) return value.isFinite();
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

function validateGstDocumentCreatePayload(createPayload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of GST_DOCUMENT_REQUIRED_FIELDS) {
    const value = createPayload[field];

    if (value === null || value === undefined) {
      errors.push(`${field}: value is ${value === null ? "null" : "undefined"}`);
      continue;
    }

    if (
      (
        field === "documentType" ||
        field === "status" ||
        field === "documentNumber" ||
        field === "gstSettingsId" ||
        field === "supplyType" ||
        field === "placeOfSupplyStateCode" ||
        field === "currency"
      ) &&
      String(value).trim().length === 0
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
      (
        field === "taxableAmount" ||
        field === "cgstAmount" ||
        field === "sgstAmount" ||
        field === "igstAmount" ||
        field === "cessAmount" ||
        field === "totalAmount"
      ) &&
      !isValidDecimalValue(value)
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
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function toNullableTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toGstTaxRateType(rateValue: unknown): string {
  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate <= 0) return "ZERO";

  const rounded = Math.round(rate * 100) / 100;
  if (rounded === 3) return "GST_003";
  if (rounded === 5) return "GST_005";
  if (rounded === 12) return "GST_012";
  if (rounded === 18) return "GST_018";
  if (rounded === 28) return "GST_028";

  // Production legacy enum only supports standard GST slabs. If a future
  // non-standard rate appears, fail clearly instead of inserting invalid enum.
  throw new Error(`Unsupported GST taxRateType for tax rate ${rate}`);
}

function pickLineSku(taxLine: Record<string, unknown>, sourceLine: Record<string, unknown>): string | null {
  return toNullableTrimmedString(
    taxLine.sku ??
      taxLine.productSku ??
      taxLine.variantSku ??
      sourceLine.sku ??
      sourceLine.productSku ??
      sourceLine.variantSku
  );
}

function getRequiredColumnsWithoutDefault(columns: GstColumnInfo[]): string[] {
  return columns
    .filter((col) => col.is_nullable === "NO" && col.column_default === null)
    .map((col) => col.column_name);
}

function buildGstDocumentLineInsertRows(args: {
  documentId: string;
  taxLines: Array<Record<string, unknown>>;
  sourceLines: Array<Record<string, unknown>>;
  dbColumns: GstColumnInfo[];
}): { rows: GstDocumentLineInsertRow[]; missingRequiredColumns: string[] } {
  const { documentId, taxLines, sourceLines, dbColumns } = args;
  const now = new Date();
  const columnNames = new Set(dbColumns.map((col) => col.column_name));

  const rows = taxLines.map((rawLine, index) => {
    const line = rawLine as Record<string, unknown>;
    const sourceLine = (sourceLines[index] || {}) as Record<string, unknown>;
    const lineSku = pickLineSku(line, sourceLine);

    const row: GstDocumentLineInsertRow = {
      id: generateUuid(),
      gstDocumentId: documentId,
      lineNumber: Number(line.lineNumber || index + 1),
      description: String(line.description ?? sourceLine.description ?? sourceLine.title ?? `Line ${index + 1}`),
      hsnOrSac: toNullableTrimmedString(line.hsnOrSac ?? line.hsnCode ?? sourceLine.hsnOrSac ?? sourceLine.hsnCode),
      quantity: new Prisma.Decimal(Number(line.quantity ?? sourceLine.quantity ?? 0)),
      unit: toNullableTrimmedString(line.unit ?? sourceLine.unit),
      unitPrice: new Prisma.Decimal(Number(line.unitPrice ?? sourceLine.unitPrice ?? sourceLine.price ?? 0)),
      discount: new Prisma.Decimal(Number(line.discount ?? sourceLine.discount ?? 0)),
      taxableAmount: new Prisma.Decimal(Number(line.taxableAmount ?? 0)),
      taxRate: new Prisma.Decimal(Number(line.taxRate ?? sourceLine.taxRate ?? 0)),
      cgstAmount: new Prisma.Decimal(Number(line.cgstAmount ?? 0)),
      sgstAmount: new Prisma.Decimal(Number(line.sgstAmount ?? 0)),
      igstAmount: new Prisma.Decimal(Number(line.igstAmount ?? 0)),
      cessAmount: new Prisma.Decimal(Number(line.cessAmount ?? 0)),
      lineTotal: new Prisma.Decimal(Number(line.lineTotal ?? 0)),
      createdAt: now,
      updatedAt: now,
    };

    /*
      Production DB has a legacy enum column taxRateType that is not present in
      the generated Prisma schema. Valid enum values are NIL, ZERO, GST_003,
      GST_005, GST_012, GST_018, and GST_028.
    */
    row.taxRateType = toGstTaxRateType(row.taxRate);

    if (columnNames.has("documentId")) row.documentId = documentId;
    if (columnNames.has("itemName")) row.itemName = row.description;
    if (columnNames.has("productName")) row.productName = row.description;
    if (columnNames.has("title")) row.title = row.description;
    if (columnNames.has("sku")) row.sku = lineSku;
    if (columnNames.has("hsnCode")) row.hsnCode = row.hsnOrSac;
    if (columnNames.has("taxRatePercent")) row.taxRatePercent = row.taxRate;
    if (columnNames.has("discountAmount")) row.discountAmount = row.discount;
    if (columnNames.has("totalAmount")) row.totalAmount = row.lineTotal;
    if (columnNames.has("grossAmount")) row.grossAmount = row.lineTotal;

    return row;
  });

  const requiredDbColumns = getRequiredColumnsWithoutDefault(dbColumns);
  const missingRequiredColumns = requiredDbColumns.filter((columnName) =>
    rows.some((row) => row[columnName] === undefined || row[columnName] === null)
  );

  return { rows, missingRequiredColumns };
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
      scopedSettingsResult.ok && scopedSettingsResult.data
        ? scopedSettingsResult.data
        : globalSettingsResult.ok && globalSettingsResult.data
          ? globalSettingsResult.data
          : byIdSettingsResult?.ok && byIdSettingsResult.data
            ? byIdSettingsResult.data
            : null;

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

    diagnosticState.phase = "COMPUTE_TOTALS";
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

    diagnosticState.phase = "RESERVE_GST_NUMBER";
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
    const gstUpdatedAt = new Date();

    const createPayload = {
      id: gstDocumentId,
      documentType: "TAX_INVOICE",
      status: GST_DEFAULT_DOCUMENT_STATUS,
      documentNumber: numberingData.documentNumber,
      documentDate,
      gstSettingsId: settings.id,

      // Legacy production DB compatibility fields.
      settingsId: settings.id,
      issueDate: documentDate,
      subtotalAmount: gstSubtotalAmount,

      shopifyOrderId: input.shopifyOrderId || null,
      shopifyOrderName: input.shopifyOrderName || null,
      sourceOrderId: input.sourceOrderId || null,
      sourceOrderNumber: input.sourceOrderNumber || null,
      sourceReference: input.sourceReference || null,
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
      updatedAt: gstUpdatedAt,
    };

    console.info("[GST DEBUG][INVOICE][CREATE]", {
      resolvedShopId: requestedShopId,
      selectedGstSettingsId: settings.id,
      selectedGstSettingsShopId: settings.shopId ?? null,
      requiredGstDocumentFields: GST_DOCUMENT_REQUIRED_FIELDS,
      createPayloadKeys: Object.keys(createPayload).sort(),
    });

    diagnosticState.phase = "PERSIST_GST_DOCUMENT";
    const created = await gstDb.$transaction(async (tx) => {
      const txWithRaw = tx as typeof tx & {
        $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>;
        $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<number>;
      };

      const documentColumns = await txWithRaw.$queryRaw<GstColumnInfo[]>(Prisma.sql`
        SELECT column_name, is_nullable, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'GstDocument'
        ORDER BY ordinal_position
      `);

      const requiredDocumentColumns = getRequiredColumnsWithoutDefault(documentColumns);
      const payloadValidationErrors = validateGstDocumentCreatePayload(createPayload as Record<string, unknown>);

      console.info("[GST DEBUG][INVOICE][DB_SCHEMA][GstDocument]", {
        columns: documentColumns,
        requiredColumnsWithoutDefault: requiredDocumentColumns,
      });

      if (payloadValidationErrors.length > 0) {
        console.error("[GST INVOICE] pre-create payload validation failed", {
          payloadValidationErrors,
        });
        throw new Error(`GST document payload validation failed: ${payloadValidationErrors.join("; ")}`);
      }

      const createPayloadKeys = new Set(Object.keys(createPayload));
      const requiredColumnsMissingFromPayload = requiredDocumentColumns.filter(
        (columnName) => !createPayloadKeys.has(columnName)
      );

      if (requiredColumnsMissingFromPayload.length > 0) {
        console.error("[GST INVOICE] DB requires columns missing from createPayload", {
          requiredColumnsMissingFromPayload,
          requiredDocumentColumns,
          createPayloadKeys: [...createPayloadKeys].sort(),
        });
        throw new Error(
          `GstDocument createPayload missing required DB column(s): ${requiredColumnsMissingFromPayload.join(", ")}`
        );
      }

      const requiresLegacyDocumentInsert = requiredDocumentColumns.some(
        (columnName) =>
          columnName === "settingsId" || columnName === "issueDate" || columnName === "subtotalAmount"
      );

      let resolvedDocument: { id: string; documentNumber: string } | null = null;

      if (requiresLegacyDocumentInsert) {
        diagnosticState.gstDocumentCreateAttempted = true;
        const metadataJson = createPayload.metadata ?? {};
        let insertedDocuments: Array<{ id: string; documentNumber: string }>;
        try {
          insertedDocuments = await txWithRaw.$queryRaw<Array<{ id: string; documentNumber: string }>>(Prisma.sql`
            INSERT INTO "GstDocument" (
            "id",
            "documentType",
            "status",
            "documentNumber",
            "documentDate",
            "gstSettingsId",
            "settingsId",
            "issueDate",
            "shopifyOrderId",
            "shopifyOrderName",
            "sourceOrderId",
            "sourceOrderNumber",
            "sourceReference",
            "supplyType",
            "placeOfSupplyStateCode",
            "isInterstate",
            "currency",
            "taxableAmount",
            "subtotalAmount",
            "cgstAmount",
            "sgstAmount",
            "igstAmount",
            "cessAmount",
            "totalAmount",
            "jsonSnapshot",
            "metadata",
            "updatedAt"
          ) VALUES (
            ${createPayload.id},
            ${createPayload.documentType},
            ${createPayload.status},
            ${createPayload.documentNumber},
            ${createPayload.documentDate},
            ${createPayload.gstSettingsId},
            ${createPayload.settingsId},
            ${createPayload.issueDate},
            ${createPayload.shopifyOrderId},
            ${createPayload.shopifyOrderName},
            ${createPayload.sourceOrderId},
            ${createPayload.sourceOrderNumber},
            ${createPayload.sourceReference},
            ${createPayload.supplyType},
            ${createPayload.placeOfSupplyStateCode},
            ${createPayload.isInterstate},
            ${createPayload.currency},
            ${createPayload.taxableAmount},
            ${createPayload.subtotalAmount},
            ${createPayload.cgstAmount},
            ${createPayload.sgstAmount},
            ${createPayload.igstAmount},
            ${createPayload.cessAmount},
            ${createPayload.totalAmount},
            ${JSON.stringify(createPayload.jsonSnapshot)}::jsonb,
            ${JSON.stringify(metadataJson)}::jsonb,
            ${createPayload.updatedAt}
          )
            RETURNING "id", "documentNumber"
          `);
        } catch (error) {
          diagnosticState.gstDocumentCreateFailedReason = error instanceof Error ? error.message : String(error);
          throw error;
        }

        resolvedDocument = insertedDocuments[0] ?? null;
      } else {
        diagnosticState.gstDocumentCreateAttempted = true;
        let createdDocument;
        try {
          createdDocument = await tx.gstDocument.create({
            data: {
              id: createPayload.id,
              documentType: createPayload.documentType,
              status: createPayload.status,
              documentNumber: createPayload.documentNumber,
              documentDate: createPayload.documentDate,
              gstSettingsId: createPayload.gstSettingsId,
              shopifyOrderId: createPayload.shopifyOrderId,
              shopifyOrderName: createPayload.shopifyOrderName,
              sourceOrderId: createPayload.sourceOrderId,
              sourceOrderNumber: createPayload.sourceOrderNumber,
              sourceReference: createPayload.sourceReference,
              supplyType: createPayload.supplyType,
              placeOfSupplyStateCode: createPayload.placeOfSupplyStateCode,
              isInterstate: createPayload.isInterstate,
              currency: createPayload.currency,
              taxableAmount: createPayload.taxableAmount,
              cgstAmount: createPayload.cgstAmount,
              sgstAmount: createPayload.sgstAmount,
              igstAmount: createPayload.igstAmount,
              cessAmount: createPayload.cessAmount,
              totalAmount: createPayload.totalAmount,
              jsonSnapshot: createPayload.jsonSnapshot,
              metadata: createPayload.metadata,
              updatedAt: createPayload.updatedAt,
            },
          });
        } catch (error) {
          diagnosticState.gstDocumentCreateFailedReason = error instanceof Error ? error.message : String(error);
          throw error;
        }

        resolvedDocument = {
          id: createdDocument.id,
          documentNumber: createdDocument.documentNumber,
        };
      }

      if (!resolvedDocument) {
        throw new Error("Failed to persist GstDocument");
      }

      const lineColumns = await txWithRaw.$queryRaw<GstColumnInfo[]>(Prisma.sql`
        SELECT column_name, is_nullable, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'GstDocumentLine'
        ORDER BY ordinal_position
      `);

      const { rows: lineRows, missingRequiredColumns } = buildGstDocumentLineInsertRows({
        documentId: resolvedDocument.id,
        taxLines: taxData.lines as unknown as Array<Record<string, unknown>>,
        sourceLines: input.lines as unknown as Array<Record<string, unknown>>,
        dbColumns: lineColumns,
      });

      console.info("[GST DEBUG][INVOICE][DB_SCHEMA][GstDocumentLine]", {
        columns: lineColumns,
        firstLinePayloadKeys: Object.keys(lineRows[0] || {}).sort(),
      });

      if (missingRequiredColumns.length > 0) {
        throw new Error(
          `GstDocumentLine createPayload missing required DB column(s): ${missingRequiredColumns.join(", ")}`
        );
      }

      const requiresLegacyLineInsert = lineColumns.some(
        (column) => !GST_DOCUMENT_LINE_PRISMA_COLUMNS.has(column.column_name)
      );

      if (requiresLegacyLineInsert) {
        const dbColumnSet = new Set(lineColumns.map((column) => column.column_name));

        for (const row of lineRows) {
          const insertColumns = Object.keys(row).filter((columnName) => dbColumnSet.has(columnName));
          const insertValues = insertColumns.map((columnName) => row[columnName]);

          await txWithRaw.$executeRaw(Prisma.sql`
            INSERT INTO "GstDocumentLine" (
              ${Prisma.join(insertColumns.map((columnName) => Prisma.raw(`"${columnName}"`)), ", ")}
            ) VALUES (
              ${Prisma.join(insertValues)}
            )
          `);
        }
      } else {
        await tx.gstDocumentLine.createMany({
          data: lineRows.map((row) => ({
            id: String(row.id),
            gstDocumentId: String(row.gstDocumentId),
            lineNumber: Number(row.lineNumber),
            description: String(row.description || ""),
            hsnOrSac: row.hsnOrSac ? String(row.hsnOrSac) : null,
            quantity: row.quantity,
            unit: row.unit ? String(row.unit) : null,
            unitPrice: row.unitPrice,
            discount: row.discount,
            taxableAmount: row.taxableAmount,
            taxRate: row.taxRate,
            cgstAmount: row.cgstAmount,
            sgstAmount: row.sgstAmount,
            igstAmount: row.igstAmount,
            cessAmount: row.cessAmount,
            lineTotal: row.lineTotal,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
        });
      }

      return resolvedDocument;
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
