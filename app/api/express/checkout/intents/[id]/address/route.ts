import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const ADDRESS_BLOCKED_STATUSES = ["CANCELLED", "FAILED", "ORDER_CREATED", "EXPIRED"] as const;

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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(body: Record<string, unknown>, field: string, errors: string[]) {
  const value = optionalString(body[field]);
  if (!value) errors.push(`${field} is required`);
  return value || "";
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const shop = await requireExpressCheckoutShop(req);
    if (isSafetyError(shop)) return json(req, { ok: false, error: shop.error }, shop.status);

    const sessionContext = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);
    if (isSafetyError(sessionContext)) {
      return json(req, { ok: false, error: sessionContext.error }, sessionContext.status);
    }

    const intentId = String(params.id || "").trim();
    if (!intentId) return json(req, { ok: false, error: "Intent not found" }, 404);

    const intent = await prisma.expressCheckoutIntent.findFirst({
      where: {
        id: intentId,
        shopId: shop.shopId,
        customerProfileId: sessionContext.customer.id,
      },
    });

    if (!intent) return json(req, { ok: false, error: "Intent not found" }, 404);
    if (intent.expiresAt && intent.expiresAt.getTime() <= Date.now()) {
      return json(req, { ok: false, error: "Validation error", details: ["Intent is expired"] }, 400);
    }
    if (ADDRESS_BLOCKED_STATUSES.includes(intent.status as (typeof ADDRESS_BLOCKED_STATUSES)[number])) {
      return json(req, { ok: false, error: "Validation error", details: ["Intent cannot accept address updates"] }, 400);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const errors: string[] = [];
    const name = requiredString(body, "name", errors);
    const phone = requiredString(body, "phone", errors);
    const address1 = requiredString(body, "address1", errors);
    const city = requiredString(body, "city", errors);
    const province = requiredString(body, "province", errors);
    const zip = requiredString(body, "zip", errors);

    if (errors.length) return json(req, { ok: false, error: "Validation error", details: errors }, 400);

    const result = await prisma.$transaction(async (tx) => {
      const addressSnapshot = await tx.expressCheckoutAddressSnapshot.create({
        data: {
          shopId: shop.shopId,
          intentId: intent.id,
          customerProfileId: sessionContext.customer.id,
          name,
          phone,
          email: optionalString(body.email),
          address1,
          address2: optionalString(body.address2),
          city,
          province,
          country: optionalString(body.country) || "India",
          zip,
        },
      });

      await tx.expressCheckoutIntent.updateMany({
        where: {
          id: intent.id,
          shopId: shop.shopId,
          customerProfileId: sessionContext.customer.id,
        },
        data: { status: "ADDRESS_CAPTURED" },
      });

      const updatedIntent = await tx.expressCheckoutIntent.findFirst({
        where: {
          id: intent.id,
          shopId: shop.shopId,
          customerProfileId: sessionContext.customer.id,
        },
      });

      return { addressSnapshot, intent: updatedIntent };
    });

    return json(req, { ok: true, ...result }, 200);
  } catch (error) {
    console.error("express checkout address capture failed", error);
    return json(req, { ok: false, error: "Internal server error" }, 500);
  }
}
