/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { verifyCodAdvanceRazorpayPayment } from "./razorpay-verify.ts";

const SECRET = "secret";
const future = () => new Date(Date.now() + 60_000);
function sig(order = "order_1", payment = "pay_rzp_1") { return crypto.createHmac("sha256", SECRET).update(`${order}|${payment}`).digest("hex"); }
function base() {
  const checkout = { id: "intent-1", shopId: "shop-1", customerProfileId: "cust-1", status: "PAYMENT_PENDING", selectedPaymentMethod: "COD", expiresAt: future(), orderLink: null };
  const cod = { id: "cod-1", shopId: "shop-1", customerProfileId: "cust-1", expressCheckoutIntentId: "intent-1", status: "PAYMENT_PENDING", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderAmountPaise: 110000, storeCreditAppliedPaise: 500, currency: "INR", expiresAt: future(), paidAt: null, verifiedAt: null, consumedAt: null, razorpayPaymentId: null, providerReferenceId: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, pricingFingerprint: "fp", settingsVersion: 1, merchandiseAmountPaise: 100000, shopifyDiscountAmountPaise: 0, shippingAmountPaise: 5000, codFeeAmountPaise: 5000, customerCashLiabilityPaise: 109500 };
  const payment = { id: "pay-local-1", shopId: "shop-1", intentId: "intent-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: 12000, currency: "INR", verifiedAt: null, providerAmountPaise: 12000, providerCurrency: "INR", razorpayOrderId: "order_1", razorpayPaymentId: null };
  const state = { checkout, cod, payment, otherPayment: null as any, otherCod: null as any, audits: [] as any[], paymentUpdateCount: 1, codUpdateCount: 1, provider: { id: "pay_rzp_1", order_id: "order_1", amount: 12000, currency: "inr", status: "captured", method: "upi", captured: true }, fetched: [] as string[] };
  const findCod = (where: any) => {
    if (where?.razorpayPaymentId && where?.id?.not === state.cod.id) return state.otherCod;
    if (where?.id && where.id !== state.cod.id) return null;
    return state.cod;
  };
  const findPayment = (where: any) => {
    if (where?.razorpayPaymentId && where?.id?.not === state.payment.id) return state.otherPayment;
    if (where?.id && where.id !== state.payment.id) return null;
    if (where?.razorpayOrderId && where.razorpayOrderId !== state.payment.razorpayOrderId) return null;
    return state.payment;
  };
  const db: any = {
    expressCheckoutIntent: { findFirst: async ({ where }: any) => where.id === state.checkout.id && where.shopId === state.checkout.shopId && where.customerProfileId === state.checkout.customerProfileId ? state.checkout : null },
    codAdvanceIntent: { findFirst: async ({ where }: any) => findCod(where), updateMany: async ({ data }: any) => { if (state.codUpdateCount === 1) Object.assign(state.cod, data); return { count: state.codUpdateCount }; } },
    expressCheckoutPayment: { findFirst: async ({ where }: any) => findPayment(where), updateMany: async ({ data }: any) => { if (state.paymentUpdateCount === 1) Object.assign(state.payment, data); return { count: state.paymentUpdateCount }; } },
    $executeRaw: async () => undefined,
    $transaction: async (fn: any) => fn(db),
  };
  const policy = { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderTotalPaise: 110000, storeCreditAppliedPaise: 500, currency: "INR" } as any;
  const input = { shopId: "shop-1", shopDomain: "shop.example", checkoutIntentId: "intent-1", customerProfileId: "cust-1", razorpay_order_id: "order_1", razorpay_payment_id: "pay_rzp_1", razorpay_signature: sig() };
  const deps = { db, keySecret: SECRET, resolvePolicy: async () => policy, audit: async (...args: any[]) => state.audits.push(args), fetch: async (url: string) => { state.fetched.push(url); return { ok: true, json: async () => state.provider } as any; } };
  return { state, deps, input, policy };
}

test("provider lookup validates captured payment and returns customer-safe resume DTO", async () => {
  const h = base(); const result = await verifyCodAdvanceRazorpayPayment(h.input, h.deps as any);
  assert.equal(h.state.fetched[0], "https://api.razorpay.com/v1/payments/pay_rzp_1");
  assert.equal(result.verified, true); assert.equal(result.cod.status, "ADVANCE_PAID"); assert.equal(result.cod.storeCreditAppliedPaise, 500); assert.equal(result.resume.nextAction, "CREATE_PARTIAL_COD_ORDER"); assert.equal((result as any).pricingFingerprint, undefined);
});

test("amount, order, and currency mismatches are rejected", async () => {
  for (const patch of [{ amount: 11999 }, { order_id: "other" }, { currency: "USD" }, { status: "authorized" }]) { const h = base(); Object.assign(h.state.provider, patch); await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e.code === "RAZORPAY_PAYMENT_INVALID"); }
});

test("invalid signature leaves local payment and COD intent pending and emits signature event", async () => {
  const h = base(); await assert.rejects(() => verifyCodAdvanceRazorpayPayment({ ...h.input, razorpay_signature: "00" }, h.deps as any), (e: any) => e.code === "RAZORPAY_SIGNATURE_INVALID");
  assert.equal(h.state.payment.status, "PENDING"); assert.equal(h.state.cod.status, "PAYMENT_PENDING"); assert.ok(h.state.audits.some((a) => a[0] === "cod_advance.payment.signature_invalid"));
});

test("exact idempotent replay is reused", async () => {
  const h = base(); const verifiedAt = new Date(); Object.assign(h.state.payment, { status: "CONFIRMED", razorpayPaymentId: "pay_rzp_1", verifiedAt }); Object.assign(h.state.cod, { status: "ADVANCE_PAID", razorpayPaymentId: "pay_rzp_1", verifiedAt });
  const result = await verifyCodAdvanceRazorpayPayment(h.input, h.deps as any); assert.equal(result.reused, true);
});

test("conflicting payment id attached elsewhere is rejected", async () => {
  const h = base(); h.state.otherPayment = { id: "other" }; await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e.code === "RAZORPAY_PAYMENT_CONFLICT");
});

test("Store Credit and policy changes are rejected", async () => {
  const h = base(); h.policy.storeCreditAppliedPaise = 0; await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e.code === "POLICY_STORE_CREDIT_MISMATCH");
});

test("consumed or Shopify-linked intent is rejected", async () => {
  const h = base(); h.state.cod.consumedAt = new Date(); await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e.code === "COD_ADVANCE_INTENT_STALE");
  const h2 = base(); h2.state.cod.shopifyOrderId = "gid://shopify/Order/1"; await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h2.input, h2.deps as any), (e: any) => e.code === "COD_ADVANCE_INTENT_STALE");
});

test("guarded transition rollback path returns reconciliation event and no side effects beyond payment/COD records", async () => {
  const h = base(); h.state.codUpdateCount = 0; await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e.status === 503 && e.code === "COD_ADVANCE_RECONCILIATION_REQUIRED");
  assert.ok(h.state.audits.some((a) => a[0] === "cod_advance.verification.reconciliation_required"));
  assert.equal((h.state as any).shopifyOrderCreated, undefined); assert.equal((h.state as any).storeCreditMutated, undefined);
});
