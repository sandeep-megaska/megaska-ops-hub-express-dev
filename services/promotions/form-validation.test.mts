import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { friendlyPromotionFieldLabel, promotionActivationReadiness, rewardValueLabel, validatePromotionFormClient } from "./form-validation.ts";

const valid = { name: "Rule", triggerType: "PRODUCT" as const, triggerReferences: [{ sourceType: "PRODUCT" as const, referenceGid: "gid://shopify/Product/1" }], offerProductGid: "gid://shopify/Product/2", minimumTriggerQuantity: 1, maximumRewardQuantity: 1, rewardType: "PERCENTAGE_OFF" as const, rewardValue: "10" };

test("reward label changes by reward type", () => {
  assert.equal(rewardValueLabel("PERCENTAGE_OFF"), "Discount percentage");
  assert.equal(rewardValueLabel("FIXED_AMOUNT_OFF"), "Fixed amount off");
  assert.equal(rewardValueLabel("FIXED_PRICE"), "Promotional final price");
});

test("percentage validation", () => assert.equal(validatePromotionFormClient({ ...valid, rewardValue: 101 }).valid, false));
test("fixed amount validation", () => assert.equal(validatePromotionFormClient({ ...valid, rewardType: "FIXED_AMOUNT_OFF", rewardValue: 0 }).valid, false));
test("fixed price validation", () => assert.equal(validatePromotionFormClient({ ...valid, rewardType: "FIXED_PRICE", rewardValue: -1 }).valid, false));
test("quantity validation", () => assert.equal(validatePromotionFormClient({ ...valid, minimumTriggerQuantity: 0, maximumRewardQuantity: 0 }).errors.filter((e) => e.field.includes("Quantity")).length, 2));
test("schedule validation", () => assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-12T00:00", endsAt: "2026-07-11T00:00" }).valid, false));
test("text-length limits", () => assert.equal(validatePromotionFormClient({ ...valid, heading: "x".repeat(121), badgeText: "x".repeat(61), customerMessage: "x".repeat(241), ctaText: "x".repeat(61) }).errors.length, 4));
test("activation readiness complete", () => assert.equal(promotionActivationReadiness(valid).every((i) => i.complete), true));
test("activation readiness incomplete", () => assert.equal(promotionActivationReadiness({ ...valid, name: "", triggerReferences: [], offerProductGid: "", rewardValue: 101 }).some((i) => !i.complete), true));
test("friendly field-label mapping", () => assert.equal(friendlyPromotionFieldLabel("offerProductGid"), "Offer product"));


test("numeric strings and reward values validate with strict reward policies", () => {
  assert.equal(validatePromotionFormClient({ ...valid, rewardValue: "50" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, rewardValue: "12.50" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, rewardValue: "abc" }).errors.some((e) => e.field === "rewardValue"), true);
  assert.equal(validatePromotionFormClient({ ...valid, rewardValue: "" }).errors.some((e) => e.field === "rewardValue"), true);
  assert.equal(validatePromotionFormClient({ ...valid, rewardType: "PERCENTAGE_OFF", rewardValue: "0" }).valid, false);
  assert.equal(validatePromotionFormClient({ ...valid, rewardType: "PERCENTAGE_OFF", rewardValue: "100" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, rewardType: "PERCENTAGE_OFF", rewardValue: "100.01" }).valid, false);
  assert.equal(validatePromotionFormClient({ ...valid, rewardType: "FIXED_AMOUNT_OFF", rewardValue: "0" }).valid, false);
  assert.equal(validatePromotionFormClient({ ...valid, rewardType: "FIXED_PRICE", rewardValue: "0" }).valid, true);
});

test("optional schedule combinations remain independently optional", () => {
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "", endsAt: null }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-11T00:00:00.000Z", endsAt: "" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: null, endsAt: "2026-07-12T00:00:00.000Z" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-11T00:00:00.000Z", endsAt: "2026-07-12T00:00:00.000Z" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-12T00:00:00.000Z", endsAt: "2026-07-11T00:00:00.000Z" }).errors.some((e) => e.field === "endsAt"), true);
});

test("form implements archived read-only behavior and correct status buttons", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.match(form, /This rule is archived and cannot be edited or reactivated/);
  assert.match(form, /Activate rule/);
  assert.match(form, /Pause rule/);
  assert.match(form, /Resume rule/);
});

test("archive confirmation warns reactivation is unavailable", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.match(form, /Archived rules cannot be reactivated/);
});

test("no Live or Published claims", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /not live|published/i);
});

test("no currency symbol hard-coding", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /₹|INR/);
});

test("Resource Picker selections and embedded context are preserved", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.match(form, /triggerReferencesValue/);
  assert.match(form, /offerProductTitle/);
  assert.match(form, /shopify_shop/);
  assert.match(form, /host/);
});

test("blank optional schedule fields are valid for form validation and readiness", () => {
  const result = validatePromotionFormClient({ ...valid, startsAt: "", endsAt: "" });
  assert.equal(result.errors.some((e) => e.field === "startsAt" || e.field === "endsAt"), false);
  assert.equal(promotionActivationReadiness({ ...valid, startsAt: "", endsAt: "" }).find((i) => i.key === "schedule")?.complete, true);
});

test("invalid nonblank schedule field is rejected", () => {
  const result = validatePromotionFormClient({ ...valid, startsAt: "2026-07-12T00:00", endsAt: "not-a-date" });
  assert.equal(result.errors.some((e) => e.field === "endsAt"), true);
});

test("schedule order accepts end after start and rejects end before start", () => {
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-11T00:00:00.000Z", endsAt: "2026-07-12T00:00:00.000Z" }).valid, true);
  assert.equal(validatePromotionFormClient({ ...valid, startsAt: "2026-07-12T00:00:00.000Z", endsAt: "2026-07-11T00:00:00.000Z" }).errors.some((e) => e.field === "endsAt"), true);
});

test("PromotionForm submits UTC hidden schedule values and renders stored dates locally", () => {
  const form = readFileSync(new URL("../../app/admin/promotions/PromotionForm.tsx", import.meta.url), "utf8");
  assert.match(form, /function dateValue/);
  assert.match(form, /getFullYear\(\)/);
  assert.match(form, /getHours\(\)/);
  assert.match(form, /function localDateTimeToUtc/);
  assert.match(form, /toISOString\(\)/);
  assert.match(form, /name="startsAtUtc"/);
  assert.match(form, /name="endsAtUtc"/);
  assert.match(form, /Leave blank to start immediately once the promotion is available\./);
  assert.match(form, /Leave blank for no expiry date\./);
  assert.match(form, /No end date/);
});
