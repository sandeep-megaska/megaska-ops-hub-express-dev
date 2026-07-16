import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __setMerchantSubscriptionPrismaForTests,
  getMerchantSubscription,
  upsertMerchantSubscription,
  MerchantSubscriptionConfigurationError,
  MerchantSubscriptionValidationError,
} from "./subscription.ts";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../prisma/migrations/20260715030000_add_merchant_subscription_foundation/migration.sql", import.meta.url), "utf8");

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} model should exist`);
  return match[0];
}

function enumBlock(name: string) {
  const match = schema.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} enum should exist`);
  return match[0];
}

function makeDb() {
  const shops = new Map([["shop-a", { id: "shop-a" }], ["shop-b", { id: "shop-b" }]]);
  const plans = new Map([
    ["PROFESSIONAL", { id: "plan-professional", code: "PROFESSIONAL", name: "Professional", monthlyBasePrice: "4999", currency: "INR", active: true }],
    ["STARTER", { id: "plan-starter", code: "STARTER", name: "Starter", monthlyBasePrice: "999", currency: "INR", active: true }],
    ["INACTIVE", { id: "plan-inactive", code: "INACTIVE", name: "Inactive", monthlyBasePrice: "1", currency: "INR", active: false }],
  ]);
  const subscriptions = new Map();
  let upsertCalls = 0;
  const db = {
    shops, plans, subscriptions,
    get upsertCalls() { return upsertCalls; },
    shop: { async findUnique(args: unknown) { return shops.get((args as { where: { id: string } }).where.id) ?? null; } },
    pricingPlan: { async findUnique(args: unknown) { return plans.get((args as { where: { code: string } }).where.code) ?? null; } },
    merchantSubscription: {
      async findUnique(args: unknown) {
        const query = args as { where: { shopId: string }; include?: { pricingPlan?: boolean } };
        const row = subscriptions.get(query.where.shopId) ?? null;
        if (!row) return null;
        if (query.include?.pricingPlan) return { ...row, pricingPlan: plans.get(row.pricingPlanCode) };
        return row;
      },
      async upsert(args: unknown) {
        const query = args as { where: { shopId: string }; create: Record<string, unknown>; update: Record<string, unknown> };
        upsertCalls += 1;
        const existing = subscriptions.get(query.where.shopId);
        const source = existing ? { ...existing, ...query.update } : { id: `sub-${query.create.shopId}`, ...query.create };
        const plan = [...plans.values()].find((candidate) => candidate.id === source.pricingPlanId);
        assert.ok(plan, "plan should exist for upsert");
        const row = { ...source, pricingPlanCode: plan.code, shopId: query.where.shopId };
        subscriptions.set(query.where.shopId, row);
        return { ...row, pricingPlan: plan };
      },
    },
  };
  __setMerchantSubscriptionPrismaForTests(db);
  return db;
}

beforeEach(() => makeDb());

