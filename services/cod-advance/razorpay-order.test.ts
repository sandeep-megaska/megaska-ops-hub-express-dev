/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import { CodAdvanceRazorpayOrderError, createCodAdvanceRazorpayOrder } from "./razorpay-order.ts";

const future = () => new Date(Date.now() + 60 * 60_000);

function rows(overrides: any = {}) {
  return {
    checkout: { id: "chk-1", shopId: "shop-1", customerProfileId: "cust-1", status: "PAYMENT_SELECTED", selectedPaymentMethod: "COD", expiresAt: future(), currency: "INR", ...overrides.checkout },
    cod: { id: "cod-1", shopId: "shop-1", customerProfileId: "cust-1", expressCheckoutIntentId: "chk-1", status: "CREATED", paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, razorpayPaymentId: null, advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderAmountPaise: 110000, storeCreditAppliedPaise: 0, currency: "INR", settingsVersion: 1, pricingFingerprint: "fp", expiresAt: future(), ...overrides.cod },
    payments: overrides.payments || [] as any[],
    audits: [] as any[],
    transitionCounts: overrides.transitionCounts || [1],
    events: [] as string[],
  };
}

function harness(state = rows()) {
  let paymentSeq = state.payments.length;
  const table = {
    expressCheckoutIntent: { findFirst: async () => state.checkout },
    codAdvanceIntent: {
      findFirst: async () => state.cod,
      updateMany: async () => ({ count: state.transitionCounts.shift() ?? 1 }),
    },
    expressCheckoutPayment: {
      findFirst: async (args: any) => state.payments.find((p: any) => p.status === args.where.status && (args.where.razorpayOrderId?.not === null ? p.razorpayOrderId : args.where.razorpayOrderId === null ? !p.razorpayOrderId : true) && p.amountPaise === (args.where.amountPaise ?? p.amountPaise)) || null,
      create: async (args: any) => { state.events.push("reserve"); const p = { id: `pay-${++paymentSeq}`, razorpayOrderId: null, ...args.data }; state.payments.push(p); return p; },
      update: async (args: any) => { state.events.push(args.data.razorpayOrderId ? "persist-order" : "mark-failed"); const p = state.payments.find((x: any) => x.id === args.where.id); Object.assign(p, args.data); return p; },
    },
    $executeRaw: async () => undefined,
    $transaction: async (fn: any) => fn(table),
  } as any;
  const deps = {
    db: table,
    resolveShop: async () => ({ id: "shop-1", isActive: true }),
    getKeyId: () => "rzp_test_key",
    resolvePolicy: async () => ({ requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderTotalPaise: 110000, storeCreditAppliedPaise: 0, currency: "INR" }) as any,
    audit: async (...args: any[]) => { state.audits.push(args); },
  };
  return { state, deps };
}

const input = { shopId: "shop-1", shopDomain: "shop.example", checkoutIntentId: "chk-1", customerProfileId: "cust-1" };

test("public input and output contract remain route-compatible", async () => {
  const h = harness();
  const result = await createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => ({ id: "order_1", amount: 12000, currency: "INR" }) });
  assert.deepEqual(Object.keys(result).sort(), ["cod", "paymentId", "razorpayOrder", "reused"].sort());
  assert.deepEqual(Object.keys(result.razorpayOrder).sort(), ["amount", "currency", "id", "keyId"].sort());
  assert.deepEqual(Object.keys(result.cod).sort(), ["advanceAmountPaise", "codAdvanceIntentId", "codBalanceAmountPaise", "orderTotalPaise", "storeCreditAppliedPaise"].sort());
  assert.equal((input as any).codAdvanceIntentId, undefined);
});

test("two sequential concurrent-equivalent calls result in one provider order", async () => {
  const h = harness();
  let calls = 0;
  await createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => ({ id: `order_${++calls}`, amount: 12000, currency: "INR" }) });
  const retry = await createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => { calls += 1; return { id: "duplicate", amount: 12000, currency: "INR" }; } });
  assert.equal(calls, 1);
  assert.equal(retry.razorpayOrder.id, "order_1");
  assert.equal(retry.reused, true);
});

test("reserved in-progress attempt prevents duplicate provider call", async () => {
  const h = harness(rows({ payments: [{ id: "pay-pending", shopId: "shop-1", intentId: "chk-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: 12000, currency: "INR", razorpayOrderId: null }] }));
  let calls = 0;
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => { calls += 1; return { id: "order_1" }; } }), (error: any) => error instanceof CodAdvanceRazorpayOrderError && error.code === "PAYMENT_IN_PROGRESS");
  assert.equal(calls, 0);
});

test("provider failure leaves durable FAILED payment", async () => {
  const h = harness();
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => { throw new Error("network_down"); } }), /Could not start/);
  assert.equal(h.state.payments[0].status, "FAILED");
  assert.match(h.state.payments[0].failureReason, /network_down/);
});

test("provider mismatch leaves durable FAILED payment", async () => {
  const h = harness();
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => ({ id: "order_bad", amount: 1, currency: "USD" }) }));
  assert.equal(h.state.payments[0].status, "FAILED");
  assert.equal(h.state.cod.status, "CREATED");
});

test("success persists provider order before COD transition", async () => {
  const h = harness();
  await createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => ({ id: "order_1", amount: 12000, currency: "inr" }) });
  assert.deepEqual(h.state.events.slice(0, 2), ["reserve", "persist-order"]);
  assert.equal(h.state.payments[0].razorpayOrderId, "order_1");
});

test("zero-row COD transition retains provider order/payment for reconciliation", async () => {
  const h = harness(rows({ transitionCounts: [0] }));
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => ({ id: "order_1", amount: 12000, currency: "INR" }) }), (error: any) => error.code === "COD_ADVANCE_RECONCILIATION_REQUIRED");
  assert.equal(h.state.payments[0].razorpayOrderId, "order_1");
  assert.equal(h.state.payments[0].status, "PENDING");
  assert.equal(h.state.audits[0][0], "reconciliation.required");
});

test("PAYMENT_PENDING retry reuses persisted order", async () => {
  const h = harness(rows({ cod: { status: "PAYMENT_PENDING" }, payments: [{ id: "pay-1", shopId: "shop-1", intentId: "chk-1", purpose: "COD_ADVANCE", method: "COD", status: "PENDING", amountPaise: 12000, currency: "INR", razorpayOrderId: "order_1", providerAmountPaise: 12000, providerCurrency: "INR" }] }));
  const result = await createCodAdvanceRazorpayOrder(input, { ...h.deps, createGatewayOrder: async () => { throw new Error("should not call"); } });
  assert.equal(result.reused, true);
  assert.equal(result.razorpayOrder.id, "order_1");
});

test("shop/customer/policy/fingerprint validations remain intact", async () => {
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, harness(rows({ checkout: { customerProfileId: "other" } })).deps), (error: any) => error.code === "CHECKOUT_NOT_FOUND");
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, harness(rows({ checkout: { selectedPaymentMethod: "PREPAID" } })).deps), (error: any) => error.code === "COD_PAYMENT_METHOD_REQUIRED");
  await assert.rejects(() => createCodAdvanceRazorpayOrder(input, harness(rows({ cod: { advanceAmountPaise: 13000 } })).deps), (error: any) => error.code === "COD_ADVANCE_POLICY_CHANGED");
});
