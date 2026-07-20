import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/admin/merchant-settings/page.tsx", import.meta.url),
  "utf8",
);
const cartSection = page.slice(
  page.indexOf('<section id="cart-intelligence"'),
  page.indexOf('<section id="razorpay"'),
);

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("implemented Cart Intelligence controls render once in dedicated cards", () => {
  for (const label of [
    "Enable Cart Intelligence",
    "Enable Cart Goal Progress",
    "Enable Dynamic Banner",
    "Enable Savings Summary",
    "Enable Trust Badges",
  ]) {
    assert.equal(occurrences(cartSection, `label="${label}"`), 1, label);
  }

  const headings = [
    cartSection.indexOf('title="Cart Intelligence"'),
    cartSection.indexOf("Cart Goal Progress settings"),
    cartSection.indexOf("Dynamic Banner settings"),
    cartSection.indexOf("Savings Summary settings"),
    cartSection.indexOf("Trust Badges settings"),
  ];
  assert.ok(headings.every((position) => position >= 0));
  assert.deepEqual(headings, [...headings].sort((a, b) => a - b));
});

test("each dedicated card contains its complete field group", () => {
  const goalCard = cartSection.slice(
    cartSection.indexOf("Cart Goal Progress settings"),
    cartSection.indexOf("Dynamic Banner settings"),
  );
  for (const name of [
    "cartGoalProgressEnabled",
    "goalName",
    "targetAmount",
    "progressText",
    "unlockedText",
    "hideAfterUnlock",
  ]) assert.ok(goalCard.includes(`name="${name}"`), name);

  for (const name of [
    "dynamicBannerMessage",
    "dynamicBannerPlacement",
    "dynamicBannerSortOrder",
    "dynamicBannerStyle",
    "dynamicBannerAlignment",
    "dynamicBannerLinkLabel",
    "dynamicBannerLinkUrl",
    "savingsSummaryTitle",
    "savingsSummaryPlacement",
    "savingsSummarySortOrder",
    "trustBadgesPlacement",
    "trustBadgesLayout",
  ]) assert.ok(cartSection.includes(`name="${name}"`), name);
  assert.match(cartSection, /trustBadges\.items\.map/);
  assert.match(cartSection, /trustBadgeEnabled\$\{index\}/);
});

test("unfinished and generic registry controls are not merchant visible", () => {
  for (const text of [
    "Upsells Enabled",
    "Bundles Enabled",
    "AI Recommendations Enabled",
    "Cart Drawer Modules",
    "cartDrawerModuleEnabled:",
    "cartDrawerModuleSlot:",
    "cartDrawerModuleOrder:",
  ]) assert.ok(!cartSection.includes(text), text);
});

test("save payload preserves backend compatibility fields", () => {
  for (const field of [
    "upsellsEnabled",
    "bundlesEnabled",
    "aiRecommendationsEnabled",
    "cartDrawerModules",
    "dynamicBannerEnabled",
    "dynamicBannerText",
    "trustBadgesEnabled",
  ]) assert.ok(page.includes(`${field}:`), field);
});

test("literal HTML ids are unique", () => {
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});