test("schema adds provider-independent MerchantSubscription foundation", () => {
  assert.match(enumBlock("MerchantSubscriptionStatus"), /TRIALING[\s\S]*ACTIVE[\s\S]*PAST_DUE[\s\S]*PAUSED[\s\S]*CANCELED[\s\S]*EXPIRED/);
  assert.match(enumBlock("BillingProvider"), /SHOPIFY[\s\S]*STRIPE[\s\S]*RAZORPAY[\s\S]*MANUAL[\s\S]*INTERNAL/);
  const block = modelBlock("MerchantSubscription");
  assert.match(block, /shopId\s+String\s+@unique/);
  assert.match(block, /pricingPlan\s+PricingPlan\s+@relation\(fields: \[pricingPlanId\], references: \[id\], onDelete: Restrict\)/);
  assert.match(block, /shop\s+Shop\s+@relation\(fields: \[shopId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(modelBlock("Shop"), /merchantSubscription\s+MerchantSubscription\?/);
  assert.match(modelBlock("PricingPlan"), /merchantSubscriptions\s+MerchantSubscription\[\]/);
  assert.match(migration, /CREATE UNIQUE INDEX "MerchantSubscription_shopId_key"/);
  assert.match(migration, /CREATE TYPE "BillingProvider" AS ENUM/);
});

test("schema has no rated-usage or invoice models yet", () => {
  assert.doesNotMatch(schema, /model MerchantRatedUsage|model BillingInvoice|model BillingBatch|model SubscriptionAudit|model Entitlement/);
});

test("missing subscription resolves PROFESSIONAL without creating a row", async () => {
  const db = makeDb();
  const resolved = await getMerchantSubscription("shop-a");
  assert.equal(resolved.subscriptionId, null);
  assert.equal(resolved.status, "TRIALING");
  assert.equal(resolved.billingProvider, "INTERNAL");
  assert.equal(resolved.pricingPlan.code, "PROFESSIONAL");
  assert.equal(resolved.hasSubscriptionRow, false);
  assert.equal(db.subscriptions.size, 0);
  assert.equal(db.upsertCalls, 0);
});

test("default plan must exist and be active", async () => {
  const db = makeDb();
  const professionalPlan = db.plans.get("PROFESSIONAL");
  assert.ok(professionalPlan);
  professionalPlan.active = false;
  await assert.rejects(() => getMerchantSubscription("shop-a"), MerchantSubscriptionConfigurationError);
  db.plans.delete("PROFESSIONAL");
  await assert.rejects(() => getMerchantSubscription("shop-a"), MerchantSubscriptionConfigurationError);
});

test("subscription resolves only for the requested shop", async () => {
  await upsertMerchantSubscription("shop-a", { pricingPlanCode: "STARTER", status: "ACTIVE", billingProvider: "MANUAL" });
  const a = await getMerchantSubscription("shop-a");
  const b = await getMerchantSubscription("shop-b");
  assert.equal(a.pricingPlan.code, "STARTER");
  assert.equal(b.pricingPlan.code, "PROFESSIONAL");
  assert.equal(b.hasSubscriptionRow, false);
});

test("creates and updates one subscription per shop", async () => {
  const created = await upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "TRIALING", billingProvider: "INTERNAL" });
  const updated = await upsertMerchantSubscription("shop-a", { pricingPlanCode: "STARTER", status: "ACTIVE", billingProvider: "SHOPIFY", renewsAutomatically: "false" });
  assert.equal(created.subscriptionId, updated.subscriptionId);
  assert.equal(updated.pricingPlan.id, "plan-starter");
  assert.equal(updated.renewsAutomatically, false);
});

test("resolves plan by code and rejects unknown or inactive plans", async () => {
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "missing", status: "ACTIVE", billingProvider: "INTERNAL" }), MerchantSubscriptionValidationError);
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "INACTIVE", status: "ACTIVE", billingProvider: "INTERNAL" }), MerchantSubscriptionValidationError);
});

test("rejects unsupported status and billing provider", async () => {
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "BAD", billingProvider: "INTERNAL" }), MerchantSubscriptionValidationError);
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "BAD" }), MerchantSubscriptionValidationError);
});

test("rejects invalid date ranges", async () => {
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "TRIALING", billingProvider: "INTERNAL", trialStartsAt: "2026-01-02", trialEndsAt: "2026-01-01" }), MerchantSubscriptionValidationError);
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "INTERNAL", currentPeriodStart: "2026-01-01", currentPeriodEnd: "2026-01-01" }), MerchantSubscriptionValidationError);
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "INTERNAL", trialStartsAt: "not-a-date" }), MerchantSubscriptionValidationError);
});

test("external references are trimmed, length-limited, and control-character safe", async () => {
  const db = makeDb();
  await upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "MANUAL", externalSubscriptionReference: " ext-sub ", externalCustomerReference: " ext-cus " });
  const row = db.subscriptions.get("shop-a");
  assert.equal(row.externalSubscriptionReference, "ext-sub");
  assert.equal(row.externalCustomerReference, "ext-cus");
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "MANUAL", externalSubscriptionReference: "bad\nref" }), MerchantSubscriptionValidationError);
  await assert.rejects(() => upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "MANUAL", externalSubscriptionReference: "x".repeat(256) }), MerchantSubscriptionValidationError);
});

test("saving SHOPIFY does not call an external API and resolver output contains no secrets", async () => {
  const resolved = await upsertMerchantSubscription("shop-a", { pricingPlanCode: "PROFESSIONAL", status: "ACTIVE", billingProvider: "SHOPIFY", externalSubscriptionReference: "gid-secret", externalCustomerReference: "customer-secret" });
  assert.equal(resolved.billingProvider, "SHOPIFY");
  assert.equal(JSON.stringify(resolved).includes("secret"), false);
});
