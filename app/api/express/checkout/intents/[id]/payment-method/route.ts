import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";
import { getExpressCheckoutSettings } from "../../../../../../../services/express-checkout/settings";
import { CheckoutStateDb, transitionCheckoutIntent } from "../../../../../../../lib/express-checkout/state-machine";

export const runtime = "nodejs";

const BLOCKED_STATUSES: readonly string[] = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED", "ORDER_COMPLETED", "ORDER_CREATING", "PAYMENT_CONFIRMED", "PAYMENT_SUCCESS", "PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_CANCELLED", "DRAFT_ORDER_CREATED"];
const PAYMENT_METHODS = ["COD", "PREPAID"] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const COD_STATE_ORDER = ["INITIATED", "SESSION_VERIFIED", "ADDRESS_COMPLETED", "DELIVERY_VALIDATED", "PAYMENT_SELECTED", "DRAFT_ORDER_CREATED", "ORDER_COMPLETED"] as const;
const COD_LEGACY_STATUS_EQUIVALENTS: Record<string, (typeof COD_STATE_ORDER)[number]> = { CREATED: "INITIATED", CUSTOMER_AUTHENTICATED: "SESSION_VERIFIED", CART_SNAPSHOT_LOCKED: "SESSION_VERIFIED", ADDRESS_CAPTURED: "ADDRESS_COMPLETED", DISCOUNT_APPLIED: "ADDRESS_COMPLETED", PAYMENT_METHOD_SELECTED: "PAYMENT_SELECTED", ORDER_CREATED: "ORDER_COMPLETED" };

async function transitionCodIntent(input: { intent: { id: string; shopId: string; status: string }; toStatus: (typeof COD_STATE_ORDER)[number]; reason: string; metadata?: Record<string, unknown> }) {
  const effectiveStatus = COD_LEGACY_STATUS_EQUIVALENTS[input.intent.status] || input.intent.status;
  const fromIndex = COD_STATE_ORDER.indexOf(effectiveStatus as (typeof COD_STATE_ORDER)[number]);
  const toIndex = COD_STATE_ORDER.indexOf(input.toStatus);

  if (fromIndex >= toIndex && fromIndex >= 0) {
    console.info("[CHECKOUT STATE] cod_transition_already_satisfied", { shopId: input.intent.shopId, intentId: input.intent.id, fromStatus: input.intent.status, effectiveStatus, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata || {} });
    return { ok: true as const, fromStatus: input.intent.status, toStatus: input.toStatus, changed: false };
  }

  if (effectiveStatus !== input.intent.status) {
    console.info("[CHECKOUT STATE] cod_legacy_status_normalized", { shopId: input.intent.shopId, intentId: input.intent.id, fromStatus: input.intent.status, effectiveStatus, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata || {} });
    await (prisma as unknown as CheckoutStateDb).expressCheckoutIntent.updateMany({ where: { id: input.intent.id, shopId: input.intent.shopId, status: input.intent.status }, data: { status: effectiveStatus } });
    return transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: { ...input.intent, status: effectiveStatus }, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata });
  }

  return transitionCheckoutIntent({ db: prisma as unknown as CheckoutStateDb, intent: input.intent, toStatus: input.toStatus, reason: input.reason, metadata: input.metadata });
}

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function checkoutPerfLog(event: string, details: { shopId?: string; intentId?: string; customerProfileId?: string; selectedPaymentMethod?: unknown; durationMs?: number | null }) {
  console.info(`[CHECKOUT PERF] ${event}`, {
    shopId: details.shopId || null,
    intentId: details.intentId || null,
    customerProfileId: details.customerProfileId || null,
    selectedPaymentMethod: details.selectedPaymentMethod || null,
    durationMs: typeof details.durationMs === "number" ? Math.round(details.durationMs) : null,
  });
}

function elapsedMs(startedAt: number) {
  return Date.now() - startedAt;
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.includes(value as PaymentMethod);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const totalStartedAt = Date.now();
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);

  if ("error" in auth) return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  if (!customerProfileId) return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  if (!isPaymentMethod(body.method)) return jsonWithCors(req, { ok: false, error: "method must be COD or PREPAID" }, { status: 400 });

  checkoutPerfLog("payment_method_switch_start", { shopId: shop.shopId, intentId, customerProfileId, selectedPaymentMethod: body.method });

  const intentWhere = { shopId: shop.shopId, id: intentId, customerProfileId };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  }
  if (intent.expiresAt && intent.expiresAt <= new Date()) return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });

  const method = body.method;
  const settings = await getExpressCheckoutSettings(shop.shopId);
  const codFeeAmountPaise = method === "COD" ? settings.codFeeAmountPaise : 0;
  const totalAmountPaise = Math.max(0, intent.subtotalAmountPaise + intent.shippingAmountPaise + codFeeAmountPaise - intent.discountAmountPaise);
  const amountPaise = method === "COD" ? 0 : totalAmountPaise;
  const paymentStatus = method === "COD" ? "NOT_REQUIRED" : "PENDING";

  const persistStartedAt = Date.now();
  const result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutPayment.deleteMany({ where: { shopId: shop.shopId, intentId, method, status: "PENDING", intent: { customerProfileId } } });

    const payment = await tx.expressCheckoutPayment.create({ data: { shopId: shop.shopId, intentId, method, status: paymentStatus, amountPaise, currency: intent.currency } });

    await tx.expressCheckoutIntent.updateMany({ where: intentWhere, data: { selectedPaymentMethod: method, codFeeAmountPaise, totalAmountPaise } });
    const updatedIntent = await tx.expressCheckoutIntent.findFirstOrThrow({ where: intentWhere });

    return { intent: updatedIntent, payment };
  });

  if (method === "COD") {
    const deliveryTransition = await transitionCodIntent({
      intent: { id: result.intent.id, shopId: result.intent.shopId, status: result.intent.status },
      toStatus: "DELIVERY_VALIDATED",
      reason: "cod_delivery_validated",
      metadata: { source: "payment_method_selection" },
    });
    const paymentTransition = deliveryTransition.ok
      ? await transitionCodIntent({
          intent: { id: result.intent.id, shopId: result.intent.shopId, status: COD_STATE_ORDER.indexOf(result.intent.status as (typeof COD_STATE_ORDER)[number]) > COD_STATE_ORDER.indexOf("DELIVERY_VALIDATED") ? result.intent.status : "DELIVERY_VALIDATED" },
          toStatus: "PAYMENT_SELECTED",
          reason: "cod_payment_selected",
          metadata: { method },
        })
      : deliveryTransition;
    if (!paymentTransition.ok) {
      return jsonWithCors(req, { ok: false, error: `Intent status ${paymentTransition.fromStatus} cannot be updated` }, { status: 409 });
    }
    result.intent = await prisma.expressCheckoutIntent.findFirstOrThrow({ where: intentWhere });
  }

  checkoutPerfLog("payment_method_switch_persist_ms", { shopId: shop.shopId, intentId, customerProfileId, selectedPaymentMethod: method, durationMs: elapsedMs(persistStartedAt) });
  checkoutPerfLog("payment_method_switch_total_ms", { shopId: shop.shopId, intentId, customerProfileId, selectedPaymentMethod: method, durationMs: elapsedMs(totalStartedAt) });

  return jsonWithCors(req, { ok: true, ...result }, { status: 201 });
}
