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


function stringFromAny(body: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (value) return value;
  }

  return null;
}

function requiredString(body: Record<string, unknown>, fields: string[], label: string) {
  const value = stringFromAny(body, fields);

  if (!value) return { ok: false as const, error: `${label} is required` };

  return { ok: true as const, value };
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const auth = await requireCustomerSessionForShop(getSessionTokenFromRequest(req), shop.shopId);

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

  const requiredAddress = {
    name: requiredString(body, ["name", "fullName"], "fullName"),
    phone: requiredString(body, ["phone"], "phone"),
    address1: requiredString(body, ["address1", "addressLine1"], "addressLine1"),
    city: requiredString(body, ["city"], "city"),
    province: requiredString(body, ["province", "state", "stateProvince"], "state"),
    zip: requiredString(body, ["zip", "postalCode"], "postalCode"),
    country: requiredString(body, ["country", "countryRegion"], "country"),
  };

  if (!requiredAddress.name.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.name.error }, { status: 400 });
  }
  if (!requiredAddress.phone.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.phone.error }, { status: 400 });
  }
  if (!requiredAddress.address1.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.address1.error }, { status: 400 });
  }
  if (!requiredAddress.city.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.city.error }, { status: 400 });
  }
  if (!requiredAddress.province.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.province.error }, { status: 400 });
  }
  if (!requiredAddress.zip.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.zip.error }, { status: 400 });
  }
  if (!requiredAddress.country.ok) {
    return jsonWithCors(req, { ok: false, error: requiredAddress.country.error }, { status: 400 });
  }

  const address = {
    name: requiredAddress.name.value,
    phone: requiredAddress.phone.value,
    address1: requiredAddress.address1.value,
    city: requiredAddress.city.value,
    province: requiredAddress.province.value,
    zip: requiredAddress.zip.value,
    country: requiredAddress.country.value,
  };

  const intent = await prisma.expressCheckoutIntent.findFirst({
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
    return jsonWithCors(
      req,
      { ok: false, error: `Intent status ${intent.status} cannot be updated` },
      { status: 409 }
    );
  }

  if (intent.expiresAt && intent.expiresAt <= new Date()) {
    return jsonWithCors(req, { ok: false, error: "Intent expired" }, { status: 409 });
  }

  const addressSnapshot = await prisma.expressCheckoutAddressSnapshot.create({
    data: {
      shopId: shop.shopId,
      intentId,
      customerProfileId,
      name: address.name,
      phone: address.phone,
      email: stringFromAny(body, ["email"]),
      address1: address.address1,
      address2: stringFromAny(body, ["address2", "addressLine2", "landmark"]),
      city: address.city,
      province: address.province,
      country: address.country,
      zip: address.zip,
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.customerProfile.updateMany({
      where: { id: customerProfileId, shopId: shop.shopId },
      data: {
        fullName: address.name,
        phoneE164: address.phone,
        email: stringFromAny(body, ["email"]),
        addressLine1: address.address1,
        addressLine2: stringFromAny(body, ["address2", "addressLine2", "landmark"]),
        city: address.city,
        stateProvince: address.province,
        postalCode: address.zip,
        countryRegion: address.country,
        profileCompletedAt: new Date(),
      },
    });

    await tx.expressCheckoutIntent.updateMany({
      where: {
        shopId: shop.shopId,
        id: intentId,
        customerProfileId,
      },
      data: { status: "ADDRESS_CAPTURED" },
    });
  });

  const updatedIntent = await prisma.expressCheckoutIntent.findFirst({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
    },
  });

  return jsonWithCors(req, { ok: true, intent: updatedIntent, addressSnapshot }, { status: 201 });
}
