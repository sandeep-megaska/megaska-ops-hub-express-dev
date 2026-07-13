/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import { createCodAdvancePricingFingerprint } from "./fingerprint.ts";
import { CodPolicyResolverError, resolveExpressCheckoutCodPolicy } from "./resolver.ts";

const future = () => new Date(Date.now() + 60 * 60_000);
const past = () => new Date(Date.now() - 60 * 60_000);

function settings(overrides: Record<string, unknown> = {}) {
  return { id: "settings-1", enabled: true, advanceType: "FIXED", fixedAdvanceAmountPaise: 12000, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null, customerTitle: "COD advance", customerMessage: "Pay a small advance", version: 1, currency: "INR", minOrderAmountPaise: null, maxOrderAmountPaise: null, policyText: "COD policy", ...overrides };
}

function intent(overrides: Record<string, unknown> = {}) {
  return { id: "intent-1", shopId: "shop-1", customerProfileId: "customer-1", status: "PAYMENT_SELECTED", cartToken: "cart-token", shopifyCartId: "gid://shopify/Cart/1", cartSnapshot: { lines: [{ id: "l1", qty: 1 }] }, subtotalAmountPaise: 100000, discountAmountPaise: 0, shippingAmountPaise: 5000, codFeeAmountPaise: 5000, totalAmountPaise: 110000, currency: "INR", selectedPaymentMethod: "COD", expiresAt: future(), ...overrides };
}

function dbHarness(options: { intent?: any; reservations?: any[]; existing?: any[] } = {}) {
  const state = { created: [] as any[], updated: [] as any[], audits: [] as any[], transactionCount: 0, transactionOps: [] as string[] };
  const db = {
    expressCheckoutIntent: { findFirst: async () => options.intent ?? intent() },
    walletReservation: { findMany: async () => options.reservations ?? [] },
    codAdvanceIntent: {
      findMany: async () => { state.transactionOps.push("findMany"); return options.existing ?? []; },
      updateMany: async (args: any) => { state.transactionOps.push("updateMany"); state.updated.push(args); return { count: 1 }; },
      create: async (args: any) => { state.transactionOps.push("create"); const row = { id: `cod-${state.created.length + 1}`, status: "CREATED", createdAt: new Date(), ...args.data }; state.created.push(row); return row; },
    },
    $transaction: async (fn: any) => { state.transactionCount += 1; return fn(db); },
  } as any;
  return { db, state };
}

async function resolve(overrides: { db?: any; state?: any; settings?: any } = {}) {
  return resolveExpressCheckoutCodPolicy({ shopId: "shop-1", shopDomain: "shop.example", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, overrides.db, { getLatestSettings: async () => overrides.settings ?? settings(), audit: async (...args) => overrides.state?.audits.push(args) });
}

function existingIntent(overrides: Record<string, unknown> = {}) {
  return { id: "old", shopId: "shop-1", customerProfileId: "customer-1", expressCheckoutIntentId: "intent-1", status: "CREATED", pricingFingerprint: "old-fp", settingsVersion: 1, advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, expiresAt: future(), createdAt: new Date(), paidAt: null, consumedAt: null, shopifyOrderId: null, ...overrides };
}

test("disabled settings returns unavailable safe DTO", async () => {
  const h = dbHarness();
  const dto = await resolve({ db: h.db, state: h.state, settings: settings({ enabled: false }) });
  assert.equal(dto.available, false);
  assert.equal(dto.eligible, false);
  assert.equal(dto.codAdvanceIntentId, null);
  assert.equal(dto.paymentMode, "COD");
  assert.equal(h.state.created.length, 0);
  assert.equal(h.state.updated.length, 0);
  assert.equal(h.state.transactionCount, 0);
});

test("fixed advance creates new intent", async () => {
  const h = dbHarness();
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.advanceAmountPaise, 12000);
  assert.equal(dto.codBalanceAmountPaise, 98000);
  assert.equal(h.state.created.length, 1);
});

test("percentage advance", async () => {
  const h = dbHarness();
  const dto = await resolve({ db: h.db, state: h.state, settings: settings({ advanceType: "PERCENTAGE", percentageBasisPoints: 1000 }) });
  assert.equal(dto.advanceAmountPaise, 11000);
});

test("Store Credit reduces cash liability", async () => {
  const h = dbHarness({ reservations: [{ id: "res-1", reservedAmount: 30000, createdAt: new Date(), expiresAt: future() }] });
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.storeCreditAppliedPaise, 30000);
  assert.equal(dto.customerCashLiabilityPaise, 80000);
  assert.equal(dto.codBalanceAmountPaise, 68000);
});

