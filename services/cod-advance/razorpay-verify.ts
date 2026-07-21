/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";

import { resolveExpressCheckoutCodPolicy, type CodPolicyDto } from "./resolver";

export type CodAdvanceRazorpayVerifyInput = {
  shopId: string;
  shopDomain: string;
  checkoutIntentId: string;
  customerProfileId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export type CodAdvanceRazorpayVerifyOutput = {
  verified: true;
  reused: boolean;
  checkoutIntentId: string;
  paymentId: string;
  cod: { codAdvanceIntentId: string; advancePaidPaise: number; codBalanceAmountPaise: number; orderTotalPaise: number; storeCreditAppliedPaise: number; currency: string; status: "ADVANCE_PAID" };
  resume: { allowed: true; nextAction: "CREATE_PARTIAL_COD_ORDER" };
  verifiedAt: Date;
};

type Db = any;
type Deps = { db?: Db; now?: () => Date; fetch?: typeof fetch; audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>; resolvePolicy?: typeof resolveExpressCheckoutCodPolicy; keySecret?: string };

export class CodAdvanceRazorpayVerifyError extends Error {
  status: 400 | 404 | 409 | 503;
  code: string;
  constructor(status: 400 | 404 | 409 | 503, code: string, message: string) { super(message); this.name = "CodAdvanceRazorpayVerifyError"; this.status = status; this.code = code; }
}

function secret(deps: Deps) { const value = String(deps.keySecret ?? "").trim(); if (!value) throw new CodAdvanceRazorpayVerifyError(503, "RAZORPAY_NOT_CONFIGURED", "Razorpay is not configured"); return value; }
function audit(deps: Deps, eventType: string, entityType: string, entityId: string | null, payload?: unknown) { return (deps.audit || (async () => undefined))(eventType, entityType, entityId, payload).catch(() => undefined); }
function safe(value: unknown) { return JSON.parse(JSON.stringify(value ?? null)); }
function signatureHash(signature: string) { return crypto.createHash("sha256").update(signature).digest("hex"); }
function sameCurrency(a: unknown, b: unknown) { return String(a || "").toUpperCase() === String(b || "").toUpperCase(); }
function assertEqual(actual: unknown, expected: unknown, code: string) { if (actual !== expected) throw new CodAdvanceRazorpayVerifyError(409, code, "COD advance verification state changed"); }
function validHex64(value: string) { return /^[a-f0-9]{64}$/i.test(value); }
function validSignature(input: CodAdvanceRazorpayVerifyInput, deps: Deps) { const expectedHex = crypto.createHmac("sha256", secret(deps)).update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`).digest("hex"); if (!validHex64(input.razorpay_signature)) return false; const expected = Buffer.from(expectedHex, "hex"); const actual = Buffer.from(input.razorpay_signature, "hex"); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual); }
function redactedPaymentPayload(payment: any) { return safe({ id: payment?.id || null, order_id: payment?.order_id || null, amount: payment?.amount ?? null, currency: payment?.currency || null, status: payment?.status || null, method: payment?.method || null, captured: payment?.captured ?? null }); }
function output(input: CodAdvanceRazorpayVerifyInput, payment: any, cod: any, reused: boolean, verifiedAt: Date): CodAdvanceRazorpayVerifyOutput { return { verified: true, reused, checkoutIntentId: input.checkoutIntentId, paymentId: payment.id, cod: { codAdvanceIntentId: cod.id, advancePaidPaise: cod.advanceAmountPaise, codBalanceAmountPaise: cod.codBalanceAmountPaise, orderTotalPaise: cod.orderAmountPaise, storeCreditAppliedPaise: cod.storeCreditAppliedPaise || 0, currency: cod.currency, status: "ADVANCE_PAID" }, resume: { allowed: true, nextAction: "CREATE_PARTIAL_COD_ORDER" }, verifiedAt }; }

async function fetchProviderPayment(input: CodAdvanceRazorpayVerifyInput, amountPaise: number, currency: string, deps: Deps) {
  const response = await (deps.fetch || fetch)(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.razorpay_payment_id)}`, { headers: { Authorization: `Basic ${Buffer.from(`:${secret(deps)}`).toString("base64")}` } });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok || !payload?.id) throw new CodAdvanceRazorpayVerifyError(503, "RAZORPAY_PAYMENT_LOOKUP_FAILED", "Razorpay payment lookup failed");
  if (payload.id !== input.razorpay_payment_id || payload.order_id !== input.razorpay_order_id || Number(payload.amount) !== amountPaise || !sameCurrency(payload.currency, currency) || String(payload.status) !== "captured") throw new CodAdvanceRazorpayVerifyError(409, "RAZORPAY_PAYMENT_INVALID", "Razorpay payment is not captured or does not match");
  return payload;
}

