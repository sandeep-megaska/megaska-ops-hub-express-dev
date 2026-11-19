// GST adjustments for orders that stopped being plain sales, run when the B2C
// sales register is prepared (after its order sync has refreshed each order's
// status from Shopify):
//
// - Voided orders (cancelled before anything was paid) are not a supply: they
//   are not invoiced, and an invoice already made for one is cancelled.
// - Fully refunded orders keep their invoice and get a credit note dated on the
//   refund, so the register nets them out (as GSTR-1 expects).
// - Partially refunded orders are flagged: which items were refunded is not
//   known here, so the credit note is left to the team.

import { gstDb } from "../db";
import { writeGstAuditLog } from "../audit";
import type { buildNoteDraft } from "../notes";
import type { ReportWarning } from "./types";
import { classifyOrderForGst, refundDateOf, type GstOrderClass } from "./order-status";

export type PeriodOrder = {
  id: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  snapshot: unknown;
  gstClass: GstOrderClass;
};

type DocumentRow = Record<string, unknown> & { id: string; documentNumber: string };

export type AdjustmentDb = {
  gstOrderImport: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  gstDocument: {
    findMany: (args: unknown) => Promise<DocumentRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export type AdjustmentDeps = {
  db?: AdjustmentDb;
  createCreditNote?: typeof buildNoteDraft;
  audit?: typeof writeGstAuditLog;
  now?: () => Date;
};

const LIVE_STATUSES = ["DRAFT", "ISSUED"];

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/** The shop's imported orders placed in the period, each classified for GST. */
export async function loadPeriodOrders(
  input: { shopId: string; periodStart: Date; periodEnd: Date },
  db: AdjustmentDb = gstDb as unknown as AdjustmentDb,
): Promise<PeriodOrder[]> {
  const rows = await db.gstOrderImport.findMany({
    where: { shopId: input.shopId, orderCreatedAt: { gte: input.periodStart, lte: input.periodEnd } },
    select: { id: true, shopifyOrderId: true, shopifyOrderName: true, snapshot: true },
  });
  return rows.map((row) => ({
    id: str(row.id),
    shopifyOrderId: str(row.shopifyOrderId),
    shopifyOrderName: str(row.shopifyOrderName),
    snapshot: row.snapshot,
    gstClass: classifyOrderForGst(row.snapshot),
  }));
}

function warning(code: ReportWarning["code"], message: string): ReportWarning {
  return { code, message, documentId: "", documentNumber: "" };
}

export async function applyGstOrderAdjustments(
  input: { shopId: string; gstSettingsId: string; orders: PeriodOrder[] },
  deps: AdjustmentDeps = {},
): Promise<{ cancelled: string[]; creditNotes: string[]; warnings: ReportWarning[] }> {
  const db = deps.db ?? (gstDb as unknown as AdjustmentDb);
  // Loaded on first use: the notes module pulls in the generated Prisma client.
  const createCreditNote: typeof buildNoteDraft =
    deps.createCreditNote ?? (async (noteInput) => (await import("../notes")).buildNoteDraft(noteInput));
  const audit = deps.audit ?? writeGstAuditLog;
  const now = deps.now ?? (() => new Date());
  const cancelled: string[] = [];
  const creditNotes: string[] = [];
  const warnings: ReportWarning[] = [];

  const byClass = (gstClass: GstOrderClass) => input.orders.filter((order) => order.gstClass === gstClass);
  const invoicesFor = (orders: PeriodOrder[]) =>
    orders.length
      ? db.gstDocument.findMany({
          where: { shopId: input.shopId, documentType: "TAX_INVOICE", sourceOrderId: { in: orders.map((order) => order.id) }, status: { in: LIVE_STATUSES } },
          select: { id: true, documentNumber: true, status: true, metadata: true, sourceOrderId: true, sourceOrderNumber: true, shopifyOrderId: true, shopifyOrderName: true },
        })
      : Promise.resolve([] as DocumentRow[]);

  // 1. Voided orders: cancel their invoices.
  for (const invoice of await invoicesFor(byClass("VOID"))) {
    const at = now().toISOString();
    const metadata = typeof invoice.metadata === "object" && invoice.metadata !== null ? (invoice.metadata as Record<string, unknown>) : {};
    await db.gstDocument.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED", metadata: { ...metadata, cancellation: { reason: "ORDER_VOIDED", at } } },
    });
    await audit(
      { action: "GST_DOCUMENT_CANCELLED", gstSettingsId: input.gstSettingsId, gstDocumentId: invoice.id, previousState: { status: invoice.status }, nextState: { status: "CANCELLED", reason: "ORDER_VOIDED" } },
      { actorType: "SYSTEM" },
    );
    cancelled.push(invoice.documentNumber);
  }
  if (cancelled.length) {
    warnings.push(warning("INVOICES_CANCELLED_FOR_VOIDED_ORDERS", `${cancelled.length} invoice(s) cancelled because the order was voided (nothing was paid): ${cancelled.join(", ")}`));
  }

  // 2. Refunded orders: a full credit note for each invoice that has none yet.
  const refunded = byClass("REFUNDED");
  const refundedInvoices = await invoicesFor(refunded);
  const existingNotes = refundedInvoices.length
    ? await db.gstDocument.findMany({
        where: { shopId: input.shopId, documentType: "CREDIT_NOTE", originalDocumentId: { in: refundedInvoices.map((invoice) => invoice.id) }, status: { in: LIVE_STATUSES } },
        select: { id: true, documentNumber: true, originalDocumentId: true },
      })
    : [];
  const credited = new Set(existingNotes.map((note) => str(note.originalDocumentId)));
  const orderById = new Map(refunded.map((order) => [order.id, order]));
  for (const invoice of refundedInvoices) {
    if (credited.has(invoice.id)) continue;
    const order = orderById.get(str(invoice.sourceOrderId));
    const note = await createCreditNote({
      noteType: "CREDIT_NOTE",
      originalDocumentId: invoice.id,
      shopId: input.shopId,
      gstSettingsId: input.gstSettingsId,
      documentDate: (order && refundDateOf(order.snapshot)) || now(),
      sourceOrderId: str(invoice.sourceOrderId) || undefined,
      sourceOrderNumber: str(invoice.sourceOrderNumber) || undefined,
      sourceReference: "GST_REFUND_AUTO",
      shopifyOrderId: str(invoice.shopifyOrderId) || undefined,
      shopifyOrderName: str(invoice.shopifyOrderName) || undefined,
      lines: [],
      metadata: { autoCreditNote: true, reason: "ORDER_REFUNDED", originalDocumentNumber: invoice.documentNumber },
    });
    if (note.ok && note.data) {
      creditNotes.push(`${note.data.documentNumber} (for ${invoice.documentNumber})`);
    } else {
      warnings.push(warning("CREDIT_NOTE_FAILED", `Could not create the credit note for refunded invoice ${invoice.documentNumber}: ${note.error || "unknown error"}`));
    }
  }
  if (creditNotes.length) {
    warnings.push(warning("CREDIT_NOTES_CREATED_FOR_REFUNDS", `${creditNotes.length} credit note(s) created for refunded orders: ${creditNotes.join(", ")}`));
  }

  // 3. Partially refunded orders: the team issues the credit note for the refunded items.
  const partial = byClass("PARTIALLY_REFUNDED");
  if (partial.length) {
    const partialInvoices = await invoicesFor(partial);
    const partialNotes = partialInvoices.length
      ? await db.gstDocument.findMany({
          where: { shopId: input.shopId, documentType: "CREDIT_NOTE", originalDocumentId: { in: partialInvoices.map((invoice) => invoice.id) }, status: { in: LIVE_STATUSES } },
          select: { id: true, originalDocumentId: true },
        })
      : [];
    const withNote = new Set(partialNotes.map((note) => str(note.originalDocumentId)));
    const missing = partialInvoices.filter((invoice) => !withNote.has(invoice.id)).map((invoice) => `${invoice.documentNumber} (order ${str(invoice.shopifyOrderName) || str(invoice.sourceOrderNumber)})`);
    if (missing.length) {
      warnings.push(warning("PARTIAL_REFUND_NEEDS_CREDIT_NOTE", `${missing.length} partly refunded order(s) need a credit note for the refunded items: ${missing.join(", ")}`));
    }
  }

  return { cancelled, creditNotes, warnings };
}
