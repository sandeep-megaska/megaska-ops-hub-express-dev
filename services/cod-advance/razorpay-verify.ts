/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";

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
  codAdvanceIntentId: string;
  paymentId: string;
  reused: boolean;
  verifiedAt: Date;
};

type Db = any;
type Deps = {
  db?: Db;
  now?: () => Date;
  audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>;
  keySecret?: string;
};

export class CodAdvanceRazorpayVerifyError extends Error {
  status: 400 | 404 | 409 | 503;
  code: string;

  constructor(status: 400 | 404 | 409 | 503, code: string, message: string) {
    super(message);
    this.name = "CodAdvanceRazorpayVerifyError";
    this.status = status;
    this.code = code;
  }
}

function signatureHash(signature: string) {
  return crypto.createHash("sha256").update(signature).digest("hex");
}

function timingSafeSignatureEqual(expectedHex: string, actualHex: string) {
  if (!/^[a-f0-9]+$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safe(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function keySecret(deps: Deps) {
  const secret = String(deps.keySecret ?? process.env.RAZORPAY_KEY_SECRET ?? "").trim();
  if (!secret) throw new CodAdvanceRazorpayVerifyError(503, "RAZORPAY_NOT_CONFIGURED", "Razorpay is not configured");
  return secret;
}

function audit(deps: Deps, eventType: string, entityType: string, entityId: string | null, payload?: unknown) {
  return (deps.audit || (async () => undefined))(eventType, entityType, entityId, payload).catch(() => undefined);
}

function validateSignature(input: CodAdvanceRazorpayVerifyInput, deps: Deps) {
  const expected = crypto.createHmac("sha256", keySecret(deps)).update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`).digest("hex");
  if (!timingSafeSignatureEqual(expected, input.razorpay_signature)) {
    throw new CodAdvanceRazorpayVerifyError(400, "RAZORPAY_SIGNATURE_INVALID", "Invalid Razorpay signature");
  }
}

async function loadPaymentAndCod(db: Db, input: CodAdvanceRazorpayVerifyInput) {
  const payment = await db.expressCheckoutPayment.findFirst({
    where: {
      shopId: input.shopId,
      intentId: input.checkoutIntentId,
      method: "COD",
      purpose: "COD_ADVANCE",
      razorpayOrderId: input.razorpay_order_id,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) throw new CodAdvanceRazorpayVerifyError(404, "PAYMENT_NOT_FOUND", "COD advance payment not found");

  const cod = await db.codAdvanceIntent.findFirst({
    where: {
      shopId: input.shopId,
      expressCheckoutIntentId: input.checkoutIntentId,
      customerProfileId: input.customerProfileId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!cod) throw new CodAdvanceRazorpayVerifyError(404, "COD_ADVANCE_INTENT_NOT_FOUND", "COD advance intent not found");

  return { payment, cod };
}

export async function verifyCodAdvanceRazorpayPayment(input: CodAdvanceRazorpayVerifyInput, deps: Deps = {}): Promise<CodAdvanceRazorpayVerifyOutput> {
  validateSignature(input, deps);

  const db: Db = deps.db || (await import("../db/prisma")).prisma;
  const now = deps.now?.() || new Date();
  const { payment, cod } = await loadPaymentAndCod(db, input);

  await audit(deps, "cod_advance.payment.verification_started", "ExpressCheckoutPayment", payment.id, {
    shopId: input.shopId,
    checkoutIntentId: input.checkoutIntentId,
    codAdvanceIntentId: cod.id,
  });

  if (payment.razorpayPaymentId && payment.razorpayPaymentId !== input.razorpay_payment_id) {
    throw new CodAdvanceRazorpayVerifyError(409, "RAZORPAY_PAYMENT_CONFLICT", "Conflicting Razorpay payment id");
  }

  let result: CodAdvanceRazorpayVerifyOutput | null = null;
  try {
    result = await db.$transaction(async (tx: any) => {
      if (typeof tx.$executeRaw === "function") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.shopId}:${input.checkoutIntentId}:cod_advance_razorpay_verify`}))`;
      const currentPayment = await tx.expressCheckoutPayment.findFirst({ where: { id: payment.id, shopId: input.shopId } });
      const currentCod = await tx.codAdvanceIntent.findFirst({ where: { id: cod.id, shopId: input.shopId } });
      if (!currentPayment || !currentCod) throw new CodAdvanceRazorpayVerifyError(404, "COD_ADVANCE_PAYMENT_NOT_FOUND", "COD advance payment not found");

      if (currentPayment.status === "CONFIRMED" && currentCod.status === "ADVANCE_PAID") {
        return { codAdvanceIntentId: currentCod.id, paymentId: currentPayment.id, reused: true, verifiedAt: currentPayment.verifiedAt || currentCod.verifiedAt || now };
      }

      if (currentPayment.status !== "PENDING") throw new CodAdvanceRazorpayVerifyError(409, "INVALID_PAYMENT_STATE", "COD advance payment cannot be verified");
      if (!currentCod || currentCod.status !== "PAYMENT_PENDING") throw new CodAdvanceRazorpayVerifyError(409, "INVALID_COD_ADVANCE_STATE", "COD advance intent cannot be verified");
      if (currentPayment.amountPaise !== currentCod.advanceAmountPaise) throw new CodAdvanceRazorpayVerifyError(409, "COD_ADVANCE_AMOUNT_MISMATCH", "COD advance amount mismatch");

      const updatedPayment = await tx.expressCheckoutPayment.update({
        where: { id: currentPayment.id },
        data: {
          status: "CONFIRMED",
          verifiedAt: now,
          razorpayPaymentId: input.razorpay_payment_id,
          razorpaySignatureHash: signatureHash(input.razorpay_signature),
          rawGatewayPayload: safe({ razorpay_order_id: input.razorpay_order_id, razorpay_payment_id: input.razorpay_payment_id, razorpay_signature_hash: signatureHash(input.razorpay_signature) }),
          failureReason: null,
        },
      });
      const updatedCod = await tx.codAdvanceIntent.update({
        where: { id: currentCod.id },
        data: { status: "ADVANCE_PAID", razorpayPaymentId: input.razorpay_payment_id, paidAt: now, verifiedAt: now },
      });

      return { codAdvanceIntentId: updatedCod.id, paymentId: updatedPayment.id, reused: false, verifiedAt: now };
    });
  } catch (error) {
    await audit(deps, "cod_advance.payment.verification_failed", "ExpressCheckoutPayment", payment.id, {
      shopId: input.shopId,
      checkoutIntentId: input.checkoutIntentId,
      codAdvanceIntentId: cod.id,
      code: error instanceof CodAdvanceRazorpayVerifyError ? error.code : "COD_ADVANCE_VERIFY_FAILED",
    });
    throw error;
  }

  if (!result) {
    throw new CodAdvanceRazorpayVerifyError(503, "COD_ADVANCE_VERIFY_EMPTY_RESULT", "COD advance verification did not return a result");
  }

  await audit(deps, result.reused ? "cod_advance.payment.verification_reused" : "cod_advance.payment.verified", "ExpressCheckoutPayment", result.paymentId, {
    shopId: input.shopId,
    checkoutIntentId: input.checkoutIntentId,
    codAdvanceIntentId: result.codAdvanceIntentId,
  });

  return result;
}