async function loadAndValidate(db: Db, input: CodAdvanceRazorpayVerifyInput, policy: CodPolicyDto, now: Date) {
  const checkout = await db.expressCheckoutIntent.findFirst({ where: { id: input.checkoutIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId }, include: { orderLink: true } });
  if (!checkout) throw new CodAdvanceRazorpayVerifyError(404, "CHECKOUT_NOT_FOUND", "Checkout not found");
  if (checkout.selectedPaymentMethod !== "COD" || checkout.status !== "PAYMENT_PENDING" || (checkout.expiresAt && checkout.expiresAt <= now) || checkout.orderLink?.shopifyOrderId || checkout.orderLink?.shopifyOrderName) throw new CodAdvanceRazorpayVerifyError(409, "CHECKOUT_NOT_VERIFIABLE", "Checkout is not verifiable");
  if (!policy.requiresAdvance || !policy.codAdvanceIntentId) throw new CodAdvanceRazorpayVerifyError(409, "COD_ADVANCE_NOT_REQUIRED", "COD advance is not required");
  const cod = await db.codAdvanceIntent.findFirst({ where: { id: policy.codAdvanceIntentId, shopId: input.shopId, customerProfileId: input.customerProfileId, expressCheckoutIntentId: input.checkoutIntentId } });
  if (!cod) throw new CodAdvanceRazorpayVerifyError(404, "COD_ADVANCE_INTENT_NOT_FOUND", "COD advance intent not found");
  const alreadyVerified = cod.status === "ADVANCE_PAID" && cod.razorpayPaymentId === input.razorpay_payment_id && cod.verifiedAt;
  if (!(["PAYMENT_PENDING", "ADVANCE_PAID"].includes(cod.status)) || (!alreadyVerified && cod.expiresAt && cod.expiresAt <= now) || cod.consumedAt || cod.shopifyDraftOrderId || cod.shopifyOrderId || cod.shopifyOrderName) throw new CodAdvanceRazorpayVerifyError(409, "COD_ADVANCE_INTENT_STALE", "COD advance intent is stale");
  assertEqual(policy.codAdvanceIntentId, cod.id, "POLICY_INTENT_MISMATCH"); assertEqual(policy.advanceAmountPaise, cod.advanceAmountPaise, "POLICY_AMOUNT_MISMATCH"); assertEqual(policy.codBalanceAmountPaise, cod.codBalanceAmountPaise, "POLICY_COD_BALANCE_MISMATCH"); assertEqual(policy.orderTotalPaise, cod.orderAmountPaise, "POLICY_ORDER_TOTAL_MISMATCH"); assertEqual(policy.storeCreditAppliedPaise, cod.storeCreditAppliedPaise || 0, "POLICY_STORE_CREDIT_MISMATCH"); if (!sameCurrency(policy.currency, cod.currency)) throw new CodAdvanceRazorpayVerifyError(409, "POLICY_CURRENCY_MISMATCH", "COD advance currency changed");
  const fresh = await db.codAdvanceIntent.findFirst({ where: { id: cod.id, shopId: input.shopId } });
  for (const key of ["pricingFingerprint", "settingsVersion", "merchandiseAmountPaise", "shopifyDiscountAmountPaise", "shippingAmountPaise", "codFeeAmountPaise", "storeCreditAppliedPaise", "customerCashLiabilityPaise", "orderAmountPaise", "advanceAmountPaise", "codBalanceAmountPaise"] as const) assertEqual(fresh?.[key], cod[key], "COD_ADVANCE_CHANGED");
  const payment = await db.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", razorpayOrderId: input.razorpay_order_id } });
  if (!payment) throw new CodAdvanceRazorpayVerifyError(404, "PAYMENT_NOT_FOUND", "COD advance payment not found");
  if (!["PENDING", "CONFIRMED"].includes(payment.status) || payment.amountPaise !== cod.advanceAmountPaise || !sameCurrency(payment.currency, cod.currency) || (payment.providerAmountPaise != null && payment.providerAmountPaise !== cod.advanceAmountPaise) || (payment.providerCurrency && !sameCurrency(payment.providerCurrency, cod.currency)) || (payment.razorpayPaymentId && payment.razorpayPaymentId !== input.razorpay_payment_id)) throw new CodAdvanceRazorpayVerifyError(409, "PAYMENT_NOT_VERIFIABLE", "COD advance payment is not verifiable");
  return { checkout, cod, payment };
}

