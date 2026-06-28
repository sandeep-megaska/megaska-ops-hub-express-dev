import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken } from "../../../../../services/auth/session";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const ACTIVE_INTENT_STATUSES = [
  "CREATED",
  "CUSTOMER_AUTHENTICATED",
  "CART_SNAPSHOT_LOCKED",
  "ADDRESS_CAPTURED",
  "DISCOUNT_APPLIED",
  "PAYMENT_METHOD_SELECTED",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "ORDER_CREATING",
] as const;

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  return bearerToken || queryToken;
}

function json(req: NextRequest, body: unknown, status: number) {
  return withCors(req, NextResponse.json(body, { status }));
}

function isSafetyError(value: unknown): value is { status: 401 | 403; error: string } {
  return Boolean(value && typeof value === "object" && "status" in value && "error" in value);
}

function integerPaise(value: unknown, field: string, errors: string[], defaultValue?: number) {
  const resolved = value ?? defaultValue;
  if (!Number.isInteger(resolved) || Number(resolved) < 0) {
    errors.push(`${field} must be an integer paise value`);
    return defaultValue ?? 0;
  }
  return Number(resolved);
}

function defaultExpiresAt(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  }

  return new Date(Date.now() + 30 * 60 * 1000);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireExpressCheckoutShop(req);
    if (isSafetyError(shop)) return json(req, { ok: false, error: shop.error }, shop.status);

    const sessionToken = getSessionToken(req);
    const sessionContext = await requireCustomerSessionForShop(sessionToken, shop.shopId);
    if (isSafetyError(sessionContext)) {
      return json(req, { ok: false, error: sessionContext.error }, sessionContext.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const errors: string[] = [];
    const subtotalAmountPaise = integerPaise(body.subtotalAmountPaise, "subtotalAmountPaise", errors);
    const discountAmountPaise = integerPaise(body.discountAmountPaise, "discountAmountPaise", errors, 0);
    const shippingAmountPaise = integerPaise(body.shippingAmountPaise, "shippingAmountPaise", errors, 0);
    const codFeeAmountPaise = integerPaise(body.codFeeAmountPaise, "codFeeAmountPaise", errors, 0);
    const totalAmountPaise = integerPaise(body.totalAmountPaise, "totalAmountPaise", errors);

    if (body.currency && body.currency !== "INR") errors.push("currency must be INR");
    if (errors.length) return json(req, { ok: false, error: "Validation error", details: errors }, 400);

    const cartToken = typeof body.cartToken === "string" ? body.cartToken.trim() : "";
    const shopifyCartId = typeof body.shopifyCartId === "string" ? body.shopifyCartId.trim() : "";
    const hasCartSnapshot = body.cartSnapshot !== undefined && body.cartSnapshot !== null;
    const sessionTokenHash = sessionToken ? hashSessionToken(sessionToken) : null;
    const customerProfileId = sessionContext.customer.id;
    const now = new Date();

    const existingIntent = await prisma.expressCheckoutIntent.findFirst({
      where: {
        shopId: shop.shopId,
        customerProfileId,
        expiresAt: { gt: now },
        status: { in: [...ACTIVE_INTENT_STATUSES] },
        OR: [
          ...(cartToken ? [{ cartToken }] : []),
          ...(sessionTokenHash ? [{ sessionTokenHash }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    if (existingIntent) {
      return json(req, { ok: true, intent: existingIntent, reused: true }, 200);
    }

    const intent = await prisma.expressCheckoutIntent.create({
      data: {
        shopId: shop.shopId,
        customerProfileId,
        sessionTokenHash,
        status: hasCartSnapshot ? "CART_SNAPSHOT_LOCKED" : "CUSTOMER_AUTHENTICATED",
        phoneSnapshot: sessionContext.customer.phoneE164 || null,
        cartToken: cartToken || null,
        shopifyCartId: shopifyCartId || null,
        cartSnapshot: hasCartSnapshot ? body.cartSnapshot : undefined,
        subtotalAmountPaise,
        discountAmountPaise,
        shippingAmountPaise,
        codFeeAmountPaise,
        totalAmountPaise,
        currency: "INR",
        expiresAt: defaultExpiresAt(body.expiresAt),
      },
    });

    return json(req, { ok: true, intent, reused: false }, 201);
  } catch (error) {
    console.error("express checkout intent create failed", error);
    return json(req, { ok: false, error: "Internal server error" }, 500);
  }
}
