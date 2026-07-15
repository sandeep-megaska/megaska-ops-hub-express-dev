import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../prisma/migrations/20260715020000_add_commercial_catalog/migration.sql", import.meta.url), "utf8");
const seed = readFileSync(new URL("../../prisma/seed.mjs", import.meta.url), "utf8");

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} model should exist`);
  return match[0];
}

test("feature and plan codes are unique", () => {
  assert.match(modelBlock("BillableFeature"), /code\s+String\s+@unique/);
  assert.match(modelBlock("PricingPlan"), /code\s+String\s+@unique/);
  assert.match(migration, /CREATE UNIQUE INDEX "BillableFeature_code_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "PricingPlan_code_key"/);
});

test("plan-feature pairs are unique and relational", () => {
  const block = modelBlock("PricingPlanFeature");
  assert.match(block, /@@unique\(\[pricingPlanId, billableFeatureId\]\)/);
  assert.match(block, /pricingPlan\s+PricingPlan\s+@relation\(fields: \[pricingPlanId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(block, /billableFeature\s+BillableFeature\s+@relation\(fields: \[billableFeatureId\], references: \[id\], onDelete: Restrict\)/);
  assert.match(modelBlock("PricingPlan"), /features\s+PricingPlanFeature\[\]/);
  assert.match(modelBlock("BillableFeature"), /pricingPlanFeatures\s+PricingPlanFeature\[\]/);
});

test("commercial decimal fields use non-negative database checks", () => {
  assert.match(modelBlock("PricingPlan"), /monthlyBasePrice\s+Decimal\s+@db\.Decimal\(18, 6\)/);
  assert.match(modelBlock("PricingPlanFeature"), /includedQuantity\s+Decimal\s+@default\(0\) @db\.Decimal\(18, 6\)/);
  assert.match(modelBlock("PricingPlanFeature"), /overageUnitPrice\s+Decimal\s+@default\(0\) @db\.Decimal\(18, 6\)/);
  assert.match(migration, /CHECK \("monthlyBasePrice" >= 0\)/);
  assert.match(migration, /CHECK \("includedQuantity" >= 0\)/);
  assert.match(migration, /CHECK \("overageUnitPrice" >= 0\)/);
});

test("currency defaults to INR", () => {
  assert.match(modelBlock("PricingPlan"), /currency\s+String\s+@default\("INR"\)/);
  assert.match(migration, /"currency" TEXT NOT NULL DEFAULT 'INR'/);
});

test("seed data contains the commercial catalog defaults", () => {
  for (const code of ["OTP", "EMAIL", "SMS", "WHATSAPP", "AI", "DELIVERY_LOOKUP", "CHECKOUT"]) {
    assert.match(seed, new RegExp(`code: "${code}"|featureCode: "${code}"`));
  }
  assert.match(seed, /code: "PROFESSIONAL"/);
  assert.match(seed, /name: "Professional"/);
  assert.match(seed, /monthlyBasePrice: "4999"/);
  assert.match(seed, /currency: "INR"/);
  assert.match(seed, /featureCode: "OTP", includedQuantity: "1000", overageUnitPrice: "0\.35"/);
  assert.match(seed, /featureCode: "EMAIL", includedQuantity: "2000", overageUnitPrice: "0\.08"/);
});

test("commercial catalog migration does not create merchant-specific billing tables", () => {
  assert.doesNotMatch(migration, /MerchantSubscription|MerchantBillingPeriod|MerchantRatedUsage/);
  assert.doesNotMatch(modelBlock("PricingPlanFeature"), /MerchantSubscription|MerchantBillingPeriod|MerchantRatedUsage/);
});
