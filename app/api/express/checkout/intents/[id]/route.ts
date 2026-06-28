import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../lib/express-checkout/safety";
import { getExpressCheckoutSettings } from "../../../../../../services/express-checkout/settings";

export const runtime = "nodejs";

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const intent = await prisma.expressCheckoutIntent.findFirst({
    where: {
      shopId: shop.shopId,
      id: intentId,
      customerProfileId,
    },
    include: {
      addressSnapshots: { orderBy: { createdAt: "desc" } },
      discounts: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      orderLink: true,
    },
  });

  if (!intent) {
    return jsonWithCors(req, { ok: false, error: "Intent not found" }, { status: 404 });
  }

  const customerAddress = {
    name: auth.customer.fullName || [auth.customer.firstName, auth.customer.lastName].filter(Boolean).join(" ") || null,
    phone: auth.customer.phoneE164 || null,
    email: auth.customer.email || null,
    address1: auth.customer.addressLine1 || null,
    address2: auth.customer.addressLine2 || null,
    city: auth.customer.city || null,
    province: auth.customer.stateProvince || null,
    country: auth.customer.countryRegion || "India",
    zip: auth.customer.postalCode || null,
  };
  const hasCustomerAddress = Boolean(
    customerAddress.name &&
    customerAddress.phone &&
    customerAddress.address1 &&
    customerAddress.city &&
    customerAddress.province &&
    customerAddress.zip &&
    customerAddress.country
  );

  const settings = await getExpressCheckoutSettings(shop.shopId);

  return jsonWithCors(req, { ok: true, intent, customerDefaultAddress: hasCustomerAddress ? customerAddress : null, settings });
}
