import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import {
  getAuthenticatedExchangeCustomer,
  ShopResolutionError,
} from "../../../../../services/exchange/auth";
import { prisma } from "../../../../../services/db/prisma";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedExchangeCustomer(req);
    if (!auth) {
      return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    const { shop, session } = auth;
    const { id } = await context.params;

    const item = await prisma.orderActionRequest.findFirst({
      where: {
        id,
        shopId: shop.id,
        customerProfileId: session.customer.id,
        requestType: "EXCHANGE",
      },
      include: {
        items: true,
        payments: { orderBy: { createdAt: "desc" } },
        shipments: true,
      },
    });

    if (!item) {
      return withCors(req, NextResponse.json({ error: "Not found" }, { status: 404 }));
    }

    return withCors(req, NextResponse.json({ request: item }));
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed" },
        { status }
      )
    );
  }
}
