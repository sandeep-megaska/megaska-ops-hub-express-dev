import { Prisma, RefundMethod, RefundSource, RefundStatus } from "../generated/prisma/index.js";
import { prisma } from "./db/prisma";

type CreateRefundRequestInput = {
  shop: { id: string };
  orderId: string;
  amount: number;
  reason?: string | null;
  source: RefundSource;
  sourceId: string;
  customer?: { id?: string | null } | null;
};

function detectRefundMethodFromGateway(paymentGatewayName: string | null | undefined): RefundMethod {
  const normalized = String(paymentGatewayName || "").trim().toLowerCase();
  return normalized.includes("cod") || normalized.includes("cash") ? "COD" : "PREPAID";
}

function initialStatusForMethod(method: RefundMethod): RefundStatus {
  return method === "COD" ? "DETAILS_PENDING" : "APPROVED";
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createRefundRequest(input: CreateRefundRequestInput) {
  const orderLookupKey = String(input.orderId || "").trim();
  if (!orderLookupKey) throw new Error("orderId is required");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("amount must be positive");

  const order = await prisma.orderActionRequest.findFirst({
    where: {
      shopId: input.shop.id,
      OR: [{ id: orderLookupKey }, { shopifyOrderId: orderLookupKey }, { orderNumber: orderLookupKey }],
    },
    include: { items: { take: 1, orderBy: { createdAt: "asc" } } },
  });

  if (!order) {
    throw new Error("Order not found for shop");
  }

  const paymentGatewayName =
    order.items[0]?.eligibilitySnapshot &&
    typeof order.items[0].eligibilitySnapshot === "object" &&
    "paymentGatewayName" in order.items[0].eligibilitySnapshot
      ? String((order.items[0].eligibilitySnapshot as { paymentGatewayName?: unknown }).paymentGatewayName || "")
      : "";

  const method = detectRefundMethodFromGateway(paymentGatewayName);
  const status = initialStatusForMethod(method);

  const baseCreate = {
    shopId: input.shop.id,
    source: input.source,
    sourceId: input.sourceId,
    method,
    status,
    amount: Math.trunc(input.amount),
    reason: input.reason || null,
    customerProfileId: input.customer?.id || order.customerProfileId || null,
    orderActionRequestId: order.id,
    shopifyOrderId: order.shopifyOrderId || null,
  } as const;

  let refund = null;
  try {
    refund = await prisma.refundRequest.create({ data: baseCreate });
    await prisma.refundEvent.create({
      data: {
        refundRequestId: refund.id,
        actorType: "SYSTEM",
        eventType: "REFUND_REQUEST_CREATED",
        toStatus: status,
        message: `Refund request created with initial status ${status}`,
        payload: { method, source: input.source, sourceId: input.sourceId },
      },
    });
    return refund;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const existing = await prisma.refundRequest.findUnique({
      where: {
        shopId_source_sourceId: {
          shopId: input.shop.id,
          source: input.source,
          sourceId: input.sourceId,
        },
      },
    });
    if (!existing) throw error;
    return existing;
  }
}

export const __private__ = { detectRefundMethodFromGateway, initialStatusForMethod };
