import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvRecords } from "./csv.ts";

test("quotes, escaped quotes, commas and newlines inside fields", () => {
  const text = 'a,b,c\r\n1,"two, 2","say ""hi""\nthere"\r\n';
  assert.deepEqual(parseCsv(text), [["a", "b", "c"], ["1", "two, 2", 'say "hi"\nthere']]);
});

test("BOM, LF endings, blank lines, missing trailing newline", () => {
  assert.deepEqual(parseCsv("\uFEFFh1,h2\n\nx,y"), [["h1", "h2"], ["x", "y"]]);
});

test("empty trailing fields are kept", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,\n"), [["a", "b", "c"], ["1", "", ""]]);
});

test("unterminated quote is an error", () => {
  assert.throws(() => parseCsv('a\n"oops'), /quoted field/);
});

test("records are keyed by trimmed header", () => {
  const { headers, records } = parseCsvRecords(" Handle ,Title\nx, Y \n");
  assert.deepEqual(headers, ["Handle", "Title"]);
  assert.deepEqual(records, [{ Handle: "x", Title: "Y" }]);
});
