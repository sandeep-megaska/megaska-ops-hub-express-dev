import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvMatrix, parseCsvToRecords, normalizeHeader } from "./review-csv.ts";

test("parses a simple CSV into a matrix", () => {
  const matrix = parseCsvMatrix("a,b,c\n1,2,3");
  assert.deepEqual(matrix, [["a", "b", "c"], ["1", "2", "3"]]);
});

test("quoted fields keep embedded commas", () => {
  const matrix = parseCsvMatrix('name,note\n"Doe, Jane","hi, there"');
  assert.deepEqual(matrix[1], ["Doe, Jane", "hi, there"]);
});

test("doubled quotes inside a quoted field unescape to one quote", () => {
  const matrix = parseCsvMatrix('q\n"she said ""hi"""');
  assert.deepEqual(matrix[1], ['she said "hi"']);
});

test("quoted fields keep embedded newlines as one logical cell", () => {
  const matrix = parseCsvMatrix('body\n"line one\nline two"');
  assert.equal(matrix.length, 2);
  assert.deepEqual(matrix[1], ["line one\nline two"]);
});

test("CRLF line endings are handled and collapsed", () => {
  const matrix = parseCsvMatrix("a,b\r\n1,2\r\n3,4");
  assert.deepEqual(matrix, [["a", "b"], ["1", "2"], ["3", "4"]]);
});

test("a leading UTF-8 BOM is stripped from the first header", () => {
  const { headers } = parseCsvToRecords("﻿product_id,rating\n123,5");
  assert.deepEqual(headers, ["product_id", "rating"]);
});

test("a trailing newline does not produce a phantom empty row", () => {
  const { records, rawRowCount } = parseCsvToRecords("a,b\n1,2\n");
  assert.equal(rawRowCount, 1);
  assert.equal(records.length, 1);
});

test("fully blank rows are dropped", () => {
  const { records } = parseCsvToRecords("a,b\n1,2\n,\n3,4");
  assert.equal(records.length, 2);
});

test("header normalization lowercases and underscores punctuation/spacing", () => {
  assert.equal(normalizeHeader("Reviewer Name"), "reviewer_name");
  assert.equal(normalizeHeader("Product-Handle"), "product_handle");
  assert.equal(normalizeHeader("  RATING  "), "rating");
  assert.equal(normalizeHeader("Picture URLs!!"), "picture_urls");
});

test("records key by normalized header and pad short rows with empty strings", () => {
  const { records } = parseCsvToRecords("Product ID,Rating,Body\n123,5");
  assert.deepEqual(records[0], { product_id: "123", rating: "5", body: "" });
});

test("cells are trimmed", () => {
  const { records } = parseCsvToRecords("a\n  spaced  ");
  assert.equal(records[0].a, "spaced");
});
