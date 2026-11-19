import test from "node:test";
import assert from "node:assert/strict";

import { gstDb } from "../db.ts";
import { csvEscape, toCsv, formatDateDdMmYyyy } from "./csv.ts";
import { buildB2cSalesRegisterExport, generateB2cSalesRegisterCsv, B2C_SALES_REGISTER_HEADERS } from "./b2c-sales-register.ts";

const originalFindMany = gstDb.gstDocument.findMany;
const originalCount = gstDb.gstDocument.count;
const originalFindFirst = gstDb.gstDocument.findFirst;
// The order imports the register reads statuses from (not on GstPrismaClient's type).
const importDb = gstDb as unknown as { gstOrderImport: { findMany: (args: unknown) => Promise<unknown> } };
const originalImportFindMany = importDb.gstOrderImport.findMany;

test.afterEach(() => {
  gstDb.gstDocument.findMany = originalFindMany;
  gstDb.gstDocument.count = originalCount;
  gstDb.gstDocument.findFirst = originalFindFirst;
  importDb.gstOrderImport.findMany = originalImportFindMany;
});

test("csvEscape quotes commas, quotes, and newlines", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('a"b'), '"a""b"');
  assert.equal(csvEscape("a\nb"), '"a\nb"');
});

test("toCsv keeps stable column order", () => {
  const csv = toCsv(["col1", "col2"], [["a", "b"], ["c", "d"]]);
  assert.equal(csv, "col1,col2\r\na,b\r\nc,d");
});

test("formatDateDdMmYyyy formats UTC date", () => {
  assert.equal(formatDateDdMmYyyy(new Date("2026-04-07T23:59:59.000Z")), "07-04-2026");
});

test("generateB2cSalesRegisterCsv uses GstDocument + snapshot line values", async () => {
  gstDb.gstDocument.count = async () => 1 as never;
  gstDb.gstDocument.findFirst = async () => ({ id: "sample" }) as never;
  gstDb.gstDocument.findMany = async () =>
    [
      {
        id: "doc-1",
        documentNumber: "INV-001",
        documentDate: new Date("2026-04-10T00:00:00.000Z"),
        sourceOrderNumber: "#1001",
        shopifyOrderName: "#1001",
        placeOfSupplyStateCode: "27",
        taxableAmount: "100.00",
        cgstAmount: "9.00",
        sgstAmount: "9.00",
        igstAmount: "0.00",
        cessAmount: "0.00",
        totalAmount: "118.00",
        jsonSnapshot: {
          buyer: { legalName: "John Doe" },
          lines: [
            {
              productName: "T-Shirt",
              variantName: "XL / Blue",
              hsnOrSac: "6109",
              quantity: "1",
              unitPrice: "100",
              taxRate: "18",
              cgstAmount: "9",
              sgstAmount: "9",
              igstAmount: "0",
              cessAmount: "0",
              lineTotal: "118",
            },
          ],
        },
        lines: [],
      },
    ] as never;

  const result = await generateB2cSalesRegisterCsv({
    gstSettingsId: "gst-settings-1",
    periodStart: new Date("2026-04-01T00:00:00.000Z"),
    periodEnd: new Date("2026-04-30T23:59:59.999Z"),
  });

  assert.equal(result.rowCount, 1);
  assert.match(result.csv, /2026-04-10/);
  assert.match(result.csv, /INV-001/);
  assert.match(result.csv, /T-Shirt/);
  assert.equal(result.warnings.some((warning) => warning.code === "MISSING_CUSTOMER_NAME"), false);
});

test("buildB2cSalesRegisterExport exposes stable B2C data shape", async () => {
  gstDb.gstDocument.count = async () => 0 as never;
  gstDb.gstDocument.findFirst = async () => null as never;
  gstDb.gstDocument.findMany = async () => [] as never;

  const result = await buildB2cSalesRegisterExport({
    gstSettingsId: "gst-settings-1",
    periodStart: new Date("2026-04-01T00:00:00.000Z"),
    periodEnd: new Date("2026-04-30T23:59:59.999Z"),
  });

  assert.equal(result.reportType, "B2C_SALES_REGISTER");
  assert.deepEqual(result.headers, B2C_SALES_REGISTER_HEADERS);
  assert.equal(result.rowCount, 0);
  assert.equal(result.csv, B2C_SALES_REGISTER_HEADERS.join(","));
  assert.equal(result.warnings.some((warning) => warning.code === "NO_INVOICES_IN_RANGE"), true);
});

test("credit notes are netted negative and carry a Document Type", async () => {
  gstDb.gstDocument.count = async () => 1 as never;
  gstDb.gstDocument.findFirst = async () => ({ id: "sample" }) as never;
  gstDb.gstDocument.findMany = async () =>
    [
      {
        id: "cn-1",
        documentNumber: "CN-001",
        documentType: "CREDIT_NOTE",
        documentDate: new Date("2026-04-12T00:00:00.000Z"),
        sourceOrderNumber: "#1001",
        shopifyOrderName: "#1001",
        placeOfSupplyStateCode: "27",
        taxableAmount: "100.00",
        cgstAmount: "9.00",
        sgstAmount: "9.00",
        igstAmount: "0.00",
        cessAmount: "0.00",
        totalAmount: "118.00",
        jsonSnapshot: {
          buyer: { legalName: "John Doe" },
          lines: [
            {
              productName: "T-Shirt",
              hsnOrSac: "6109",
              quantity: "1",
              unitPrice: "100",
              taxRate: "18",
              cgstAmount: "9",
              sgstAmount: "9",
              igstAmount: "0",
              cessAmount: "0",
              lineTotal: "118",
            },
          ],
        },
        lines: [],
      },
    ] as never;

  const result = await buildB2cSalesRegisterExport({
    gstSettingsId: "gst-settings-1",
    periodStart: new Date("2026-04-01T00:00:00.000Z"),
    periodEnd: new Date("2026-04-30T23:59:59.999Z"),
  });

  assert.equal(result.rowCount, 1);
  const row = result.rows[0];
  assert.equal(row.documentType, "CREDIT_NOTE");
  assert.equal(row.cgst, -9);
  assert.equal(row.sgst, -9);
  assert.equal(row.total, -118);
  assert.equal(row.quantity, -1);
  assert.match(result.csv, /CN-001/);
});

