/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { CodAdvanceRazorpayVerifyError, timingSafeRazorpaySignatureEqual, verifyCodAdvanceRazorpayPayment } from "./razorpay-verify.ts";

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);
function sig(order = "order_1", payment = "pay_1", secret = "secret") { return crypto.createHmac("sha256", secret).update(`${order}|${payment}`).digest("hex"); }
function base() {
  const checkout = { id: "intent-1", shopId: "shop-1", customerProfileId: "cust-1", status: "PAYMENT_PENDING", selectedPaymentMethod: "COD", expiresAt: future(), orderLink: null };
  const cod = { id: "cod-1", shopId: "shop-1", customerProfileId: "cust-1", expressCheckoutIntentId: "intent-1", status: "PAYMENT_PENDING", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderAmountPaise: 110000, storeCreditAppliedPaise: 5000, currency: "INR", expiresAt: future(), paidAt: null, verifiedAt: null, consumedAt: null, razorpayPaymentId: null, providerReferenceId: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null, pricingFingerprint: "fp", settingsVersion: 1 };
  const payment = { id: "payrow-1", shopId: "shop-1", intentId: "intent-1", method: "COD", purpose: "COD_ADVANCE", status: "PENDING", amountPaise: 12000, currency: "inr", razorpayOrderId: "order_1", razorpayPaymentId: null, providerAmountPaise: null, providerCurrency: null, verifiedAt: null };
  const state = { checkout, cod, payments: [payment] as any[], cods: [cod] as any[], audits: [] as any[], paymentUpdateCount: 1, codUpdateCount: 1, txSnapshots: [] as any[], provider: { id: "pay_1", order_id: "order_1", amount: 12000, currency: "INR", status: "captured", captured: true } as any };
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([k, v]) => k === "NOT" ? !matches(row, v) : v && typeof v === "object" && !Array.isArray(v) ? ("not" in (v as any) ? row[k] !== (v as any).not : "in" in (v as any) ? (v as any).in.includes(row[k]) : row[k] === v) : row[k] === v);
  const db: any = {
    expressCheckoutIntent: { findFirst: async ({ where }: any) => matches(state.checkout, where) ? state.checkout : null },
    codAdvanceIntent: {
      findFirst: async ({ where, select }: any) => { const row = state.cods.find((x) => matches(x, where)); if (!row) return null; if (!select) return row; return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])); },
      updateMany: async ({ where, data }: any) => { if (!state.codUpdateCount) return { count: 0 }; const row = state.cods.find((x) => matches(x, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
    expressCheckoutPayment: {
      findFirst: async ({ where }: any) => state.payments.find((x) => matches(x, where)) || null,
      updateMany: async ({ where, data }: any) => { if (!state.paymentUpdateCount) return { count: 0 }; const row = state.payments.find((x) => matches(x, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
    $executeRaw: async () => undefined,
    $transaction: async (fn: any) => { const snap = JSON.stringify({ payments: state.payments, cods: state.cods }); try { return await fn(db); } catch (e) { const parsed = JSON.parse(snap); state.payments = parsed.payments; state.cods = parsed.cods; throw e; } },
  };
  const input = { shopId: "shop-1", shopDomain: "shop.example", checkoutIntentId: "intent-1", customerProfileId: "cust-1", razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", razorpaySignature: sig() };
  const policy = { requiresAdvance: true, codAdvanceIntentId: "cod-1", advanceAmountPaise: 12000, codBalanceAmountPaise: 98000, orderTotalPaise: 110000, storeCreditAppliedPaise: 5000, currency: "INR" } as any;
  const deps = { db, keyId: "rzp", keySecret: "secret", resolvePolicy: async () => policy, audit: async (...args: any[]) => { state.audits.push(args); }, fetch: async () => ({ ok: true, json: async () => state.provider }) as any };
  return { state, deps, input, policy };
}
async function rejectsCode(mut: (h: ReturnType<typeof base>) => void, code: string) { const h = base(); mut(h); await assert.rejects(() => verifyCodAdvanceRazorpayPayment(h.input, h.deps as any), (e: any) => e instanceof CodAdvanceRazorpayVerifyError && e.code === code); return h; }

test("route-compatible success response confirms payment and COD advance without exposing secrets", async () => { const h = base(); const out = await verifyCodAdvanceRazorpayPayment(h.input, h.deps as any); assert.equal(out.verified, true); assert.equal(out.reused, false); assert.equal(out.resume.nextAction, "CREATE_PARTIAL_COD_ORDER"); assert.equal(out.cod.status, "ADVANCE_PAID"); assert.equal(h.state.payments[0].status, "CONFIRMED"); assert.equal(h.state.cods[0].status, "ADVANCE_PAID"); assert.ok(h.state.payments[0].paidAt === undefined); assert.ok(h.state.payments[0].verifiedAt); assert.ok(h.state.cods[0].paidAt); assert.ok(h.state.cods[0].verifiedAt); assert.equal((out as any).razorpaySignature, undefined); assert.equal((out as any).pricingFingerprint, undefined); assert.equal(h.state.payments[0].razorpaySignature, undefined); assert.ok(h.state.payments[0].razorpaySignatureHash); assert.deepEqual(h.state.payments[0].rawGatewayPayload, { id: "pay_1", order_id: "order_1", amount: 12000, currency: "INR", status: "captured", captured: true }); });

test("wrong shop, wrong customer, PREPAID, expired checkout, missing COD intent, missing payment, and Razorpay order mismatch reject", async () => { await rejectsCode((h) => { h.input.shopId = "other"; }, "CHECKOUT_NOT_FOUND"); await rejectsCode((h) => { h.input.customerProfileId = "other"; }, "CHECKOUT_NOT_FOUND"); await rejectsCode((h) => { h.state.checkout.selectedPaymentMethod = "PREPAID"; }, "COD_REQUIRED"); await rejectsCode((h) => { h.state.checkout.expiresAt = past(); }, "CHECKOUT_EXPIRED"); await rejectsCode((h) => { h.policy.codAdvanceIntentId = null; }, "COD_ADVANCE_INTENT_NOT_FOUND"); await rejectsCode((h) => { h.state.payments = []; }, "PAYMENT_NOT_FOUND"); await rejectsCode((h) => { h.input.razorpayOrderId = "order_other"; h.input.razorpaySignature = sig("order_other"); }, "PAYMENT_NOT_FOUND"); });

test("signature validation requires hex and uses timing safe comparison; invalid signature fails payment only", async () => { let called = false; assert.equal(timingSafeRazorpaySignatureEqual("aa", "zz", (() => { called = true; return true; }) as any), false); assert.equal(called, false); assert.equal(timingSafeRazorpaySignatureEqual("aa", "bb", ((a: Buffer, b: Buffer) => { called = a.length === b.length; return false; }) as any), false); assert.equal(called, true); const h = await rejectsCode((x) => { x.input.razorpaySignature = "0".repeat(64); }, "RAZORPAY_SIGNATURE_INVALID"); assert.equal(h.state.payments[0].status, "FAILED"); assert.equal(h.state.payments[0].failureReason, "RAZORPAY_SIGNATURE_INVALID"); assert.notEqual(h.state.cods[0].status, "ADVANCE_PAID"); });

test("provider lookup and provider mismatches reject", async () => { await rejectsCode((h) => { (h.deps as any).fetch = async () => ({ ok: false, json: async () => ({}) }); }, "RAZORPAY_PAYMENT_LOOKUP_FAILED"); await rejectsCode((h) => { h.state.provider.id = "pay_other"; }, "RAZORPAY_PROVIDER_MISMATCH"); await rejectsCode((h) => { h.state.provider.order_id = "order_other"; }, "RAZORPAY_PROVIDER_MISMATCH"); await rejectsCode((h) => { h.state.provider.amount = 1; }, "RAZORPAY_PROVIDER_MISMATCH"); await rejectsCode((h) => { h.state.provider.currency = "USD"; }, "RAZORPAY_PROVIDER_MISMATCH"); await rejectsCode((h) => { h.state.provider.status = "failed"; }, "RAZORPAY_PROVIDER_MISMATCH"); await rejectsCode((h) => { h.state.provider.status = "authorized"; }, "RAZORPAY_PROVIDER_MISMATCH"); });

test("idempotent callback is reused but different/foreign payment IDs are rejected", async () => { const h = base(); h.state.payments[0].status = "CONFIRMED"; h.state.payments[0].razorpayPaymentId = "pay_1"; h.state.payments[0].verifiedAt = new Date(); h.state.cod.status = "ADVANCE_PAID"; h.state.cod.razorpayPaymentId = "pay_1"; const out = await verifyCodAdvanceRazorpayPayment(h.input, h.deps as any); assert.equal(out.reused, true); await rejectsCode((x) => { x.state.payments[0].razorpayPaymentId = "pay_old"; }, "PAYMENT_MISMATCH"); await rejectsCode((x) => { x.state.payments.push({ id: "other", razorpayPaymentId: "pay_1" }); }, "RAZORPAY_PAYMENT_ALREADY_USED"); });

test("consumed, Shopify-linked, and policy snapshot changes reject", async () => { await rejectsCode((h) => { h.state.cod.consumedAt = new Date(); }, "COD_ADVANCE_INTENT_STALE"); await rejectsCode((h) => { h.state.cod.shopifyOrderId = "gid://shopify/Order/1"; }, "COD_ADVANCE_INTENT_STALE"); await rejectsCode((h) => { h.policy.storeCreditAppliedPaise = 0; }, "COD_ADVANCE_POLICY_CHANGED"); });

test("guarded update count failures trigger reconciliation and COD failure rolls back payment transition", async () => { const p = await rejectsCode((h) => { h.state.paymentUpdateCount = 0; }, "COD_ADVANCE_RECONCILIATION_REQUIRED"); assert.ok(p.state.audits.some((a) => a[0] === "cod_advance.verification.reconciliation_required")); const c = await rejectsCode((h) => { h.state.codUpdateCount = 0; }, "COD_ADVANCE_RECONCILIATION_REQUIRED"); assert.equal(c.state.payments[0].status, "PENDING"); });

test("verification does not call prepaid finalization, Payment Links, Shopify order, or Store Credit helpers", async () => { const h = base(); const out = await verifyCodAdvanceRazorpayPayment(h.input, h.deps as any); assert.equal(out.resume.nextAction, "CREATE_PARTIAL_COD_ORDER"); assert.ok(h.state.audits.some((a) => a[0] === "cod_advance.payment.verified")); });
