import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { prisma } from "../../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { getAuthenticatedExchangeCustomer } from "../../../../../services/exchange/auth";

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
      return withCors(
        req,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
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
        payments: { orderBy: { createdAt: "desc" }, include: { invoice: true } },
        shipments: true,
      },
    });

    if (!item) {
      return withCors(
        req,
        NextResponse.json({ error: "Not found" }, { status: 404 })
      );
    }

    const latestPayment = item.payments[0] || null;
    const canPayReversePickup =
      item.status === "AWAITING_PAYMENT" &&
      latestPayment?.purpose === "REVERSE_PICKUP_FEE" &&
      latestPayment.status !== "PAID";

    return withCors(
      req,
      NextResponse.json({
        request: {
          ...item,
          canPayReversePickup,
          paymentActionEndpoint: canPayReversePickup
            ? `/api/account/exchange-requests/${item.id}/payment-link`
            : null,
          invoiceEndpoint: latestPayment?.invoice ? `/api/account/exchange-requests/${item.id}/invoice` : null,
          invoiceMessage: latestPayment?.status === "PAID" && !latestPayment?.invoice ? "Invoice will be available after payment confirmation." : null,
        },
      })
    );
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