export async function verifyCodAdvanceRazorpayPayment(input: CodAdvanceRazorpayVerifyInput, deps: Deps = {}): Promise<CodAdvanceRazorpayVerifyOutput> {
  const db: Db = deps.db || (await import("../db/prisma")).prisma; const now = deps.now?.() || new Date(); const resolvePolicy = deps.resolvePolicy || resolveExpressCheckoutCodPolicy;
  const tenantConfig = deps.keySecret === undefined ? await (await import("../razorpay/config")).getInternalRazorpayConfig(input.shopId) : null;
  const resolvedDeps = { ...deps, keySecret: deps.keySecret ?? (tenantConfig?.enabled ? tenantConfig.keySecret : "") };
  secret(resolvedDeps);
  const policy = await resolvePolicy(input, db, { audit: deps.audit });
  const first = await loadAndValidate(db, input, policy, now);
  if (!validSignature(input, resolvedDeps)) { await audit(deps, "cod_advance.payment.signature_invalid", "ExpressCheckoutPayment", first.payment.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: first.cod.id }); throw new CodAdvanceRazorpayVerifyError(400, "RAZORPAY_SIGNATURE_INVALID", "Invalid Razorpay signature"); }
  const provider = await fetchProviderPayment(input, first.cod.advanceAmountPaise, first.cod.currency, resolvedDeps);
  const otherPayment = await db.expressCheckoutPayment.findFirst({ where: { shopId: input.shopId, razorpayPaymentId: input.razorpay_payment_id, id: { not: first.payment.id } } });
  const otherCod = await db.codAdvanceIntent.findFirst({ where: { shopId: input.shopId, razorpayPaymentId: input.razorpay_payment_id, id: { not: first.cod.id } } });
  if (otherPayment || otherCod) throw new CodAdvanceRazorpayVerifyError(409, "RAZORPAY_PAYMENT_CONFLICT", "Razorpay payment id is already attached");
  try {
    const result = await db.$transaction(async (tx: any) => {
      if (typeof tx.$executeRaw === "function") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.shopId}:${input.checkoutIntentId}:cod_advance_razorpay_verify`}))`;
      const current = await loadAndValidate(tx, input, policy, deps.now?.() || new Date());
      if (current.payment.status === "CONFIRMED" && current.payment.razorpayPaymentId === input.razorpay_payment_id && current.payment.razorpayOrderId === input.razorpay_order_id && current.payment.verifiedAt && current.cod.status === "ADVANCE_PAID" && current.cod.razorpayPaymentId === input.razorpay_payment_id && current.cod.verifiedAt) return output(input, current.payment, current.cod, true, current.payment.verifiedAt);
      const paymentUpdate = await tx.expressCheckoutPayment.updateMany({ where: { id: current.payment.id, shopId: input.shopId, intentId: input.checkoutIntentId, method: "COD", purpose: "COD_ADVANCE", status: "PENDING", razorpayOrderId: input.razorpay_order_id, razorpayPaymentId: null }, data: { status: "CONFIRMED", razorpayPaymentId: input.razorpay_payment_id, razorpaySignatureHash: signatureHash(input.razorpay_signature), verifiedAt: now, providerAmountPaise: Number(provider.amount), providerCurrency: provider.currency, rawGatewayPayload: redactedPaymentPayload(provider), failureReason: null } });
      const codUpdate = await tx.codAdvanceIntent.updateMany({ where: { id: current.cod.id, shopId: input.shopId, expressCheckoutIntentId: input.checkoutIntentId, status: "PAYMENT_PENDING", paidAt: null, verifiedAt: null, consumedAt: null, shopifyDraftOrderId: null, shopifyOrderId: null, shopifyOrderName: null }, data: { status: "ADVANCE_PAID", razorpayPaymentId: input.razorpay_payment_id, providerReferenceId: input.razorpay_payment_id, paidAt: now, verifiedAt: now } });
      if (paymentUpdate.count !== 1 || codUpdate.count !== 1) throw new CodAdvanceRazorpayVerifyError(503, "COD_ADVANCE_RECONCILIATION_REQUIRED", "COD advance reconciliation required");
      return output(input, { ...current.payment, status: "CONFIRMED", razorpayPaymentId: input.razorpay_payment_id, verifiedAt: now }, { ...current.cod, status: "ADVANCE_PAID", razorpayPaymentId: input.razorpay_payment_id, paidAt: now, verifiedAt: now }, false, now);
    });
    await audit(deps, result.reused ? "cod_advance.payment.verification_reused" : "cod_advance.payment.verified", "ExpressCheckoutPayment", result.paymentId, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, codAdvanceIntentId: result.cod.codAdvanceIntentId });
    return result;
  } catch (error) {
    if (error instanceof CodAdvanceRazorpayVerifyError && error.code === "COD_ADVANCE_RECONCILIATION_REQUIRED") await audit(deps, "cod_advance.verification.reconciliation_required", "CodAdvanceIntent", first.cod.id, { shopId: input.shopId, checkoutIntentId: input.checkoutIntentId, paymentId: first.payment.id });
    throw error;
  }
}
