import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { prisma } from "../../../../services/db/prisma";
import { getAuthenticatedExchangeCustomer } from "../../../../services/exchange/auth";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";
import { auditCodAdvance, calculateEligibility, getLatestCodAdvanceSettings } from "../../../../services/cod-advance/core";

export const runtime = "nodejs";

const INTENT_EXPIRES_IN_MS = 15 * 60 * 1000;

type CodAdvanceIntent = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  cartReference: string | null;
  checkoutReference: string | null;
  orderAmountPaise: number;
  advanceAmountPaise: number;
  codBalanceAmountPaise: number;
  currency: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

type CodAdvanceIntentWhereInput = {
  cartReference?: string;
  checkoutReference?: string;
};

type CodAdvanceIntentDelegate = {
  findFirst(args: unknown): Promise<CodAdvanceIntent | null>;
  create(args: unknown): Promise<CodAdvanceIntent>;
};

const codAdvanceDb = prisma as unknown as typeof prisma & {
  codAdvanceIntent: CodAdvanceIntentDelegate;
};

function jsonWithCors(req: NextRequest, body: unknown, init?: ResponseInit) {
  return withCors(req, NextResponse.json(body, init));
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  const shopConfig = await resolveShopConfig(getShopDomainFromRequest(req));
  const shop = { id: shopConfig.id, shopDomain: shopConfig.shopDomain };

  if (!shop.id) {
    return jsonWithCors(req, { ok: false, error: "Unable to resolve shop" }, { status: 400 });
  }

  const amount = Number(
    req.nextUrl.searchParams.get("orderAmountPaise") ||
      Math.round(Number(req.nextUrl.searchParams.get("orderAmountRupees") || 0) * 100)
  );
  const settings = await getLatestCodAdvanceSettings(shop.id);

  if (!settings) {
    return jsonWithCors(req, {
      ok: true,
      enabled: false,
      eligibility: { eligible: false, reasons: ["settings_missing"] },
      advanceAmount: 0,
      codBalanceAmount: amount || 0,
      policyText: null,
    });
  }

  return jsonWithCors(req, { ok: true, ...calculateEligibility(settings, amount || 0) });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedExchangeCustomer(req);

  if (!auth?.shop.id || !auth.session.customer.id) {
    return jsonWithCors(req, { ok: false, error: "Invalid or expired session" }, { status: 401 });
  }

  const shop = auth.shop;
  const customerProfileId = auth.session.customer.id;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return jsonWithCors(req, { ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const orderAmountPaise = Number(
    body.orderAmountPaise ?? Math.round(Number(body.orderAmountRupees || 0) * 100)
  );

  if (!Number.isInteger(orderAmountPaise) || orderAmountPaise <= 0) {
    return jsonWithCors(req, { ok: false, error: "orderAmountPaise must be a positive integer" }, { status: 400 });
  }

  const cartReference = String(body.cartReference || "").trim() || null;
  const checkoutReference = String(body.checkoutReference || "").trim() || null;

  const settings = await getLatestCodAdvanceSettings(shop.id);

  if (!settings) {
    return jsonWithCors(req, { ok: false, error: "Fixed COD Advance settings are not configured" }, { status: 400 });
  }

  const quote = calculateEligibility(settings, orderAmountPaise);

  if (!quote.eligibility.eligible) {
    return jsonWithCors(
      req,
      { ok: false, error: "Order is not eligible for Fixed COD Advance", quote },
      { status: 400 }
    );
  }

  const now = new Date();
  const reuseConditions: CodAdvanceIntentWhereInput[] = [];

  if (cartReference) {
    reuseConditions.push({ cartReference });
  }

  if (checkoutReference) {
    reuseConditions.push({ checkoutReference });
  }

  const reusableIntent = reuseConditions.length > 0
    ? await codAdvanceDb.codAdvanceIntent.findFirst({
        where: {
          shopId: shop.id,
          customerProfileId,
          status: { in: ["CREATED", "PAYMENT_PENDING", "ADVANCE_PAID"] },
          expiresAt: { gt: now },
          OR: reuseConditions,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (reusableIntent) {
    return jsonWithCors(
      req,
      {
        ok: true,
        intent: reusableIntent,
        idempotent: true,
        noteAttributes: {
          megaska_cod_advance_intent_id: reusableIntent.id,
          megaska_cod_advance_paid: "true",
        },
      }
    );
  }

  const intent = await codAdvanceDb.codAdvanceIntent.create({
    data: {
      shopId: shop.id,
      customerProfileId,
      cartReference,
      checkoutReference,
      orderAmountPaise,
      advanceAmountPaise: quote.advanceAmount,
      codBalanceAmountPaise: quote.codBalanceAmount,
      currency: quote.currency,
      expiresAt: new Date(now.getTime() + INTENT_EXPIRES_IN_MS),
      metadata: body.metadata ?? undefined,
    },
  });

  await auditCodAdvance("cod_advance.intent.created", "CodAdvanceIntent", intent.id, {
    shopId: shop.id,
    orderAmountPaise,
  });

  return jsonWithCors(
    req,
    {
      ok: true,
      intent,
      noteAttributes: {
        megaska_cod_advance_intent_id: intent.id,
        megaska_cod_advance_paid: "true",
      },
    },
    { status: 201 }
  );
}
