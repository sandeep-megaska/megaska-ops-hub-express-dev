import { Prisma } from "../../generated/prisma";
import { gstDb } from "./db";
import type { GstTaxLineComputation } from "./tax-engine";

/*
  Single, shop-scoped persistence path for every GstDocument (tax invoices AND
  credit/debit notes). Both writers MUST go through here so they can never
  diverge again.

  It is column-aware: the production database is a legacy schema whose
  GstDocument / GstDocumentLine tables carry extra NOT NULL columns that are not
  in the Prisma baseline (settingsId, issueDate, subtotalAmount, and the
  taxRateType enum on lines). We introspect information_schema at write time and
  only ever insert columns that actually exist, so the same code works against
  both the clean Prisma schema (dev/preview) and the legacy production schema.
*/

export interface GstColumnInfo {
  column_name: string;
  is_nullable: "YES" | "NO";
  data_type: string;
  column_default: string | null;
}

export interface NormalizedGstDocument {
  id: string;
  documentType: string;
  status: string;
  documentNumber: string;
  documentDate: Date;
  gstSettingsId: string;
  shopId: string;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
  sourceOrderId: string | null;
  sourceOrderNumber: string | null;
  sourceReference: string | null;
  originalDocumentId: string | null;
  supplyType: string;
  placeOfSupplyStateCode: string;
  isInterstate: boolean;
  currency: string;
  taxableAmount: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
  cessAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  jsonSnapshot: unknown;
  metadata: unknown;
  updatedAt: Date;
}

export interface PersistGstDocumentInput {
  document: NormalizedGstDocument;
  taxLines: GstTaxLineComputation[];
  /** Original input lines, used only to recover a per-line sku for legacy columns. */
  sourceLines?: Array<Record<string, unknown>>;
}

