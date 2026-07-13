/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { createCodAdvanceRazorpayOrder, CodAdvanceRazorpayOrderError } from "./razorpay-order.ts";

const future = () => new Date(Date.now() + 60 * 60_000);
const past = () => new Date(Date.now() - 60 * 60_000);
const baseIntent = (o = {}) => ({ id: "intent-1", shopId: "shop-1", customerProfileId: "customer-1", status: "PAYMENT_SELECTED", selectedPaymentMethod: "COD", currency: "INR", totalAmountPaise: 200000, expiresAt: future(), orderLink: null, ...o });
const baseCod = (o = {}) => ({ id: "cod-1", shopId: "shop-1", expressCheckoutIntentId: "intent-1", customerProfileId: "customer-1", status: "CREATED", pricingFingerprint: "fp-1", settingsVersion: 1, advanceAmountPaise: 30000, codBalanceAmountPaise: 170000, orderAmountPaise: 200000, storeCreditAppliedPaise: 0, currency: "INR", paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, razorpayPaymentId: null, expiresAt: future(), createdAt: new Date(), ...o });

function harness(o: any = {}) {
  const state: any = { payments: [], updates: [], codUpdates: [], audits: [], gatewayCalls: [] };
  const intent = o.intent === undefined ? baseIntent() : o.intent;
  const cod = o.cod === undefined ? baseCod() : o.cod;
  const db: any = {
    expressCheckoutIntent: { findFirst: async () => intent },
    codAdvanceIntent: { findFirst: async (args: any) => args.where?.id ? (o.freshCod || cod) : cod, updateMany: async (args: any) => { state.codUpdates.push(args); return { count: 1 }; } },
    expressCheckoutPayment: {
      findFirst: async () => o.payment || null,
      create: async (args: any) => { const row = { id: "pay-new", createdAt: new Date(), ...args.data }; state.payments.push(row); return row; },
      update: async (args: any) => { if (o.failPersistence) throw new Error("db down"); state.updates.push(args); return { id: args.where.id, ...args.data }; },
    },
  };
  const resolvePolicy = async () => o.quote || { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: cod?.advanceAmountPaise, codBalanceAmountPaise: cod?.codBalanceAmountPaise, currency: cod?.currency };
  const createGatewayOrder = async (input: any) => { state.gatewayCalls.push(input); if (o.failGateway) throw new Error("provider down"); return { id: "order_123", amount: input.amountPaise, currency: input.currency }; };
  return { db, state, deps: { db, resolvePolicy, createGatewayOrder, getRazorpayCredentials: () => ({ keyId: "rzp_test", keySecret: "secret" }), audit: async (...args: any[]) => state.audits.push(args), now: () => new Date(), reuseWindowMs: 15 * 60_000 } };
}
async function expectCode(h: any, code: string) { await assert.rejects(() => createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s.myshopify.com", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps), (e: any) => e instanceof CodAdvanceRazorpayOrderError && e.code === code); }

test("missing checkout, wrong shop, and wrong customer are rejected", async () => {
  await expectCode(harness({ intent: null }), "CHECKOUT_NOT_ELIGIBLE");
  await expectCode(harness({ intent: baseIntent({ shopId: "other" }) }), "CHECKOUT_NOT_ELIGIBLE");
  await expectCode(harness({ intent: baseIntent({ customerProfileId: "other" }) }), "CHECKOUT_NOT_ELIGIBLE");
});

test("PREPAID checkout and missing COD intent are rejected", async () => {
  await expectCode(harness({ intent: baseIntent({ selectedPaymentMethod: "PREPAID" }) }), "CHECKOUT_NOT_ELIGIBLE");
  await expectCode(harness({ cod: null }), "COD_ADVANCE_INTENT_NOT_FOUND");
});

test("no advance, expired, paid, consumed, and Shopify-linked intents are rejected", async () => {
  await expectCode(harness({ cod: baseCod({ advanceAmountPaise: 0 }) }), "COD_ADVANCE_NOT_REQUIRED");
  await expectCode(harness({ cod: baseCod({ expiresAt: past() }) }), "COD_ADVANCE_INTENT_EXPIRED");
  await expectCode(harness({ cod: baseCod({ paidAt: new Date() }) }), "COD_ADVANCE_ALREADY_PAID");
  await expectCode(harness({ cod: baseCod({ consumedAt: new Date() }) }), "CHECKOUT_NOT_ELIGIBLE");
  await expectCode(harness({ cod: baseCod({ shopifyDraftOrderId: "draft" }) }), "CHECKOUT_NOT_ELIGIBLE");
});

test("stale fingerprint, amount, balance, settings, and not-required quote are rejected", async () => {
  await expectCode(harness({ quote: { requiresAdvance: true, codAdvanceIntentId: "other", advanceAmountPaise: 30000, codBalanceAmountPaise: 170000, currency: "INR" } }), "COD_ADVANCE_QUOTE_STALE");
  await expectCode(harness({ quote: { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 1, codBalanceAmountPaise: 170000, currency: "INR" } }), "COD_ADVANCE_QUOTE_STALE");
  await expectCode(harness({ quote: { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 30000, codBalanceAmountPaise: 1, currency: "INR" } }), "COD_ADVANCE_QUOTE_STALE");
  await expectCode(harness({ freshCod: baseCod({ pricingFingerprint: "new" }) }), "COD_ADVANCE_QUOTE_STALE");
  await expectCode(harness({ quote: { requiresAdvance: false, codAdvanceIntentId: null } }), "COD_ADVANCE_QUOTE_STALE");
});

test("successful fixed, percentage, and Store Credit-adjusted orders use exactly the advance amount", async () => {
  for (const cod of [baseCod({ advanceAmountPaise: 30000 }), baseCod({ advanceAmountPaise: 12500 }), baseCod({ advanceAmountPaise: 9000, storeCreditAppliedPaise: 50000, codBalanceAmountPaise: 141000 })]) {
    const h = harness({ cod });
    const result = await createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps);
    assert.equal(h.state.gatewayCalls[0].amountPaise, cod.advanceAmountPaise);
    assert.equal(result.razorpayOrder.amount, cod.advanceAmountPaise);
    assert.equal(result.cod.storeCreditAppliedPaise, cod.storeCreditAppliedPaise);
  }
});

test("creates COD_ADVANCE payment, persists provider data, and moves intent to PAYMENT_PENDING", async () => {
  const h = harness();
  await createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps);
  assert.equal(h.state.payments[0].method, "COD");
  assert.equal(h.state.payments[0].purpose, "COD_ADVANCE");
  assert.equal(h.state.updates[0].data.razorpayOrderId, "order_123");
  assert.equal(h.state.codUpdates[0].data.status, "PAYMENT_PENDING");
});

