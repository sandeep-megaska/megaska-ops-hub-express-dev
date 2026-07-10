import { Prisma } from "../../../../../generated/prisma";
import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken, getSessionTokenFromRequest } from "../../../../../services/auth/session";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../lib/express-checkout/safety";
import { getExpressCheckoutSettings } from "../../../../../services/express-checkout/settings";
import {
  attachAddressSnapshotToIntent,
  customerProfileToExpressAddress,
  latestCustomerAddressSnapshot,
  saveCustomerProfileAddress,
} from "../../../../../services/express-checkout/address";

export const runtime = "nodejs";

const INTENT_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
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

type AuthCustomerAddressShape = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  countryRegion?: string | null;
};

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}


function stringOrNull(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}



function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}


function validLoopDeskOfferPricing(value: unknown) {
  const payload = asRecord(value);
  if (!payload) return null;

  const discount = Math.round(Number(payload.loopdeskOfferDiscountAmountPaise || 0));
  const adjustedTotal = Math.round(Number(payload.loopdeskOfferAdjustedTotalAmountPaise));
  const baseSubtotal = Math.round(Number(payload.loopdeskOfferBaseSubtotalAmountPaise));

  if (!(discount > 0) || !(adjustedTotal >= 0) || !(baseSubtotal > 0) || adjustedTotal > baseSubtotal) return null;

  return {
    loopdeskOfferDiscountAmountPaise: discount,
    loopdeskOfferAdjustedTotalAmountPaise: adjustedTotal,
    loopdeskOfferBaseSubtotalAmountPaise: baseSubtotal,
  };
}

function preserveLoopDeskOfferPricing(cartSnapshot: unknown, body: Record<string, unknown>) {
  const snapshot = asRecord(cartSnapshot);
  const snapshotHandoff = validLoopDeskOfferPricing(snapshot?.loopdeskOfferPricing);
  const bodyHandoff = validLoopDeskOfferPricing(body.loopdeskOfferPricing);

  if (!snapshot || snapshotHandoff || !bodyHandoff) return cartSnapshot;

  return {
    ...snapshot,
    loopdeskOfferPricing: bodyHandoff,
  };
}

function firstIntentAddress(intent: { addressSnapshots?: Array<Record<string, unknown>> } | null | undefined) {
  const address = Array.isArray(intent?.addressSnapshots) ? intent.addressSnapshots[0] : null;
  if (!address) return null;
  return {
    name: stringOrNull(address.name),
    phone: stringOrNull(address.phone),
    email: stringOrNull(address.email),
    address1: stringOrNull(address.address1),
    address2: stringOrNull(address.address2),
    city: stringOrNull(address.city),
    province: stringOrNull(address.province),
    country: stringOrNull(address.country) || "India",
    zip: stringOrNull(address.zip),
  };
}

function nullableJsonInput(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;

  return value as Prisma.InputJsonValue;
}

function hasCartLineItems(cartSnapshot: unknown) {
  const snapshot = cartSnapshot && typeof cartSnapshot === "object" && !Array.isArray(cartSnapshot)
    ? (cartSnapshot as Record<string, unknown>)
    : null;
  const candidates = Array.isArray(cartSnapshot)
    ? cartSnapshot
    : Array.isArray(snapshot?.lineItems)
      ? snapshot.lineItems
      : Array.isArray(snapshot?.items)
        ? snapshot.items
        : Array.isArray(snapshot?.lines)
          ? snapshot.lines
          : [];

  return candidates.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    const variantId = String(record.variantId || record.shopifyVariantId || record.merchandiseId || record.variant_id || "").trim();
    const quantity = Math.max(0, Math.floor(Number(record.quantity || 0)));
    return Boolean(variantId) && quantity > 0;
  });
}

function integerPaise(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    return { ok: false as const, error: `${field} must be a non-negative integer paise value` };
  }

  return { ok: true as const, value: Number(value) };
}

