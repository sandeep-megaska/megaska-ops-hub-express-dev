import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../../_lib/cors";
import { prisma } from "../../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

const BLOCKED_STATUSES = ["EXPIRED", "CANCELLED", "FAILED", "ORDER_CREATED"];

type ExpressCheckoutIntent = {
  id: string;
  status: string;
  expiresAt: Date | null;
  customerProfileId: string | null;
};
type ExpressCheckoutAddressSnapshot = { id: string };
type ExpressCheckoutIntentDelegate = {
  findFirst(args: unknown): Promise<ExpressCheckoutIntent | null>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type ExpressCheckoutAddressSnapshotDelegate = {
  create(args: unknown): Promise<ExpressCheckoutAddressSnapshot>;
};

const expressCheckoutDb = prisma as unknown as typeof prisma & {
  expressCheckoutIntent: ExpressCheckoutIntentDelegate;
  expressCheckoutAddressSnapshot: ExpressCheckoutAddressSnapshotDelegate;
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

function requiredString(body: Record<string, unknown>, field: string) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";

  return value || null;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const auth = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);

  if ("error" in auth) {
    return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  }

  const intentId = String((await context.params).id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) {
    return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  }

  if (!customerProfileId) {
    return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const requiredFields = ["name", "phone", "address1", "city", "province", "zip"];
  const address: Record<string, string> = {};

  for (const field of requiredFields) {
    const value = requiredString(body, field);

    if (!value) {
      return jsonWithCors(req, { ok: false, error: `${field} is required` }, { status: 400 });
    }

    address[field] = value;
  }

  const intent = await expressCheckoutDb.expressCheckoutIntent.findFirst({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
    },
  });

  if (!intent) {
    return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  }

  if (BLOCKED_STATUSES.includes(intent.status)) {
    return jsonWithCors(req, { ok: false, error: `Intent status ${intent.status} cannot be updated` }, { status: 409 });
  }

  if (intent.expiresAt && intent.expiresAt <= new Date()) {
    return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });
  }

  const addressSnapshot = await expressCheckoutDb.expressCheckoutAddressSnapshot.create({
    data: {
      shopId: shop.shopId,
      intentId,
      customerProfileId,
      name: address.name,
      phone: address.phone,
      email: requiredString(body, "email"),
      address1: address.address1,
      address2: requiredString(body, "address2"),
      city: address.city,
      province: address.province,
      country: requiredString(body, "country") || "India",
      zip: address.zip,
    },
  });

  await expressCheckoutDb.expressCheckoutIntent.updateMany({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
    },
    data: { status: "ADDRESS_CAPTURED" },
  });

  const updatedIntent = await expressCheckoutDb.expressCheckoutIntent.findFirst({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
    },
  });

  return jsonWithCors(req, { ok: true, intent: updatedIntent, addressSnapshot }, { status: 201 });
}
