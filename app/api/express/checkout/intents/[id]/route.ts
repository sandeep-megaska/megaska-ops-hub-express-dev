import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireCustomerSessionForShop,
  requireExpressCheckoutShop,
} from "../../../../../../lib/express-checkout/safety";

export const runtime = "nodejs";

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

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
      include: {
        addressSnapshots: { orderBy: { createdAt: "desc" } },
        discounts: { orderBy: { createdAt: "desc" } },
        payments: { orderBy: { createdAt: "desc" } },
        orderLink: true,
      },
    });

    if (!intent) return json(req, { ok: false, error: "Intent not found" }, 404);

    return json(req, { ok: true, intent }, 200);
  } catch (error) {
    console.error("express checkout intent fetch failed", error);
    return json(req, { ok: false, error: "Internal server error" }, 500);
  }
}