test("safe existing pending payment is reused", async () => {
  const h = harness({ payment: { id: "pay-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: 30000, currency: "INR", razorpayOrderId: "order_old", razorpayPaymentId: null, createdAt: new Date() } });
  const result = await createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps);
  assert.equal(result.reused, true);
  assert.equal(h.state.gatewayCalls.length, 0);
});

test("amount mismatch, currency mismatch, and paid payment are not reused", async () => {
  for (const payment of [{ amountPaise: 1, currency: "INR", razorpayPaymentId: null }, { amountPaise: 30000, currency: "USD", razorpayPaymentId: null }, { amountPaise: 30000, currency: "INR", razorpayPaymentId: "pay_rzp" }]) {
    const h = harness({ payment: { id: "pay-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", razorpayOrderId: "order_old", createdAt: new Date(), ...payment } });
    const result = await createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps);
    assert.equal(result.reused, false);
    assert.equal(h.state.gatewayCalls.length, 1);
  }
});

test("provider failure leaves intent unpaid and emits failure audit", async () => {
  const h = harness({ failGateway: true });
  await expectCode(h, "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.codUpdates.length, 0);
  assert.equal(h.state.audits.some((a: any[]) => a[0] === "cod_advance.razorpay_order.failed"), true);
});

test("persistence failure after provider creation emits reconciliation audit", async () => {
  const h = harness({ failPersistence: true });
  await expectCode(h, "RAZORPAY_ORDER_CREATION_FAILED");
  assert.equal(h.state.audits.some((a: any[]) => a[0] === "cod_advance.reconciliation.required"), true);
});

test("does not call Payment Link helpers and customer-safe response hides secrets/fingerprints", async () => {
  const h = harness();
  const result = await createCodAdvanceRazorpayOrder({ shopId: "shop-1", shopDomain: "s", checkoutIntentId: "intent-1", customerProfileId: "customer-1" }, h.deps);
  assert.deepEqual(Object.keys(result.razorpayOrder).sort(), ["amount", "currency", "id", "keyId"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("fp-1"), false);
  assert.equal(h.state.gatewayCalls[0].receipt.startsWith("LD-COD-"), true);
  assert.equal(h.state.gatewayCalls[0].notes.purpose, "COD_ADVANCE");
});
