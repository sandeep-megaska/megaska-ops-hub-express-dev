import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { getAuthenticatedExchangeCustomer } from "../../../../../../services/exchange/auth";
import { createReversePickupPaymentLink } from "../../../../../../services/exchange/razorpay";
import {
  REVERSE_PICKUP_CURRENCY,
  REVERSE_PICKUP_FEE_PAISE,
} from "../../../../../../services/exchange/constants";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function hasActivePaymentLink(payment: {
  status: string;
  paymentLinkUrl: string | null;
  expiresAt: Date | null;
}) {
  if (payment.status !== "PENDING") return false;
  if (!payment.paymentLinkUrl) return false;
  if (!payment.expiresAt) return true;
  return payment.expiresAt.getTime() > Date.now();
}

export async function POST(
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

    const requestRow = await prisma.orderActionRequest.findFirst({
      where: {
        id,
        shopId: shop.id,
        customerProfileId: session.customer.id,
        requestType: "EXCHANGE",
      },
      include: {
        items: { take: 1 },
        payments: {
          where: {
            purpose: "REVERSE_PICKUP_FEE",
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!requestRow) {
      return withCors(
        req,
        NextResponse.json({ error: "Request not found" }, { status: 404 })
      );
    }

    if (requestRow.status !== "AWAITING_PAYMENT") {
      return withCors(
        req,
        NextResponse.json(
          { error: "Payment link is available only after ops approval/payment-required state." },
          { status: 400 }
        )
      );
    }

    const existingPayment = requestRow.payments[0];
    if (existingPayment?.status === "PAID") {
      return withCors(
        req,
        NextResponse.json({ error: "Payment is already completed." }, { status: 400 })
      );
    }

    if (existingPayment && hasActivePaymentLink(existingPayment)) {
      return withCors(req, NextResponse.json({ payment: existingPayment, reused: true }));
    }

    const amount = existingPayment?.amount || REVERSE_PICKUP_FEE_PAISE;
    const paymentLink = await createReversePickupPaymentLink({
      requestId: requestRow.id,
      customerName: requestRow.customerNameSnapshot,
      customerPhone: requestRow.customerPhoneSnapshot,
      customerEmail: requestRow.customerEmailSnapshot,
      amount,
      currency: existingPayment?.currency || REVERSE_PICKUP_CURRENCY,
    });

    const payment = existingPayment
      ? await prisma.requestPayment.update({
          where: { id: existingPayment.id },
          data: {
            amount,
            currency: existingPayment.currency || REVERSE_PICKUP_CURRENCY,
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
            amount,
            currency: REVERSE_PICKUP_CURRENCY,
            status: "PENDING",
            paymentLinkId: paymentLink.id,
            paymentLinkUrl: paymentLink.shortUrl,
            providerReferenceId: paymentLink.referenceId,
            expiresAt: paymentLink.expiresAt,
          },
        });

    return withCors(req, NextResponse.json({ payment, reused: false }));
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
