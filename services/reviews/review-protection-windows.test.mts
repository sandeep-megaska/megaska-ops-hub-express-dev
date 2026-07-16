import assert from "node:assert/strict";
import test from "node:test";
import { resolveReviewProtectionWindows, type ReviewWindowSettings } from "./review-protection-windows.ts";

function db(row: ReviewWindowSettings | null) { return { reviewSettings: { findUnique: async ({ where }: { where: { shopId: string } }) => where.shopId === "shop" ? row : null } }; }

test("resolves saved overrides and uses their maximum", async () => {
  const windows = await resolveReviewProtectionWindows("shop", db({ requestDelayDays: 1, exchangeProtectionDays: 4, issueProtectionDays: 3 }));
  assert.deepEqual(windows, { requestDelayDays: 1, exchangeProtectionDays: 4, issueProtectionDays: 3, effectiveProtectionDays: 4, sources: { requestDelay: "REVIEW_SETTINGS", exchangeProtection: "REVIEW_OVERRIDE", issueProtection: "REVIEW_OVERRIDE" } });
});
test("uses read-only safe defaults and policy fallback", async () => {
  const windows = await resolveReviewProtectionWindows("shop", db(null));
  assert.equal(windows.requestDelayDays, 7); assert.equal(windows.exchangeProtectionDays, 2); assert.equal(windows.issueProtectionDays, 2);
  const zero = await resolveReviewProtectionWindows("shop", db({ requestDelayDays: 0, exchangeProtectionDays: 0, issueProtectionDays: null }));
  assert.equal(zero.exchangeProtectionDays, 0); assert.equal(zero.issueProtectionDays, 2);
});
test("rejects invalid saved settings rather than silently accepting them", async () => {
  await assert.rejects(() => resolveReviewProtectionWindows("shop", db({ requestDelayDays: -1, exchangeProtectionDays: null, issueProtectionDays: null })), /requestDelayDays/);
});
