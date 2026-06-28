import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken } from "../../../../../services/auth/session";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const INTENT_EXPIRES_IN_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = [
  "CREATED",
  "CUSTOMER_AUTHENTICATED",
  "CART_SNAPSHOT_LOCKED",
  "ADDRESS_CAPTURED",
  "DISCOUNT_APPLIED",
  "PAYMENT_METHOD_SELECTED",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
] as const;

type ExpressCheckoutIntentWhereInput = {
  cartToken?: string;
  shopifyCartId?: string;
};

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() || "";

  return bearerToken || queryToken;
}

function stringOrNull(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
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

export async function POST(req: NextRequest) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const sessionToken = getSessionToken(req);
  const auth = await requireCustomerSessionForShop(sessionToken, shop.shopId);

  if ("error" in auth) {
    return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  }

  const customerProfileId = String(auth.customer.id || "").trim();

  if (!customerProfileId) {
    return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (String(body.currency || "INR").trim().toUpperCase() !== "INR") {
    return jsonWithCors(req, { ok: false, error: "currency must be INR" }, { status: 400 });
  }

  const paiseFields = [
    "subtotalAmountPaise",
    "discountAmountPaise",
    "shippingAmountPaise",
    "codFeeAmountPaise",
    "totalAmountPaise",
  ];
  const paiseValues: Record<string, number> = {};

  for (const field of paiseFields) {
    const result = integerPaise(body[field] ?? 0, field);

    if (!result.ok) {
      return jsonWithCors(req, { ok: false, error: result.error }, { status: 400 });
    }

    paiseValues[field] = result.value;
  }

  const cartToken = stringOrNull(body.cartToken);
  const shopifyCartId = stringOrNull(body.shopifyCartId);
  const reuseConditions: ExpressCheckoutIntentWhereInput[] = [];

  if (cartToken) {
    reuseConditions.push({ cartToken });
  }

  if (shopifyCartId) {
    reuseConditions.push({ shopifyCartId });
  }

  const now = new Date();
  const reusableIntent = reuseConditions.length > 0
    ? await prisma.expressCheckoutIntent.findFirst({
        where: {
          shopId: shop.shopId,
          customerProfileId,
          status: { in: [...ACTIVE_STATUSES] },
          expiresAt: { gt: now },
          OR: reuseConditions,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (reusableIntent) {
    return jsonWithCors(req, { ok: true, intent: reusableIntent, idempotent: true });
  }

  const cartSnapshot = body.cartSnapshot ?? undefined;
  const intent = await prisma.expressCheckoutIntent.create({
    data: {
      shopId: shop.shopId,
      customerProfileId,
      sessionTokenHash: hashSessionToken(sessionToken),
      status: cartSnapshot ? "CART_SNAPSHOT_LOCKED" : "CUSTOMER_AUTHENTICATED",
      phoneSnapshot: stringOrNull(auth.customer.phoneE164),
      cartToken,
      shopifyCartId,
      cartSnapshot,
      ...paiseValues,
      currency: "INR",
      expiresAt: new Date(now.getTime() + INTENT_EXPIRES_IN_MS),
    },
  });

  return jsonWithCors(req, { ok: true, intent, idempotent: false }, { status: 201 });
}
