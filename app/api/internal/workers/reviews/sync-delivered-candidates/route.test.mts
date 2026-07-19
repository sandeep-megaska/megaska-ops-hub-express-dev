import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
test("worker uses review worker authentication and existing bounded batch", () => { assert.match(source, /REVIEW_PROCESSOR_SECRET/); assert.match(source, /syncDeliveredOrderReviewCandidatesBatch/); assert.match(source, /Number\(limit\) > 100/); });
test("worker response exposes counts and cursor but no order outcomes", () => { assert.match(source, /nextCursor: result\.nextCursor/); assert.doesNotMatch(source, /orders: result\.orders|customer|email|phone/); });