test("no Store Credit reservation applies zero", async () => {
  const h = dbHarness({ reservations: [] });
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.storeCreditAppliedPaise, 0);
});

test("full Store Credit gives zero liability", async () => {
  const h = dbHarness({ reservations: [{ id: "res-1", reservedAmount: 110000, createdAt: new Date(), expiresAt: future() }] });
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.customerCashLiabilityPaise, 0);
  assert.equal(dto.requiresAdvance, false);
  assert.equal(dto.codAdvanceIntentId, null);
  assert.equal(h.state.created.length, 0);
});

test("checkout belongs to another shop", async () => {
  const h = dbHarness({ intent: intent({ shopId: "other" }) });
  await assert.rejects(() => resolve({ db: h.db, state: h.state }), (error: any) => error instanceof CodPolicyResolverError && error.status === 404);
});

test("checkout belongs to another customer", async () => {
  const h = dbHarness({ intent: intent({ customerProfileId: "other" }) });
  await assert.rejects(() => resolve({ db: h.db, state: h.state }), (error: any) => error.status === 404);
});

test("expired checkout rejected", async () => {
  const h = dbHarness({ intent: intent({ expiresAt: past() }) });
  await assert.rejects(() => resolve({ db: h.db, state: h.state }), (error: any) => error.status === 409);
});

test("PREPAID-selected checkout rejected", async () => {
  const h = dbHarness({ intent: intent({ selectedPaymentMethod: "PREPAID" }) });
  await assert.rejects(() => resolve({ db: h.db, state: h.state }), /PREPAID/);
});

test("identical quote reuses intent", async () => {
  const base = intent();
  const fp = createCodAdvancePricingFingerprint({ shopId: "shop-1", expressCheckoutIntentId: base.id, cartToken: base.cartToken, shopifyCartId: base.shopifyCartId, cartSnapshot: base.cartSnapshot, subtotalAmountPaise: base.subtotalAmountPaise, discountAmountPaise: base.discountAmountPaise, shippingAmountPaise: base.shippingAmountPaise, codFeeAmountPaise: base.codFeeAmountPaise, totalAmountPaise: base.totalAmountPaise, currency: base.currency, storeCreditReservationId: null, storeCreditReservedAmountPaise: 0, codSettingsId: "settings-1", codSettingsVersion: 1, advanceType: "FIXED", fixedAdvanceAmountPaise: 12000, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null, minOrderAmountPaise: null, maxOrderAmountPaise: null });
  const h = dbHarness({ intent: base, existing: [existingIntent({ pricingFingerprint: fp })] });
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.codAdvanceIntentId, "old");
  assert.equal(h.state.created.length, 0);
});

