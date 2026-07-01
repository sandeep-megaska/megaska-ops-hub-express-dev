import type { Prisma } from "../../../../../../../generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


function optionalString(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";

  return normalized || null;
}

function integerPaise(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    return { ok: false as const, error: `${field} must be a non-negative integer paise value` };
  }

  return { ok: true as const, value: Number(value) };
}


type DiscountCalculation = {
  code: string;
  title: string;
  discountAmountPaise: number;
  rawShopifyPayload: Prisma.InputJsonObject;
};

function calculateKnownDiscount(input: { code: string; subtotalAmountPaise: number; requestedDiscountAmountPaise?: number; rawShopifyPayload?: unknown }): DiscountCalculation | null {
  const code = input.code.trim().toUpperCase();
  const requested = Math.max(0, Math.floor(Number(input.requestedDiscountAmountPaise || 0)));

  if (code === "MEGA15") {
    const discountAmountPaise = Math.min(
      input.subtotalAmountPaise,
      Math.round(input.subtotalAmountPaise * 0.15)
    );

    return {
      code,
      title: "15% OFF",
      discountAmountPaise,
      rawShopifyPayload: {
        discountCode: code,
        discountType: "PERCENTAGE",
        discountValue: 15,
        discountAmountPaise,
        source: "megaska_known_coupon",
        upstream: (input.rawShopifyPayload ?? null) as Prisma.InputJsonValue | null,
      },
    };
  }

  if (requested > 0) {
    const discountAmountPaise = Math.min(input.subtotalAmountPaise, requested);

    return {
      code,
      title: "Discount",
      discountAmountPaise,
      rawShopifyPayload: {
        discountCode: code,
        discountType: "FIXED_AMOUNT",
        discountValue: discountAmountPaise,
        discountAmountPaise,
        source: "client_supplied_validated_amount",
        upstream: (input.rawShopifyPayload ?? null) as Prisma.InputJsonValue | null,
      },
    };
  }

  return null;
}

function recalculateTotal(intent: {
  subtotalAmountPaise: number;
  shippingAmountPaise: number;
}, discountAmountPaise: number) {
  return Math.max(
    0,
    intent.subtotalAmountPaise + intent.shippingAmountPaise - discountAmountPaise
  );
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

async function requireEditableIntent(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return { response: jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status }) };
  }

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);

  if ("error" in auth) {
    return { response: jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status }) };
  }

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) {
    return { response: jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 }) };
  }

  if (!customerProfileId) {
    return { response: jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 }) };
  }

  const intentWhere = {
    shopId: shop.shopId,
    id: intentId,
    customerProfileId,
  };
  const intent = await prisma.expressCheckoutIntent.findFirst({ where: intentWhere });

  if (!intent) {
    return { response: jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 }) };
  }

  if (BLOCKED_STATUSES.includes(intent.status)) {
    return {
      response: jsonWithCors(
        req,
        { ok: false, error: `Intent status ${intent.status} cannot be updated` },
        { status: 409 }
      ),
    };
  }

  if (intent.expiresAt && intent.expiresAt <= new Date()) {
    return { response: jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 }) };
  }

  return { shopId: shop.shopId, intentId, customerProfileId, intent };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const editable = await requireEditableIntent(req, context);

  if ("response" in editable) {
    return editable.response;
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const code = optionalString(body.code);

  if (!code) {
    return jsonWithCors(req, { ok: false, error: "code is required" }, { status: 400 });
  }

  const discountAmount = integerPaise(body.discountAmountPaise ?? 0, "discountAmountPaise");

  if (!discountAmount.ok) {
    return jsonWithCors(req, { ok: false, error: discountAmount.error }, { status: 400 });
  }

  const calculatedDiscount = calculateKnownDiscount({
    code,
    subtotalAmountPaise: editable.intent.subtotalAmountPaise,
    requestedDiscountAmountPaise: discountAmount.value,
    rawShopifyPayload: body.rawShopifyPayload,
  });

  if (!calculatedDiscount) {
    return jsonWithCors(req, { ok: false, error: "Discount code is not valid for this checkout" }, { status: 400 });
  }

  const totalAmountPaise = recalculateTotal(editable.intent, calculatedDiscount.discountAmountPaise);

  const result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutDiscount.deleteMany({
      where: {
        shopId: editable.shopId,
        intentId: editable.intentId,
        type: "MANUAL_CODE",
      },
    });

    await tx.expressCheckoutDiscount.create({
      data: {
        shopId: editable.shopId,
        intentId: editable.intentId,
        type: "MANUAL_CODE",
        code: calculatedDiscount.code,
        title: optionalString(body.title) || calculatedDiscount.title,
        discountAmountPaise: calculatedDiscount.discountAmountPaise,
        rawShopifyPayload: calculatedDiscount.rawShopifyPayload,
      },
    });

    await tx.expressCheckoutIntent.updateMany({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      data: {
        discountAmountPaise: calculatedDiscount.discountAmountPaise,
        totalAmountPaise,
        status: "DISCOUNT_APPLIED",
      },
    });

    const intent = await tx.expressCheckoutIntent.findFirstOrThrow({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      include: { discounts: { orderBy: { createdAt: "desc" } } },
    });

    return { intent, discounts: intent.discounts };
  });

  return jsonWithCors(req, { ok: true, ...result }, { status: 201 });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const editable = await requireEditableIntent(req, context);

  if ("response" in editable) {
    return editable.response;
  }

  const totalAmountPaise = recalculateTotal(editable.intent, 0);

  const result = await prisma.$transaction(async (tx) => {
    await tx.expressCheckoutDiscount.deleteMany({
      where: {
        shopId: editable.shopId,
        intentId: editable.intentId,
        type: "MANUAL_CODE",
      },
    });

    await tx.expressCheckoutIntent.updateMany({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      data: {
        discountAmountPaise: 0,
        totalAmountPaise,
        ...(editable.intent.status === "DISCOUNT_APPLIED" ? { status: "ADDRESS_CAPTURED" } : {}),
      },
    });

    const intent = await tx.expressCheckoutIntent.findFirstOrThrow({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      include: { discounts: { orderBy: { createdAt: "desc" } } },
    });

    return { intent, discounts: intent.discounts };
  });

  return jsonWithCors(req, { ok: true, ...result });
}
