import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFormattedDocumentNumber,
  counterPeriodLabel,
  legacyDocFormat,
  resolveDocFormat,
  validateDocNumberFormat,
  type DocNumberFormat,
} from "./numbering-config.ts";

const APR_2026 = new Date(Date.UTC(2026, 3, 15)); // FY 26-27
const JAN_2027 = new Date(Date.UTC(2027, 0, 10)); // still FY 26-27

function fmt(overrides: Partial<DocNumberFormat> = {}): DocNumberFormat {
  return {
    prefix: "",
    suffix: "",
    separator: "",
    minDigits: 0,
    startNumber: 1,
    resetPeriod: "CONTINUOUS",
    yearDisplay: "NONE",
    ...overrides,
  };
}

test("megaska style: plain continuous number, no prefix/padding", () => {
  assert.equal(buildFormattedDocumentNumber(fmt({ startNumber: 11205 }), APR_2026, 11205), "11205");
});

test("min-digits pads, but a longer number is left intact", () => {
  const f = fmt({ minDigits: 4 });
  assert.equal(buildFormattedDocumentNumber(f, APR_2026, 1), "0001");
  assert.equal(buildFormattedDocumentNumber(f, APR_2026, 1000), "1000");
  assert.equal(buildFormattedDocumentNumber(f, APR_2026, 12345), "12345");
});

test("prefix + FY + suffix compose with separator", () => {
  const f = fmt({ prefix: "INV", separator: "/", minDigits: 5, yearDisplay: "FINANCIAL_YEAR", suffix: "-A" });
  assert.equal(buildFormattedDocumentNumber(f, APR_2026, 1), "INV/26-27/00001-A");
});

test("legacy fallback reproduces the historical PREFIX/FY/00001 output exactly", () => {
  const legacy = legacyDocFormat("TAX_INVOICE", {
    invoicePrefix: "INV",
    creditNotePrefix: "CN",
    debitNotePrefix: "DN",
    invoiceNumberStrategy: "FINANCIAL_YEAR_SEQUENCE",
  });
  assert.equal(buildFormattedDocumentNumber(legacy, APR_2026, 1), "INV/26-27/00001");
  assert.equal(buildFormattedDocumentNumber(legacy, APR_2026, 42), "INV/26-27/00042");
});

test("continuous never resets; FY reset changes the counter bucket", () => {
  const continuous = fmt({ resetPeriod: "CONTINUOUS" });
  assert.equal(counterPeriodLabel(continuous.resetPeriod, APR_2026), "CONTINUOUS");
  assert.equal(counterPeriodLabel(continuous.resetPeriod, JAN_2027), "CONTINUOUS");

  const fy = fmt({ resetPeriod: "FINANCIAL_YEAR" });
  assert.equal(counterPeriodLabel(fy.resetPeriod, APR_2026), "26-27");
  assert.equal(counterPeriodLabel(fy.resetPeriod, JAN_2027), "26-27"); // same FY
  assert.equal(counterPeriodLabel(fy.resetPeriod, new Date(Date.UTC(2027, 4, 1))), "27-28"); // next FY
});

test("resolveDocFormat prefers numberingConfig over legacy", () => {
  const resolved = resolveDocFormat("TAX_INVOICE", {
    invoicePrefix: "INV",
    creditNotePrefix: "CN",
    debitNotePrefix: "DN",
    invoiceNumberStrategy: "FINANCIAL_YEAR_SEQUENCE",
    numberingConfig: { invoice: { startNumber: 11205, minDigits: 0, resetPeriod: "CONTINUOUS", yearDisplay: "NONE" } },
  });
  assert.equal(resolved.startNumber, 11205);
  assert.equal(buildFormattedDocumentNumber(resolved, APR_2026, 11205), "11205");
});

test("validation: 16-char GST limit and charset", () => {
  assert.equal(validateDocNumberFormat(fmt({ startNumber: 1 })).ok, true);
  assert.equal(validateDocNumberFormat(fmt({ minDigits: 13 })).ok, false);
  assert.equal(validateDocNumberFormat(fmt({ startNumber: 0 })).ok, false);
  assert.equal(validateDocNumberFormat(fmt({ prefix: "IN V" })).ok, false); // space not allowed
  // A very long prefix + padded number blows the 16-char limit.
  assert.equal(validateDocNumberFormat(fmt({ prefix: "VERYLONGPREFIX", separator: "/", minDigits: 5 })).ok, false);
});
