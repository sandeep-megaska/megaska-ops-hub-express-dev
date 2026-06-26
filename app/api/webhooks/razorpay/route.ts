import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { verifyRazorpayWebhookSignature } from "../../../../services/exchange/razorpay";
import { canTransitionExchangeStatus } from "../../../../services/exchange/lifecycle";
import { sendExchangePaymentReceivedOpsEmail } from "../../../../services/notifications/exchange";

function mapPaymentStatus(event: string) {
  if (event === "payment_link.paid") return "PAID";
  if (event === "payment_link.expired") return "EXPIRED";
  if (event === "payment.failed") return "FAILED";
  if (event === "payment_link.cancelled") return "CANCELLED";
  return "PENDING";
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = (JSON.parse(rawBody || "{}") || {}) as Record<string, unknown>;
  const event = String(payload.event || "");
  const payloadObj = payload["payload"] as Record<string, unknown> | undefined;
  const paymentLinkPayload = payloadObj?.["payment_link"] as
    | { entity?: Record<string, unknown> }
    | undefined;
  const paymentPayload = payloadObj?.["payment"] as
    | { entity?: Record<string, unknown> }
    | undefined;
  const paymentLinkEntity = paymentLinkPayload?.entity || {};
  const paymentLinkId = String(paymentLinkEntity["id"] || "").trim();
  const paymentId = String(paymentPayload?.entity?.["id"] || "").trim() || null;

  if (!paymentLinkId) {
    console.info("[RAZORPAY WEBHOOK] Ignoring event without payment link id", { event });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const status = mapPaymentStatus(event);

  const payment = await prisma.requestPayment.findFirst({
    where: {
      paymentLinkId,
      request: { requestType: "EXCHANGE" },
    },
    include: { request: { include: { items: { take: 1 } } } },
  });

  if (!payment) {
    const codAdvanceIntent = await (prisma as any).codAdvanceIntent.findFirst({
      where: { razorpayPaymentLinkId: paymentLinkId },
    });

    if (!codAdvanceIntent) {
      console.info("[RAZORPAY WEBHOOK] No matching RequestPayment or CodAdvanceIntent", { event, paymentLinkId });
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (codAdvanceIntent.status === "ADVANCE_PAID" && status !== "PAID") {
      return NextResponse.json({ ok: true, ignored: true, reason: "cod_advance_already_paid" });
    }

    const codStatus =
      status === "PAID"
        ? "ADVANCE_PAID"
        : status === "EXPIRED"
          ? "EXPIRED"
          : status === "FAILED"
            ? "FAILED"
            : status === "CANCELLED"
              ? "CANCELLED"
              : codAdvanceIntent.status;

    if (codStatus !== codAdvanceIntent.status || (status === "PAID" && codAdvanceIntent.razorpayPaymentId !== paymentId)) {
      await (prisma as any).codAdvanceIntent.update({
        where: { id: codAdvanceIntent.id },
        data: {
          status: codStatus,
          razorpayPaymentId: status === "PAID" ? paymentId : codAdvanceIntent.razorpayPaymentId,
          paidAt: status === "PAID" ? codAdvanceIntent.paidAt ?? new Date() : codAdvanceIntent.paidAt,
        },
      });

      if (status === "PAID") {
        await prisma.auditEvent.create({
          data: {
            actorType: "system",
            eventType: "cod_advance.payment.paid",
            entityType: "CodAdvanceIntent",
            entityId: codAdvanceIntent.id,
            payload: { paymentLinkId, paymentId },
          },
        });
      }
    }

    return NextResponse.json({ ok: true, module: "cod_advance" });
  }

  if (payment.status === "PAID" && status !== "PAID") {
    return NextResponse.json({ ok: true, ignored: true, reason: "already_paid" });
  }

  const isDuplicatePaidWebhook =
    status === "PAID" &&
    payment.status === "PAID" &&
    Boolean(payment.paidAt) &&
    (!paymentId || payment.paymentId === paymentId);

  const shouldUpdatePaymentStatus =
    !isDuplicatePaidWebhook &&
    (payment.status !== status || (status === "PAID" && payment.paymentId !== paymentId));

  const updatedPayment = shouldUpdatePaymentStatus
    ? await prisma.requestPayment.update({
        where: { id: payment.id },
        data: {
          status: status as never,
          paymentId,
          paidAt: status === "PAID" ? payment.paidAt ?? new Date() : payment.paidAt,
        },
      })
    : payment;

  if (status === "PAID") {
    if (isDuplicatePaidWebhook) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const canSetPaymentReceived = canTransitionExchangeStatus(
      payment.request.status,
      "PAYMENT_RECEIVED"
    );

    if (canSetPaymentReceived && payment.request.status !== "PAYMENT_RECEIVED") {
      await prisma.orderActionRequest.update({
        where: { id: payment.requestId },
        data: {
          status: "PAYMENT_RECEIVED",
        },
      });
    }

    await prisma.shipmentTracking.upsert({
      where: {
        requestId_direction: {
          requestId: payment.requestId,
          direction: "REVERSE_PICKUP",
        },
      },
      create: {
        requestId: payment.requestId,
        direction: "REVERSE_PICKUP",
        status: "PENDING",
      },
      update: {
        status: "PENDING",
      },
    });

    void sendExchangePaymentReceivedOpsEmail({
      requestId: payment.request.id,
      orderNumber: payment.request.orderNumber,
      status: "PAYMENT_RECEIVED",
      customerName: payment.request.customerNameSnapshot,
      customerPhone: payment.request.customerPhoneSnapshot,
      customerEmail: payment.request.customerEmailSnapshot,
      currentSize: payment.request.items[0]?.currentSize,
      requestedSize: payment.request.items[0]?.requestedSize,
      paymentAmountPaise: updatedPayment.amount,
      paymentCurrency: updatedPayment.currency,
    });
  } else if (event !== "payment_link.expired" && event !== "payment_link.cancelled" && event !== "payment.failed") {
    console.info("[RAZORPAY WEBHOOK] Unhandled event", { event, paymentLinkId });
  }

  return NextResponse.json({ ok: true });
}
