import test from "node:test";
import assert from "node:assert/strict";

import { classifyOrderForGst, istDateString, istDayEnd, istDayStart, itemTypeForHsn, refundDateOf } from "./order-status.ts";
import { applyGstOrderAdjustments, type AdjustmentDb, type PeriodOrder } from "./order-adjustments.ts";
import { mergeOrderStatusIntoSnapshot } from "../order-sync.ts";

// Cases from the October 2026 comparison with GST Pro's GSTR-1.
test("orders are classified for GST from their Shopify status", () => {
  assert.equal(classifyOrderForGst({ financialStatus: "PAID" }), "SALE");
  // COD not yet collected, not cancelled: still a sale.
  assert.equal(classifyOrderForGst({ financialStatus: "PENDING", fulfillmentStatus: "FULFILLED" }), "SALE");
  // Orders 2459, 2467, 2496: voided, nothing paid.
  assert.equal(classifyOrderForGst({ financialStatus: "VOIDED", cancelledAt: "2026-10-15T05:00:00Z" }), "VOID");
  assert.equal(classifyOrderForGst({ financialStatus: "PENDING", cancelledAt: "2026-10-15T05:00:00Z" }), "VOID");
  // Orders 2415, 2416: paid, then refunded.
  assert.equal(classifyOrderForGst({ financialStatus: "REFUNDED", cancelledAt: "2026-10-14T05:00:00Z" }), "REFUNDED");
  assert.equal(classifyOrderForGst({ financialStatus: "PARTIALLY_REFUNDED" }), "PARTIALLY_REFUNDED");
  // Imported before statuses were kept: unchanged behaviour.
  assert.equal(classifyOrderForGst({}), "SALE");
  assert.equal(classifyOrderForGst(null), "SALE");
});

