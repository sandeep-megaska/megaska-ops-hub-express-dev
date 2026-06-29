import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "../../../../../../services/auth/session";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../lib/express-checkout/safety";
import { getExpressCheckoutSettings } from "../../../../../../services/express-checkout/settings";
import {
  attachAddressSnapshotToIntent,
  customerProfileToExpressAddress,
  latestCustomerAddressSnapshot,
  saveCustomerProfileAddress,
} from "../../../../../../services/express-checkout/address";

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

  let intent = await prisma.expressCheckoutIntent.findFirst({
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

  const customerProfile = await prisma.customerProfile.findFirst({
    where: { id: customerProfileId, shopId: shop.shopId },
  });
  const profileAddress = customerProfile ? customerProfileToExpressAddress(customerProfile) : null;
  let defaultAddress = profileAddress;

  if (!intent.addressSnapshots.length) {
    const fallbackAddress = profileAddress || await latestCustomerAddressSnapshot(prisma, { shopId: shop.shopId, customerProfileId });
    if (fallbackAddress) {
      defaultAddress = fallbackAddress;
      await prisma.$transaction(async (tx) => {
        await attachAddressSnapshotToIntent(tx, { shopId: shop.shopId, intentId, customerProfileId, address: fallbackAddress });
        if (!profileAddress) {
          await saveCustomerProfileAddress(tx, { shopId: shop.shopId, customerProfileId, address: fallbackAddress });
        }
      });
      intent = await prisma.expressCheckoutIntent.findFirstOrThrow({
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
    }
  }

  const customerAddress = {
    name: defaultAddress?.name || customerProfile?.fullName || [customerProfile?.firstName, customerProfile?.lastName].filter(Boolean).join(" ") || null,
    phone: defaultAddress?.phone || customerProfile?.phoneE164 || null,
    email: defaultAddress?.email || customerProfile?.email || null,
    address1: defaultAddress?.address1 || customerProfile?.addressLine1 || null,
    address2: defaultAddress?.address2 || customerProfile?.addressLine2 || null,
    city: defaultAddress?.city || customerProfile?.city || null,
    province: defaultAddress?.province || customerProfile?.stateProvince || null,
    country: defaultAddress?.country || customerProfile?.countryRegion || "India",
    zip: defaultAddress?.zip || customerProfile?.postalCode || null,
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
