import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import {
  getAuthenticatedExchangeCustomer,
  ShopResolutionError,
} from "../../../../../../services/exchange/auth";
import { createReversePickupPaymentLink } from "../../../../../../services/exchange/razorpay";
import {
  REVERSE_PICKUP_CURRENCY,
  REVERSE_PICKUP_FEE_PAISE,
} from "../../../../../../services/exchange/constants";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(
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

    const requestRow = await prisma.orderActionRequest.findFirst({
      where: {
        id,
        shopId: shop.id,
        customerProfileId: session.customer.id,
        requestType: "EXCHANGE",
      },
      include: {
        payments: {
          where: {
            purpose: "REVERSE_PICKUP_FEE",
            status: { in: ["PENDING", "NOT_CREATED"] },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!requestRow) {
      return withCors(req, NextResponse.json({ error: "Request not found" }, { status: 404 }));
    }

    const paymentLink = await createReversePickupPaymentLink({
      requestId: requestRow.id,
      customerName: requestRow.customerNameSnapshot,
      customerPhone: requestRow.customerPhoneSnapshot,
      customerEmail: requestRow.customerEmailSnapshot,
    });

    const payment = requestRow.payments[0]
      ? await prisma.requestPayment.update({
          where: { id: requestRow.payments[0].id },
          data: {
            amount: REVERSE_PICKUP_FEE_PAISE,
            currency: REVERSE_PICKUP_CURRENCY,
            status: "PENDING",
            paymentLinkId: paymentLink.id,
            paymentLinkUrl: paymentLink.shortUrl,
            providerReferenceId: paymentLink.referenceId,
            expiresAt: paymentLink.expiresAt,
          },
        })
      : await prisma.requestPayment.create({
          data: {
            requestId: requestRow.id,
            purpose: "REVERSE_PICKUP_FEE",
            provider: "RAZORPAY",
            amount: REVERSE_PICKUP_FEE_PAISE,
            currency: REVERSE_PICKUP_CURRENCY,
            status: "PENDING",
            paymentLinkId: paymentLink.id,
            paymentLinkUrl: paymentLink.shortUrl,
            providerReferenceId: paymentLink.referenceId,
            expiresAt: paymentLink.expiresAt,
          },
        });

    if (requestRow.status === "OPEN") {
      await prisma.orderActionRequest.update({
        where: { id: requestRow.id },
        data: { status: "AWAITING_PAYMENT" },
      });
    }

    return withCors(req, NextResponse.json({ payment }));
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
