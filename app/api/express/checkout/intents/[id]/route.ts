import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

type ExpressCheckoutIntent = { id: string; customerProfileId: string | null };
type ExpressCheckoutIntentDelegate = {
  findFirst(args: unknown): Promise<ExpressCheckoutIntent | null>;
};

const expressCheckoutDb = prisma as unknown as typeof prisma & {
  expressCheckoutIntent: ExpressCheckoutIntentDelegate;
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

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const shop = await requireExpressCheckoutShop(req);

  if ("error" in shop) {
    return jsonWithCors(req, { ok: false, error: shop.error }, { status: shop.status });
  }

  const auth = await requireCustomerSessionForShop(getSessionToken(req), shop.shopId);

  if ("error" in auth) {
    return jsonWithCors(req, { ok: false, error: auth.error }, { status: auth.status });
  }

  const intentId = String(params.id || "").trim();
  const customerProfileId = String(auth.customer.id || "").trim();

  if (!intentId) {
    return jsonWithCors(req, { ok: false, error: "Intent id required" }, { status: 400 });
  }

  if (!customerProfileId) {
    return jsonWithCors(req, { ok: false, error: "Customer profile required" }, { status: 401 });
  }

  const intent = await expressCheckoutDb.expressCheckoutIntent.findFirst({
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

  return jsonWithCors(req, { ok: true, intent });
}
