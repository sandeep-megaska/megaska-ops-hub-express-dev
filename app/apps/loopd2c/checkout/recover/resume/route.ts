import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CHECKOUT_RECOVERY_EXPIRED_MESSAGE, validateCheckoutRecoveryToken } from "../../../../../../services/express-checkout/recovery/tokens";
import { prisma } from "../../../../../../services/db/prisma";
import { requireEnabledModule, requireShopFromAppProxy } from "../../../../../../services/shopify/app-proxy";

export const dynamic = "force-dynamic";

type ResumeStep = "ADDRESS_OR_PAYMENT" | "PAYMENT" | "PAYMENT_RETRY";

type CheckoutIntentForResume = {
  status: string;
  cartSnapshot: unknown;
  subtotalAmountPaise: number;
  discountAmountPaise: number;
  shippingAmountPaise: number;
  codFeeAmountPaise: number;
  totalAmountPaise: number;
  currency: string;
  selectedPaymentMethod: string | null;
  expiresAt: Date | null;
  addressSnapshots: Array<{
    city: string;
    province: string;
    country: string;
    zip: string;
  }>;
  payments: Array<{
    method: string;
    status: string;
    amountPaise: number;
    currency: string;
  }>;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cartLineCount(cartSnapshot: unknown) {
  const snapshot = asRecord(cartSnapshot);
  const lines = Array.isArray(cartSnapshot)
    ? cartSnapshot
    : Array.isArray(snapshot?.lineItems)
      ? snapshot.lineItems
      : Array.isArray(snapshot?.items)
        ? snapshot.items
        : Array.isArray(snapshot?.lines)
          ? snapshot.lines
          : [];

  return lines.reduce((total, line) => {
    const record = asRecord(line);
    return total + Math.max(0, Math.floor(Number(record?.quantity || 0)) || 0);
  }, 0);
}

function getResumeStep(recoveryType: string, status: string): ResumeStep | null {
  if (recoveryType === "CHECKOUT_ABANDONMENT") {
    if (["SESSION_VERIFIED", "ADDRESS_COMPLETED", "DELIVERY_VALIDATED"].includes(status)) return "ADDRESS_OR_PAYMENT";
    if (["PAYMENT_SELECTED", "DRAFT_ORDER_CREATED"].includes(status)) return "PAYMENT";
  }

  if (recoveryType === "PAYMENT_ABANDONMENT" && ["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_CANCELLED", "ABANDONED"].includes(status)) {
    return "PAYMENT_RETRY";
  }

  return null;
}

function invalidResponse() {
  console.info("[CHECKOUT RECOVERY] resume_context_invalid");
  return NextResponse.json({ recoverable: false, message: CHECKOUT_RECOVERY_EXPIRED_MESSAGE }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    await requireEnabledModule(shop.id, "express_checkout");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return invalidResponse();

    const recovery = await validateCheckoutRecoveryToken({ shopId: shop.id, token });
    const checkoutIntents = await prisma.$queryRaw<CheckoutIntentForResume[]>`
      SELECT
        "status"::text AS "status",
        "cartSnapshot",
        "subtotalAmountPaise",
        "discountAmountPaise",
        "shippingAmountPaise",
        "codFeeAmountPaise",
        "totalAmountPaise",
        "currency",
        "selectedPaymentMethod"::text AS "selectedPaymentMethod",
        "expiresAt",
        COALESCE((
          SELECT json_agg(json_build_object(
            'city', a."city",
            'province', a."province",
            'country', a."country",
            'zip', a."zip"
          ))
          FROM (
            SELECT "city", "province", "country", "zip"
            FROM "ExpressCheckoutAddressSnapshot"
            WHERE "shopId" = ${shop.id} AND "intentId" = ${recovery.checkoutIntentId}
            ORDER BY "createdAt" DESC
            LIMIT 1
          ) a
        ), '[]'::json) AS "addressSnapshots",
        COALESCE((
          SELECT json_agg(json_build_object(
            'method', p."method"::text,
            'status', p."status"::text,
            'amountPaise', p."amountPaise",
            'currency', p."currency"
          ))
          FROM (
            SELECT "method", "status", "amountPaise", "currency"
            FROM "ExpressCheckoutPayment"
            WHERE "shopId" = ${shop.id} AND "intentId" = ${recovery.checkoutIntentId}
            ORDER BY "createdAt" DESC
            LIMIT 1
          ) p
        ), '[]'::json) AS "payments"
      FROM "ExpressCheckoutIntent"
      WHERE "shopId" = ${shop.id} AND "id" = ${recovery.checkoutIntentId}
      LIMIT 1
    `;
    const checkoutIntent = checkoutIntents[0] || null;

    const now = new Date();
    if (!checkoutIntent || checkoutIntent.status === "ORDER_COMPLETED" || checkoutIntent.status === "EXPIRED" || (checkoutIntent.expiresAt && checkoutIntent.expiresAt <= now)) {
      return invalidResponse();
    }

    const resumeStep = getResumeStep(recovery.recoveryType, checkoutIntent.status);
    if (!resumeStep) return invalidResponse();

    const latestAddress = checkoutIntent.addressSnapshots[0] || null;
    const latestPayment = checkoutIntent.payments[0] || null;

    console.info("[CHECKOUT RECOVERY] resume_context_created", {
      shopId: shop.id,
      recoveryType: recovery.recoveryType,
      checkoutIntentStatus: checkoutIntent.status,
      resumeStep,
      expiresAt: recovery.expiresAt,
    });

    return NextResponse.json({
      recoverable: true,
      recoveryType: recovery.recoveryType,
      checkoutIntentStatus: checkoutIntent.status,
      resumeStep,
      expiresAt: recovery.expiresAt,
      cartSummary: {
        currency: checkoutIntent.currency,
        lineItemQuantity: cartLineCount(checkoutIntent.cartSnapshot),
        subtotalAmountPaise: checkoutIntent.subtotalAmountPaise,
        discountAmountPaise: checkoutIntent.discountAmountPaise,
        shippingAmountPaise: checkoutIntent.shippingAmountPaise,
        codFeeAmountPaise: checkoutIntent.codFeeAmountPaise,
        totalAmountPaise: checkoutIntent.totalAmountPaise,
      },
      deliverySummary: latestAddress
        ? {
            city: latestAddress.city,
            province: latestAddress.province,
            country: latestAddress.country,
            zip: latestAddress.zip,
          }
        : null,
      paymentSummary: {
        selectedPaymentMethod: checkoutIntent.selectedPaymentMethod,
        latestPaymentStatus: latestPayment?.status || null,
        latestPaymentMethod: latestPayment?.method || null,
        latestPaymentAmountPaise: latestPayment?.amountPaise || null,
        currency: latestPayment?.currency || checkoutIntent.currency,
      },
    });
  } catch {
    return invalidResponse();
  }
}
