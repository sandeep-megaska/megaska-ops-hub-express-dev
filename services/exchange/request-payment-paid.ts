// What happens once an exchange charge paid on a Shopify invoice is confirmed (the
// orders/paid webhook). It mirrors the Razorpay webhook's paid branch
// (app/api/webhooks/razorpay/route.ts), which stays as it is for the original app:
//   - price difference: the style exchange is settled;
//   - reverse pickup charge: the exchange moves to PAYMENT_RECEIVED and the
//     Delhivery reverse pickup is booked automatically.
import { prisma } from "../db/prisma.ts";
import { canTransitionExchangeStatus } from "./lifecycle.ts";

export type PaidOutcome =
  | { handled: false; reason: "not_found" | "already_paid" }
  | { handled: true; purpose: "STYLE_DIFFERENCE" | "REVERSE_PICKUP_FEE"; requestId: string; followUp: () => Promise<void> };

export async function markShopifyChargePaid(input: { shopId: string; referenceId: string; shopifyOrderId: string; paidAt?: Date }): Promise<PaidOutcome> {
  const payment = await prisma.requestPayment.findFirst({
    where: { provider: "SHOPIFY", providerReferenceId: input.referenceId, request: { shopId: input.shopId } },
    include: { request: { select: { id: true, status: true } } },
  });
  if (!payment) return { handled: false, reason: "not_found" };
  if (payment.status === "PAID") return { handled: false, reason: "already_paid" };

  // Only the first webhook to flip PENDING -> PAID carries on (Shopify retries webhooks).
  const flipped = await prisma.requestPayment.updateMany({
    where: { id: payment.id, status: { not: "PAID" } },
    data: { status: "PAID", paymentId: input.shopifyOrderId, paidAt: input.paidAt ?? new Date() },
  });
  if (!flipped.count) return { handled: false, reason: "already_paid" };

  if (payment.purpose === "STYLE_DIFFERENCE") {
    const { markStyleDifferencePaid } = await import("./style-operations.ts");
    return { handled: true, purpose: "STYLE_DIFFERENCE", requestId: payment.requestId, followUp: () => markStyleDifferencePaid(payment.requestId, payment.amount) };
  }

  if (canTransitionExchangeStatus(payment.request.status, "PAYMENT_RECEIVED") && payment.request.status !== "PAYMENT_RECEIVED") {
    await prisma.orderActionRequest.update({ where: { id: payment.requestId }, data: { status: "PAYMENT_RECEIVED" } });
  }
  await prisma.shipmentTracking.upsert({
    where: { requestId_direction: { requestId: payment.requestId, direction: "REVERSE_PICKUP" } },
    create: { requestId: payment.requestId, direction: "REVERSE_PICKUP", status: "PENDING" },
    update: { status: "PENDING" },
  });

  const requestId = payment.requestId;
  return {
    handled: true,
    purpose: "REVERSE_PICKUP_FEE",
    requestId,
    followUp: async () => {
      const { notifyExchangeMilestone } = await import("../notifications/exchange-milestones.ts");
      const { autoCreateReversePickupForRequest } = await import("./auto-reverse-pickup.ts");
      await notifyExchangeMilestone(requestId, "PAYMENT_RECEIVED");
      const result = await autoCreateReversePickupForRequest(requestId);
      if (result.ok && result.awb) console.info("[EXCHANGE AUTO PICKUP] reverse pickup created", { requestId, awb: result.awb, status: result.status });
      else console.warn("[EXCHANGE AUTO PICKUP] not created — manual fallback available", { requestId, reason: result.reason });
    },
  };
}

/**
 * orders/create safety net: an exchange-charge order that was placed but not paid
 * (e.g. Cash on Delivery slipped through) never reaches orders/paid, so the
 * exchange would wait forever. Tell the store instead.
 */
export async function flagUnpaidChargeOrder(input: { shopDomain: string; orderName: string; financialStatus: string; referenceId: string }) {
  if (!input.referenceId || ["paid", "partially_refunded", "refunded"].includes(input.financialStatus.toLowerCase())) return;
  const shop = await prisma.shop.findFirst({ where: { shopDomain: input.shopDomain }, select: { id: true } });
  if (!shop) return;
  const payment = await prisma.requestPayment.findFirst({
    where: { provider: "SHOPIFY", providerReferenceId: input.referenceId, request: { shopId: shop.id } },
    select: { request: { select: { orderNumber: true } } },
  });
  if (!payment) return;
  const { sendAdminAlert } = await import("../notifications/resend.ts");
  await sendAdminAlert({
    shopId: shop.id,
    eventType: "EXCHANGE",
    subject: `Exchange #${payment.request.orderNumber}: the pickup charge order ${input.orderName} isn't paid`,
    text: `Order ${input.orderName} for the exchange charge was placed with payment status "${input.financialStatus}", so the reverse pickup hasn't been booked. Check the payment in Shopify, or waive the charge on the exchange page to book the pickup.`,
  }).catch(() => undefined);
}