async function hydrateIntentAddress(input: { shopId: string; intentId: string; customerProfileId: string; customer: AuthCustomerAddressShape }) {
  const current = await prisma.expressCheckoutAddressSnapshot.findFirst({
    where: { shopId: input.shopId, intentId: input.intentId, customerProfileId: input.customerProfileId },
  });
  if (current) return;

  const customerAddress = customerProfileToExpressAddress(input.customer);
  if (customerAddress) {
    await attachAddressSnapshotToIntent(prisma, { ...input, address: customerAddress });
    return;
  }

  const previousAddress = await latestCustomerAddressSnapshot(prisma, input);
  if (!previousAddress) return;

  await prisma.$transaction(async (tx) => {
    await attachAddressSnapshotToIntent(tx, { ...input, address: previousAddress });
    await saveCustomerProfileAddress(tx, { ...input, address: previousAddress });
  });
}


export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const sessionToken = getSessionTokenFromRequest(req);
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

  const cartSnapshot = body.cartSnapshot === undefined ? undefined : preserveLoopDeskOfferPricing(body.cartSnapshot, body);
  // Express Checkout now receives product pricing from the Shopify Ajax cart read model.
  // Shipping, COD, and store credit remain separate adjustments; no local coupon resolver runs here.

  if (cartSnapshot !== undefined && !hasCartLineItems(cartSnapshot)) {
    return jsonWithCors(req, { ok: false, error: "Cart line items required", reason: "cartSnapshot must include lineItems/items/lines with variantId or variant_id and quantity" }, { status: 400 });
  }

  const prismaCartSnapshot = nullableJsonInput(cartSnapshot);
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
    const updatedIntent = cartSnapshot !== undefined
      ? await prisma.expressCheckoutIntent.update({
          where: { id: reusableIntent.id },
          data: {
            ...(prismaCartSnapshot !== undefined ? { cartSnapshot: prismaCartSnapshot } : {}),
            status: cartSnapshot !== undefined ? "CART_SNAPSHOT_LOCKED" : reusableIntent.status,
            ...paiseValues,
          },
        })
      : reusableIntent;

    await hydrateIntentAddress({
      shopId: shop.shopId,
      intentId: updatedIntent.id,
      customerProfileId,
      customer: auth.customer,
    });

    const intent = await prisma.expressCheckoutIntent.findFirst({
      where: { id: updatedIntent.id },
      include: {
        addressSnapshots: { orderBy: { createdAt: "desc" } },
        discounts: { orderBy: { createdAt: "desc" } },
      },
    });
    const settings = await getExpressCheckoutSettings(shop.shopId);
    return jsonWithCors(req, { ok: true, intent: intent || updatedIntent, customerDefaultAddress: firstIntentAddress(intent), settings, idempotent: true });
  }

  const intent = await prisma.expressCheckoutIntent.create({
    data: {
      shopId: shop.shopId,
      customerProfileId,
      sessionTokenHash: hashSessionToken(sessionToken),
      status: cartSnapshot ? "CART_SNAPSHOT_LOCKED" : "CUSTOMER_AUTHENTICATED",
      phoneSnapshot: stringOrNull(auth.customer.phoneE164),
      cartToken,
      shopifyCartId,
      cartSnapshot: prismaCartSnapshot,
      ...paiseValues,
      currency: "INR",
      expiresAt: new Date(now.getTime() + INTENT_EXPIRES_IN_MS),
    },
  });

  await hydrateIntentAddress({
    shopId: shop.shopId,
    intentId: intent.id,
    customerProfileId,
    customer: auth.customer,
  });

  const intentWithDiscounts = await prisma.expressCheckoutIntent.findFirst({
    where: { id: intent.id },
    include: {
      addressSnapshots: { orderBy: { createdAt: "desc" } },
      discounts: { orderBy: { createdAt: "desc" } },
    },
  });

  const settings = await getExpressCheckoutSettings(shop.shopId);
  return jsonWithCors(req, { ok: true, intent: intentWithDiscounts, customerDefaultAddress: firstIntentAddress(intentWithDiscounts), settings, idempotent: false }, { status: 201 });
}
