import test from "node:test";
import assert from "node:assert/strict";

import { gstDb } from "../db.ts";
import { csvEscape, toCsv, formatDateDdMmYyyy } from "./csv.ts";
import { buildB2cSalesRegisterExport, generateB2cSalesRegisterCsv, B2C_SALES_REGISTER_HEADERS } from "./b2c-sales-register.ts";

const originalFindMany = gstDb.gstDocument.findMany;
const originalCount = gstDb.gstDocument.count;
const originalFindFirst = gstDb.gstDocument.findFirst;

test.afterEach(() => {
  gstDb.gstDocument.findMany = originalFindMany;
  gstDb.gstDocument.count = originalCount;
  gstDb.gstDocument.findFirst = originalFindFirst;
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
