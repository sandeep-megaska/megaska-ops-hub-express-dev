import { NextRequest, NextResponse } from "next/server";
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

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";

  return bearerToken || queryToken;
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

function recalculateTotal(intent: {
  subtotalAmountPaise: number;
  shippingAmountPaise: number;
  codFeeAmountPaise: number;
}, discountAmountPaise: number) {
  return Math.max(
    0,
    intent.subtotalAmountPaise + intent.shippingAmountPaise + intent.codFeeAmountPaise - discountAmountPaise
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

  const auth = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);

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

  const totalAmountPaise = recalculateTotal(editable.intent, discountAmount.value);

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
        code,
        title: optionalString(body.title),
        discountAmountPaise: discountAmount.value,
        rawShopifyPayload: body.rawShopifyPayload ?? undefined,
      },
    });

    await tx.expressCheckoutIntent.updateMany({
      where: {
        shopId: editable.shopId,
        id: editable.intentId,
        customerProfileId: editable.customerProfileId,
      },
      data: {
        discountAmountPaise: discountAmount.value,
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