// From the October 2026 comparison with GST Pro: order 2405 (placed 2 Oct 00:30 IST),
// IGST 5% inter-state, COD.
test("register rows use India-time dates, taxable value as Price, and the order's current status", async () => {
  gstDb.gstDocument.findMany = async () =>
    [
      {
        id: "doc-2405",
        documentNumber: "INV/26-27/00733",
        documentType: "TAX_INVOICE",
        documentDate: new Date("2026-10-01T19:00:00.000Z"),
        sourceOrderId: "imp-2405",
        sourceOrderNumber: "522405",
        shopifyOrderName: "522405",
        placeOfSupplyStateCode: "33",
        taxableAmount: "805.48",
        cgstAmount: "0",
        sgstAmount: "0",
        igstAmount: "40.27",
        cessAmount: "0",
        totalAmount: "845.75",
        jsonSnapshot: {
          buyer: { legalName: "SATHYAMANI SEKKILAR" },
          lines: [
            { description: "MBKS10-Wine-M • Block Color Lycra Front Tie Knot Ruched Frock Style Padded One Piece Swim Dress", hsnOrSac: "61124990", quantity: 1, unitPrice: 845.75, taxRate: 5, taxableAmount: 805.48, cgstAmount: 0, sgstAmount: 0, igstAmount: 40.27, cessAmount: 0, lineTotal: 845.75 },
          ],
        },
        lines: [],
      },
    ] as never;
  importDb.gstOrderImport.findMany = (async () => [
    {
      id: "imp-2405",
      snapshot: {
        financialStatus: "PAID",
        fulfillmentStatus: "FULFILLED",
        paymentGateway: "Razorpay Secure",
        lines: [{ shopifyLineItemId: "1", sku: "MBKS10-Wine-M", variantTitle: "M / Wine / Lycra" }],
      },
    },
  ]) as never;

  const result = await buildB2cSalesRegisterExport({
    gstSettingsId: "gst-settings-1",
    shopId: "shop-1",
    periodStart: new Date("2026-09-30T18:30:00.000Z"),
    periodEnd: new Date("2026-10-31T18:29:59.999Z"),
  });

  const [row] = result.rows;
  assert.equal(row.invoiceDate, "2026-10-02");
  assert.equal(row.price, 805.48);
  assert.equal(Math.round((row.price + row.igst + row.cgst + row.sgst + row.cess) * 100) / 100, row.total);
  assert.equal(row.variant, "M / Wine / Lycra");
  assert.equal(row.itemType, "Product");
  assert.equal(row.paymentStatus, "PAID");
  assert.equal(row.paymentGateway, "Razorpay Secure");
  assert.equal(row.fulfillmentStatus, "FULFILLED");
});

test("older snapshots without a taxable amount get it from total less tax; credit notes negate it", async () => {
  gstDb.gstDocument.findMany = async () =>
    [
      {
        id: "cn-2415",
        documentNumber: "CN/26-27/00001",
        documentType: "CREDIT_NOTE",
        documentDate: new Date("2026-10-14T06:00:00.000Z"),
        sourceOrderNumber: "522415",
        shopifyOrderName: "522415",
        placeOfSupplyStateCode: "15",
        taxableAmount: "800.62",
        cgstAmount: "0",
        sgstAmount: "0",
        igstAmount: "40.03",
        cessAmount: "0",
        totalAmount: "840.65",
        jsonSnapshot: {
          buyer: { legalName: "Lalthangmawii Chhangte" },
          lines: [{ description: "MWSW17-Navy-XL • Tummy Control One Piece", hsnOrSac: "61124990", quantity: 1, unitPrice: 840.65, taxRate: 5, igstAmount: 40.03, cgstAmount: 0, sgstAmount: 0, cessAmount: 0, lineTotal: 840.65 }],
          metadata: { orderSnapshot: { financialStatus: "REFUNDED", paymentGateway: "Razorpay Secure", fulfillmentStatus: "UNFULFILLED" } },
        },
        lines: [],
      },
    ] as never;

  const result = await buildB2cSalesRegisterExport({
    gstSettingsId: "gst-settings-1",
    periodStart: new Date("2026-09-30T18:30:00.000Z"),
    periodEnd: new Date("2026-10-31T18:29:59.999Z"),
  });

  const [row] = result.rows;
  assert.equal(row.price, -800.62);
  assert.equal(row.total, -840.65);
  // No order import for it: falls back to the status saved on the document.
  assert.equal(row.paymentStatus, "REFUNDED");
  assert.equal(row.paymentGateway, "Razorpay Secure");
});