test("dates and period bounds are India time", () => {
  // Order 2405: placed 2 Oct 00:30 IST, which is still 1 Oct in UTC.
  assert.equal(istDateString(new Date("2026-10-01T19:00:00.000Z")), "2026-10-02");
  assert.equal(istDateString(new Date("2026-10-01T18:29:59.999Z")), "2026-10-01");
  assert.equal(istDayStart("2026-10-01").toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(istDayEnd("2026-10-31").toISOString(), "2026-10-31T18:29:59.999Z");
});

test("refund date is the latest refund; item type follows the HSN/SAC", () => {
  assert.equal(
    refundDateOf({ refunds: [{ createdAt: "2026-10-10T06:00:00Z" }, { createdAt: "2026-10-14T06:00:00Z" }] })?.toISOString(),
    "2026-10-14T06:00:00.000Z",
  );
  assert.equal(refundDateOf({ refunds: [] }), null);
  assert.equal(itemTypeForHsn("61124990"), "Product");
  assert.equal(itemTypeForHsn("998599"), "Service");
});

test("a re-sync refreshes an imported order's status and variant titles, keeping its lines", () => {
  const merged = mergeOrderStatusIntoSnapshot(
    { shopifyOrderName: "#2459", lines: [{ shopifyLineItemId: "11", sku: "MGSW05-NavyFloralNavy-XXL", quantity: 1, unitPrice: 1280 }] },
    {
      financialStatus: "VOIDED",
      fulfillmentStatus: "UNFULFILLED",
      cancelledAt: "2026-10-15T05:00:00Z",
      paymentGateway: "Cash on Delivery (COD)",
      lines: [{ id: "11", variantTitle: "XXL / Navy Floral" }],
    },
  );
  assert.equal(merged.financialStatus, "VOIDED");
  assert.equal(merged.paymentGateway, "Cash on Delivery (COD)");
  assert.equal(merged.shopifyOrderName, "#2459");
  const [line] = merged.lines as Array<Record<string, unknown>>;
  assert.equal(line.variantTitle, "XXL / Navy Floral");
  assert.equal(line.unitPrice, 1280);
  assert.equal(classifyOrderForGst(merged), "VOID");
});

function fakeDb(documents: Array<Record<string, unknown>>) {
  const updates: Array<Record<string, unknown>> = [];
  const db: AdjustmentDb = {
    gstOrderImport: { findMany: async () => [] },
    gstDocument: {
      findMany: async (args: unknown) => {
        const where = (args as { where: Record<string, unknown> }).where;
        return documents.filter((document) => {
          if (document.documentType !== where.documentType) return false;
          if (!(where.status as { in: string[] }).in.includes(String(document.status))) return false;
          if (where.sourceOrderId) return (where.sourceOrderId as { in: string[] }).in.includes(String(document.sourceOrderId));
          if (where.originalDocumentId) return (where.originalDocumentId as { in: string[] }).in.includes(String(document.originalDocumentId));
          return true;
        }) as never;
      },
      update: async (args: unknown) => {
        updates.push(args as Record<string, unknown>);
        return {};
      },
    },
  };
  return { db, updates };
}

const order = (id: string, gstClass: PeriodOrder["gstClass"], snapshot: Record<string, unknown> = {}): PeriodOrder => ({ id, shopifyOrderId: `gid-${id}`, shopifyOrderName: `#${id}`, snapshot, gstClass });

test("voided orders' invoices are cancelled; refunded orders get one dated credit note; partial refunds are flagged", async () => {
  const { db, updates } = fakeDb([
    { id: "inv-2459", documentType: "TAX_INVOICE", status: "DRAFT", documentNumber: "INV/26-27/00787", sourceOrderId: "imp-2459", metadata: { a: 1 } },
    { id: "inv-2415", documentType: "TAX_INVOICE", status: "DRAFT", documentNumber: "INV/26-27/00743", sourceOrderId: "imp-2415", shopifyOrderName: "#2415" },
    { id: "inv-2416", documentType: "TAX_INVOICE", status: "ISSUED", documentNumber: "INV/26-27/00744", sourceOrderId: "imp-2416" },
    // 2416 already has a credit note: no second one.
    { id: "cn-1", documentType: "CREDIT_NOTE", status: "DRAFT", documentNumber: "CN/26-27/00001", originalDocumentId: "inv-2416" },
    { id: "inv-2470", documentType: "TAX_INVOICE", status: "DRAFT", documentNumber: "INV/26-27/00798", sourceOrderId: "imp-2470", shopifyOrderName: "#2470" },
    { id: "inv-2404", documentType: "TAX_INVOICE", status: "DRAFT", documentNumber: "INV/26-27/00732", sourceOrderId: "imp-2404" },
  ]);
  const notes: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];

  const result = await applyGstOrderAdjustments(
    {
      shopId: "shop-1",
      gstSettingsId: "gst-1",
      orders: [
        order("imp-2459", "VOID"),
        order("imp-2415", "REFUNDED", { refunds: [{ createdAt: "2026-10-14T06:00:00Z" }] }),
        order("imp-2416", "REFUNDED"),
        order("imp-2470", "PARTIALLY_REFUNDED"),
        order("imp-2404", "SALE"),
      ],
    },
    {
      db,
      createCreditNote: (async (input: Record<string, unknown>) => {
        notes.push(input);
        return { ok: true, data: { id: "cn-new", documentNumber: "CN/26-27/00002", documentType: "CREDIT_NOTE", status: "DRAFT" } };
      }) as never,
      audit: (async (event: Record<string, unknown>) => {
        audits.push(event);
      }) as never,
      now: () => new Date("2026-11-16T10:00:00Z"),
    },
  );

  // Voided: cancelled, reason kept, audited; nothing else touched.
  assert.deepEqual(result.cancelled, ["INV/26-27/00787"]);
  assert.equal(updates.length, 1);
  const update = updates[0] as { where: { id: string }; data: { status: string; metadata: Record<string, unknown> } };
  assert.equal(update.where.id, "inv-2459");
  assert.equal(update.data.status, "CANCELLED");
  assert.equal(update.data.metadata.a, 1);
  assert.equal((update.data.metadata.cancellation as { reason: string }).reason, "ORDER_VOIDED");
  assert.equal(audits[0].action, "GST_DOCUMENT_CANCELLED");

  // Refunded: one full credit note for 2415, dated on its refund; 2416 already has one.
  assert.equal(notes.length, 1);
  assert.equal(notes[0].originalDocumentId, "inv-2415");
  assert.equal(notes[0].noteType, "CREDIT_NOTE");
  assert.equal((notes[0].documentDate as Date).toISOString(), "2026-10-14T06:00:00.000Z");
  assert.deepEqual(notes[0].lines, []);
  assert.equal(result.creditNotes.length, 1);

  // Partly refunded: flagged for the team.
  const partial = result.warnings.find((warning) => warning.code === "PARTIAL_REFUND_NEEDS_CREDIT_NOTE");
  assert.ok(partial && partial.message.includes("INV/26-27/00798"));
});

test("a failed credit note is reported, not thrown", async () => {
  const { db } = fakeDb([{ id: "inv-1", documentType: "TAX_INVOICE", status: "DRAFT", documentNumber: "INV-1", sourceOrderId: "imp-1" }]);
  const result = await applyGstOrderAdjustments(
    { shopId: "shop-1", gstSettingsId: "gst-1", orders: [order("imp-1", "REFUNDED")] },
    { db, createCreditNote: (async () => ({ ok: false, error: "numbering failed" })) as never, audit: (async () => {}) as never },
  );
  assert.equal(result.creditNotes.length, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "CREDIT_NOTE_FAILED" && warning.message.includes("numbering failed")));
});