test("changed total creates replacement intent and cancels stale CREATED", async () => {
  const h = dbHarness({ existing: [existingIntent({ codBalanceAmountPaise: 97000 })] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.updated[0].data.status, "CANCELLED");
  assert.equal(h.state.created.length, 1);
});

test("changed Store Credit creates replacement intent", async () => {
  const h = dbHarness({ reservations: [{ id: "res-2", reservedAmount: 1000, createdAt: new Date(), expiresAt: future() }], existing: [existingIntent()] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.created.length, 1);
});

test("changed settings version creates replacement intent", async () => {
  const h = dbHarness({ existing: [existingIntent()] });
  await resolve({ db: h.db, state: h.state, settings: settings({ version: 2 }) });
  assert.equal(h.state.created[0].settingsVersion, 2);
});

test("paid intent is never overwritten or cancelled", async () => {
  const h = dbHarness({ existing: [existingIntent({ id: "paid", status: "ADVANCE_PAID", paidAt: new Date(), pricingFingerprint: "old" })] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.updated.length, 0);
  assert.equal(h.state.created.length, 1);
});

test("stale CREATED intent is expired when already past expiry", async () => {
  const h = dbHarness({ existing: [existingIntent({ pricingFingerprint: "old", expiresAt: past() })] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.updated[0].data.status, "EXPIRED");
});

test("customer-safe DTO hides internals", async () => {
  const h = dbHarness();
  const dto: any = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.pricingFingerprint, undefined);
  assert.equal(dto.settingsId, undefined);
  assert.equal(dto.walletReservationId, undefined);
});

test("fingerprint deterministic for same input", () => {
  const a = createCodAdvancePricingFingerprint({ shopId: "s", expressCheckoutIntentId: "i", cartToken: "c", shopifyCartId: null, cartSnapshot: { b: 2, a: 1 }, subtotalAmountPaise: 1, discountAmountPaise: 2, shippingAmountPaise: 3, codFeeAmountPaise: 4, totalAmountPaise: 5, currency: "INR", storeCreditReservationId: null, storeCreditReservedAmountPaise: 0, codSettingsId: "cs", codSettingsVersion: 1, advanceType: "FIXED", fixedAdvanceAmountPaise: 1, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null, minOrderAmountPaise: null, maxOrderAmountPaise: null });
  const b = createCodAdvancePricingFingerprint({ shopId: "s", expressCheckoutIntentId: "i", cartToken: "c", shopifyCartId: null, cartSnapshot: { a: 1, b: 2 }, subtotalAmountPaise: 1, discountAmountPaise: 2, shippingAmountPaise: 3, codFeeAmountPaise: 4, totalAmountPaise: 5, currency: "INR", storeCreditReservationId: null, storeCreditReservedAmountPaise: 0, codSettingsId: "cs", codSettingsVersion: 1, advanceType: "FIXED", fixedAdvanceAmountPaise: 1, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null, minOrderAmountPaise: null, maxOrderAmountPaise: null });
  assert.equal(a, b);
});

test("fingerprint changes when monetary or policy input changes", () => {
  const base = { shopId: "s", expressCheckoutIntentId: "i", cartToken: "c", shopifyCartId: null, cartSnapshot: {}, subtotalAmountPaise: 1, discountAmountPaise: 2, shippingAmountPaise: 3, codFeeAmountPaise: 4, totalAmountPaise: 5, currency: "INR", storeCreditReservationId: null, storeCreditReservedAmountPaise: 0, codSettingsId: "cs", codSettingsVersion: 1, advanceType: "FIXED", fixedAdvanceAmountPaise: 1, percentageBasisPoints: null, minimumAdvanceAmountPaise: null, maximumAdvanceAmountPaise: null, minOrderAmountPaise: null, maxOrderAmountPaise: null };
  assert.notEqual(createCodAdvancePricingFingerprint(base), createCodAdvancePricingFingerprint({ ...base, totalAmountPaise: 6 }));
  assert.notEqual(createCodAdvancePricingFingerprint(base), createCodAdvancePricingFingerprint({ ...base, fixedAdvanceAmountPaise: 2 }));
});

test("below minimum order creates no intent", async () => {
  const h = dbHarness();
  const dto = await resolve({ db: h.db, state: h.state, settings: settings({ minOrderAmountPaise: 200000 }) });
  assert.equal(dto.eligible, false);
  assert.equal(dto.codAdvanceIntentId, null);
  assert.equal(h.state.created.length, 0);
  assert.equal(h.state.transactionCount, 0);
});

test("fixed advance zero creates no intent", async () => {
  const h = dbHarness();
  const dto = await resolve({ db: h.db, state: h.state, settings: settings({ fixedAdvanceAmountPaise: 0 }) });
  assert.equal(dto.requiresAdvance, false);
  assert.equal(dto.codAdvanceIntentId, null);
  assert.equal(h.state.created.length, 0);
});

test("allowed checkout status can have null selected payment method", async () => {
  const h = dbHarness({ intent: intent({ status: "PAYMENT_SELECTED", selectedPaymentMethod: null }) });
  const dto = await resolve({ db: h.db, state: h.state });
  assert.equal(dto.codAdvanceIntentId, "cod-1");
});

for (const status of ["PAYMENT_PENDING", "ORDER_CREATING", "DRAFT_ORDER_CREATED"]) {
  test(`${status} checkout status is rejected`, async () => {
    const h = dbHarness({ intent: intent({ status }) });
    await assert.rejects(() => resolve({ db: h.db, state: h.state }), (error: any) => error instanceof CodPolicyResolverError && error.status === 409);
  });
}

test("stale cancellation and replacement happen inside transaction", async () => {
  const h = dbHarness({ existing: [existingIntent()] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.transactionCount, 1);
  assert.deepEqual(h.state.transactionOps, ["findMany", "updateMany", "create"]);
});

test("paid and Shopify-linked intents are untouched while replacement is created", async () => {
  const h = dbHarness({ existing: [existingIntent({ id: "paid", status: "ADVANCE_PAID", paidAt: new Date() }), existingIntent({ id: "linked", shopifyOrderId: "gid://shopify/Order/1" })] });
  await resolve({ db: h.db, state: h.state });
  assert.equal(h.state.updated.length, 0);
  assert.equal(h.state.created.length, 1);
});
