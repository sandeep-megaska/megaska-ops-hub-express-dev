import { Prisma } from "../../../../../../../generated/prisma";
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

function nullableJsonInput(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;

  return value as Prisma.InputJsonValue;
}

function integerPaise(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    return { ok: false as const, error: `${field} must be a non-negative integer paise value` };
  }

  return { ok: true as const, value: Number(value) };
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

  return { shopId: shop.shopId, shopDomain: shop.shopDomain, intentId, customerProfileId, intent };
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

  const subtotalAmount = integerPaise(body.subtotalAmountPaise, "subtotalAmountPaise");
  const discountAmount = integerPaise(body.discountAmountPaise, "discountAmountPaise");
  const totalAmount = integerPaise(body.totalAmountPaise, "totalAmountPaise");

  if (!subtotalAmount.ok) {
    return jsonWithCors(req, { ok: false, error: subtotalAmount.error }, { status: 400 });
  }

  if (!discountAmount.ok) {
    return jsonWithCors(req, { ok: false, error: discountAmount.error }, { status: 400 });
  }

  if (!totalAmount.ok) {
    return jsonWithCors(req, { ok: false, error: totalAmount.error }, { status: 400 });
  }

  if (discountAmount.value <= 0) {
    return jsonWithCors(req, { ok: false, error: "Discount code is not valid for this checkout" }, { status: 400 });
  }

  const cartSnapshot = body.cartSnapshot === undefined ? editable.intent.cartSnapshot : body.cartSnapshot;
  const rawShopifyPayload = nullableJsonInput(body.rawShopifyPayload ?? null);

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
        code: code.toUpperCase(),
        title: optionalString(body.title) || code.toUpperCase(),
        discountAmountPaise: discountAmount.value,
        rawShopifyPayload,
      },
    });

    await tx.expressCheckoutIntent.updateMany({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      data: {
        subtotalAmountPaise: subtotalAmount.value,
        discountAmountPaise: discountAmount.value,
        totalAmountPaise: totalAmount.value,
        cartSnapshot: cartSnapshot as never,
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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const subtotalAmount = body && integerPaise(body.subtotalAmountPaise, "subtotalAmountPaise");
  const discountAmount = body && integerPaise(body.discountAmountPaise ?? 0, "discountAmountPaise");
  const totalAmount = body && integerPaise(body.totalAmountPaise, "totalAmountPaise");
  const cartSnapshot = body && body.cartSnapshot !== undefined ? body.cartSnapshot : editable.intent.cartSnapshot;

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
        subtotalAmountPaise: subtotalAmount && subtotalAmount.ok ? subtotalAmount.value : editable.intent.subtotalAmountPaise,
        discountAmountPaise: discountAmount && discountAmount.ok ? discountAmount.value : 0,
        totalAmountPaise: totalAmount && totalAmount.ok ? totalAmount.value : Math.max(0, editable.intent.subtotalAmountPaise + editable.intent.shippingAmountPaise + editable.intent.codFeeAmountPaise),
        cartSnapshot: cartSnapshot as never,
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