const GST_DOCUMENT_REQUIRED_FIELDS = [
  "documentType",
  "status",
  "documentNumber",
  "documentDate",
  "gstSettingsId",
  "shopId",
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

const GST_DOCUMENT_LINE_PRISMA_COLUMNS = new Set([
  "id",
  "gstDocumentId",
  "shopId",
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

export function generateUuid(): string {
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

function isValidDecimalValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value instanceof Prisma.Decimal) return value.isFinite();
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

/*
  Production DB has a legacy enum column taxRateType (NOT NULL) on GstDocumentLine
  that is not in the generated Prisma schema. Valid enum values are NIL, ZERO,
  GST_003, GST_005, GST_012, GST_018, and GST_028.
*/
function toGstTaxRateType(rateValue: unknown): string {
  const rate = Number(rateValue);
  if (!Number.isFinite(rate) || rate <= 0) return "ZERO";

  const rounded = Math.round(rate * 100) / 100;
  if (rounded === 3) return "GST_003";
  if (rounded === 5) return "GST_005";
  if (rounded === 12) return "GST_012";
  if (rounded === 18) return "GST_018";
  if (rounded === 28) return "GST_028";

  throw new Error(`Unsupported GST taxRateType for tax rate ${rate}`);
}

function pickLineSku(taxLine: Record<string, unknown>, sourceLine: Record<string, unknown>): string | null {
  return toNullableTrimmedString(
    taxLine.sku ??
      taxLine.productSku ??
      taxLine.variantSku ??
      sourceLine.sku ??
      sourceLine.productSku ??
      sourceLine.variantSku,
  );
}

function getRequiredColumnsWithoutDefault(columns: GstColumnInfo[]): string[] {
  return columns
    .filter((col) => col.is_nullable === "NO" && col.column_default === null)
    .map((col) => col.column_name);
}

function validateDocumentValues(doc: NormalizedGstDocument): string[] {
  const errors: string[] = [];
  for (const field of GST_DOCUMENT_REQUIRED_FIELDS) {
    const value = (doc as unknown as Record<string, unknown>)[field];

    if (value === null || value === undefined) {
      errors.push(`${field}: value is ${value === null ? "null" : "undefined"}`);
      continue;
    }

    if (
      (field === "documentType" ||
        field === "status" ||
        field === "documentNumber" ||
        field === "gstSettingsId" ||
        field === "shopId" ||
        field === "supplyType" ||
        field === "placeOfSupplyStateCode" ||
        field === "currency") &&
      String(value).trim().length === 0
    ) {
      errors.push(`${field}: value is empty`);
      continue;
    }

    if (field === "documentDate" && !(value instanceof Date && !Number.isNaN(value.getTime()))) {
      errors.push(`${field}: invalid Date value`);
      continue;
    }

    if (field === "isInterstate" && typeof value !== "boolean") {
      errors.push(`${field}: expected boolean, got ${typeof value}`);
      continue;
    }

    if (
      (field === "taxableAmount" ||
        field === "cgstAmount" ||
        field === "sgstAmount" ||
        field === "igstAmount" ||
        field === "cessAmount" ||
        field === "totalAmount") &&
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

function buildDocumentColumnCandidates(
  doc: NormalizedGstDocument,
): Array<{ column: string; value: unknown; json?: boolean }> {
  return [
    { column: "id", value: doc.id },
    { column: "documentType", value: doc.documentType },
    { column: "status", value: doc.status },
    { column: "documentNumber", value: doc.documentNumber },
    { column: "documentDate", value: doc.documentDate },
    { column: "gstSettingsId", value: doc.gstSettingsId },
    { column: "shopId", value: doc.shopId },
    { column: "shopifyOrderId", value: doc.shopifyOrderId },
    { column: "shopifyOrderName", value: doc.shopifyOrderName },
    { column: "sourceOrderId", value: doc.sourceOrderId },
    { column: "sourceOrderNumber", value: doc.sourceOrderNumber },
    { column: "sourceReference", value: doc.sourceReference },
    { column: "originalDocumentId", value: doc.originalDocumentId },
    { column: "supplyType", value: doc.supplyType },
    { column: "placeOfSupplyStateCode", value: doc.placeOfSupplyStateCode },
    { column: "isInterstate", value: doc.isInterstate },
    { column: "currency", value: doc.currency },
    { column: "taxableAmount", value: doc.taxableAmount },
    { column: "cgstAmount", value: doc.cgstAmount },
    { column: "sgstAmount", value: doc.sgstAmount },
    { column: "igstAmount", value: doc.igstAmount },
    { column: "cessAmount", value: doc.cessAmount },
    { column: "totalAmount", value: doc.totalAmount },
    { column: "jsonSnapshot", value: doc.jsonSnapshot, json: true },
    { column: "metadata", value: doc.metadata ?? {}, json: true },
    { column: "updatedAt", value: doc.updatedAt },
    // Legacy production-only compatibility columns (inserted only where present).
    { column: "settingsId", value: doc.gstSettingsId },
    { column: "issueDate", value: doc.documentDate },
    { column: "subtotalAmount", value: doc.taxableAmount },
  ];
}

/**
 * Persist a GstDocument and its lines inside one transaction, tolerating both the
 * clean Prisma schema and the legacy production schema. Returns the created
 * document identity. Throws with a descriptive message on any failure.
 */
export async function persistGstDocumentWithLines(
  input: PersistGstDocumentInput,
): Promise<{ id: string; documentNumber: string }> {
  const { document, taxLines, sourceLines = [] } = input;

  const valueErrors = validateDocumentValues(document);
  if (valueErrors.length > 0) {
    throw new Error(`GST document payload validation failed: ${valueErrors.join("; ")}`);
  }

  return gstDb.$transaction(async (tx) => {
    const txRaw = tx as typeof tx & {
      $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>;
      $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<number>;
    };

    // --- Document ---
    const documentColumns = await txRaw.$queryRaw<GstColumnInfo[]>(Prisma.sql`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'GstDocument'
      ORDER BY ordinal_position
    `);
    const documentColumnSet = new Set(documentColumns.map((col) => col.column_name));

    const candidates = buildDocumentColumnCandidates(document).filter((candidate) =>
      documentColumnSet.has(candidate.column),
    );

    const providedNonNullColumns = new Set(
      candidates.filter((candidate) => candidate.value !== null && candidate.value !== undefined).map((c) => c.column),
    );
    const missingRequired = getRequiredColumnsWithoutDefault(documentColumns).filter(
      (column) => !providedNonNullColumns.has(column),
    );
    if (missingRequired.length > 0) {
      throw new Error(`GstDocument insert missing required DB column(s): ${missingRequired.join(", ")}`);
    }

    const columnFragments = candidates.map((candidate) => Prisma.raw(`"${candidate.column}"`));
    const valueFragments = candidates.map((candidate) =>
      candidate.json ? Prisma.sql`${JSON.stringify(candidate.value)}::jsonb` : Prisma.sql`${candidate.value}`,
    );

    const insertedDocuments = await txRaw.$queryRaw<Array<{ id: string; documentNumber: string }>>(Prisma.sql`
      INSERT INTO "GstDocument" (${Prisma.join(columnFragments, ", ")})
      VALUES (${Prisma.join(valueFragments, ", ")})
      RETURNING "id", "documentNumber"
    `);
    const created = insertedDocuments[0];
    if (!created) {
      throw new Error("Failed to persist GstDocument");
    }

    // --- Lines ---
    const lineColumns = await txRaw.$queryRaw<GstColumnInfo[]>(Prisma.sql`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'GstDocumentLine'
      ORDER BY ordinal_position
    `);
    const lineColumnSet = new Set(lineColumns.map((col) => col.column_name));
    const now = new Date();

    const lineRows = taxLines.map((line, index) => {
      const sourceLine = (sourceLines[index] || {}) as Record<string, unknown>;
      const taxLine = line as unknown as Record<string, unknown>;
      const row: Record<string, string | number | boolean | Date | Prisma.Decimal | null> = {
        id: generateUuid(),
        gstDocumentId: created.id,
        shopId: document.shopId,
        lineNumber: Number(line.lineNumber || index + 1),
        description: String(line.description ?? sourceLine.description ?? `Line ${index + 1}`),
        hsnOrSac: toNullableTrimmedString(line.hsnOrSac ?? sourceLine.hsnOrSac ?? sourceLine.hsnCode),
        quantity: new Prisma.Decimal(Number(line.quantity ?? 0)),
        unit: toNullableTrimmedString(line.unit ?? sourceLine.unit),
        unitPrice: new Prisma.Decimal(Number(line.unitPrice ?? 0)),
        discount: new Prisma.Decimal(Number(line.discount ?? 0)),
        taxableAmount: new Prisma.Decimal(Number(line.taxableAmount ?? 0)),
        taxRate: new Prisma.Decimal(Number(line.taxRate ?? 0)),
        cgstAmount: new Prisma.Decimal(Number(line.cgstAmount ?? 0)),
        sgstAmount: new Prisma.Decimal(Number(line.sgstAmount ?? 0)),
        igstAmount: new Prisma.Decimal(Number(line.igstAmount ?? 0)),
        cessAmount: new Prisma.Decimal(Number(line.cessAmount ?? 0)),
        lineTotal: new Prisma.Decimal(Number(line.lineTotal ?? 0)),
        createdAt: now,
        updatedAt: now,
      };

      // Legacy production-only columns, inserted only where the DB has them.
      if (lineColumnSet.has("taxRateType")) row.taxRateType = toGstTaxRateType(row.taxRate);
      if (lineColumnSet.has("documentId")) row.documentId = created.id;
      if (lineColumnSet.has("itemName")) row.itemName = row.description;
      if (lineColumnSet.has("productName")) row.productName = row.description;
      if (lineColumnSet.has("title")) row.title = row.description;
      if (lineColumnSet.has("sku")) row.sku = pickLineSku(taxLine, sourceLine);
      if (lineColumnSet.has("hsnCode")) row.hsnCode = row.hsnOrSac;
      if (lineColumnSet.has("taxRatePercent")) row.taxRatePercent = row.taxRate;
      if (lineColumnSet.has("discountAmount")) row.discountAmount = row.discount;
      if (lineColumnSet.has("totalAmount")) row.totalAmount = row.lineTotal;
      if (lineColumnSet.has("grossAmount")) row.grossAmount = row.lineTotal;

      return row;
    });

    const requiredLineColumns = getRequiredColumnsWithoutDefault(lineColumns);
    const missingLineColumns = requiredLineColumns.filter((column) =>
      lineRows.some((row) => row[column] === undefined || row[column] === null),
    );
    if (missingLineColumns.length > 0) {
      throw new Error(`GstDocumentLine insert missing required DB column(s): ${missingLineColumns.join(", ")}`);
    }

    const usesOnlyPrismaLineColumns = lineColumns.every((column) =>
      GST_DOCUMENT_LINE_PRISMA_COLUMNS.has(column.column_name),
    );

    if (usesOnlyPrismaLineColumns) {
      await tx.gstDocumentLine.createMany({
        data: lineRows.map((row) => ({
          id: String(row.id),
          gstDocumentId: String(row.gstDocumentId),
          shopId: String(row.shopId),
          lineNumber: Number(row.lineNumber),
          description: String(row.description || ""),
          hsnOrSac: row.hsnOrSac ? String(row.hsnOrSac) : null,
          quantity: row.quantity as Prisma.Decimal,
          unit: row.unit ? String(row.unit) : null,
          unitPrice: row.unitPrice as Prisma.Decimal,
          discount: row.discount as Prisma.Decimal,
          taxableAmount: row.taxableAmount as Prisma.Decimal,
          taxRate: row.taxRate as Prisma.Decimal,
          cgstAmount: row.cgstAmount as Prisma.Decimal,
          sgstAmount: row.sgstAmount as Prisma.Decimal,
          igstAmount: row.igstAmount as Prisma.Decimal,
          cessAmount: row.cessAmount as Prisma.Decimal,
          lineTotal: row.lineTotal as Prisma.Decimal,
          createdAt: row.createdAt as Date,
          updatedAt: row.updatedAt as Date,
        })),
      });
    } else {
      for (const row of lineRows) {
        const insertColumns = Object.keys(row).filter((columnName) => lineColumnSet.has(columnName));
        const insertValues = insertColumns.map((columnName) => row[columnName]);
        await txRaw.$executeRaw(Prisma.sql`
          INSERT INTO "GstDocumentLine" (
            ${Prisma.join(insertColumns.map((columnName) => Prisma.raw(`"${columnName}"`)), ", ")}
          ) VALUES (
            ${Prisma.join(insertValues)}
          )
        `);
      }
    }

    return created;
  });
}
