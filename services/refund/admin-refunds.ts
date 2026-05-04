import { prisma } from "../db/prisma";
import type { RefundRequest } from "../../generated/prisma/index.js";

function toAdminSummary(refund: RefundRequest & { payoutDetails?: any | null }) {
  return {
    id: refund.id,
    source: refund.source,
    sourceId: refund.sourceId,
    method: refund.method,
    status: refund.status,
    currency: refund.currency,
    amount: refund.amount,
    customerProfileId: refund.customerProfileId,
    reason: refund.reason,
    customerNote: refund.customerNote,
    adminNote: refund.adminNote,
    detailsSubmittedAt: refund.detailsSubmittedAt,
    approvedAt: refund.approvedAt,
    rejectedAt: refund.rejectedAt,
    paidAt: refund.paidAt,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
    payoutDetails: refund.payoutDetails
      ? {
          rail: refund.payoutDetails.rail,
          accountHolderName: refund.payoutDetails.accountHolderName,
          bankAccountMasked: refund.payoutDetails.bankAccountMasked,
          bankIfscMasked: refund.payoutDetails.bankIfsc
            ? `${String(refund.payoutDetails.bankIfsc).slice(0, 2)}******${String(refund.payoutDetails.bankIfsc).slice(-2)}`
            : null,
          upiIdMasked: refund.payoutDetails.upiIdMasked,
          phoneMasked: refund.payoutDetails.phoneMasked,
          verifiedAt: refund.payoutDetails.verifiedAt,
          createdAt: refund.payoutDetails.createdAt,
          updatedAt: refund.payoutDetails.updatedAt,
        }
      : null,
  };
}

export async function listAdminRefunds(shopId: string) {
  const refunds = await prisma.refundRequest.findMany({
    where: { shopId },
    include: { payoutDetails: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return refunds.map((item) => toAdminSummary(item as never));
}

export async function getAdminRefundById(shopId: string, id: string) {
  const refund = await prisma.refundRequest.findFirst({
    where: { id, shopId },
    include: { payoutDetails: true },
  });
  if (!refund) return null;
  return toAdminSummary(refund as never);
}

export async function approveAdminRefund(shopId: string, id: string, actorId?: string | null) {
  const refund = await prisma.refundRequest.findFirst({ where: { id, shopId }, include: { payoutDetails: true } });
  if (!refund) return { status: 404, error: "Refund not found" };
  if (refund.status === "PAID") return { status: 400, error: "Cannot modify PAID refund" };
  if (refund.status !== "DETAILS_SUBMITTED") return { status: 400, error: "Only DETAILS_SUBMITTED can be approved" };
  if (refund.method === "COD" && !refund.payoutDetails) return { status: 400, error: "Cannot approve COD refund without payout details" };

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } });
    await tx.refundEvent.create({
      data: {
        refundRequestId: id,
        actorType: "ADMIN",
        actorId: actorId || null,
        eventType: "ADMIN_APPROVED",
        fromStatus: refund.status,
        toStatus: "APPROVED",
      },
    });
  });

  const updated = await getAdminRefundById(shopId, id);
  return { status: 200, data: updated };
}

export async function rejectAdminRefund(shopId: string, id: string, payload: Record<string, unknown>, actorId?: string | null) {
  const refund = await prisma.refundRequest.findFirst({ where: { id, shopId } });
  if (!refund) return { status: 404, error: "Refund not found" };
  if (refund.status === "PAID") return { status: 400, error: "Cannot modify PAID refund" };
  if (refund.status !== "DETAILS_SUBMITTED") return { status: 400, error: "Only DETAILS_SUBMITTED can be rejected" };

  const note = String(payload.note || "").trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({ where: { id }, data: { status: "REJECTED", rejectedAt: new Date(), adminNote: note ?? refund.adminNote } });
    await tx.refundEvent.create({
      data: {
        refundRequestId: id,
        actorType: "ADMIN",
        actorId: actorId || null,
        eventType: "ADMIN_REJECTED",
        fromStatus: refund.status,
        toStatus: "REJECTED",
        message: note,
      },
    });
  });

  const updated = await getAdminRefundById(shopId, id);
  return { status: 200, data: updated };
}

export async function markAdminRefundPaid(shopId: string, id: string, payload: Record<string, unknown>, actorId?: string | null) {
  const refund = await prisma.refundRequest.findFirst({ where: { id, shopId } });
  if (!refund) return { status: 404, error: "Refund not found" };
  if (refund.status === "PAID") return { status: 400, error: "Cannot modify PAID refund" };
  if (refund.status !== "APPROVED") return { status: 400, error: "Cannot mark paid unless APPROVED" };

  const referenceId = String(payload.referenceId || "").trim();
  const note = String(payload.note || "").trim();
  if (!referenceId) return { status: 400, error: "referenceId is required" };

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({ where: { id }, data: { status: "PAID", paidAt: new Date(), adminNote: note || refund.adminNote } });
    await tx.refundPayout.create({
      data: {
        refundRequestId: id,
        status: "SUCCESS",
        provider: "manual",
        providerReferenceId: referenceId,
        amount: refund.amount,
        currency: refund.currency,
        initiatedAt: new Date(),
        completedAt: new Date(),
        metadata: note ? { note } : undefined,
      },
    });
    await tx.refundEvent.create({
      data: {
        refundRequestId: id,
        actorType: "ADMIN",
        actorId: actorId || null,
        eventType: "ADMIN_MARKED_PAID",
        fromStatus: refund.status,
        toStatus: "PAID",
        message: note || null,
        payload: { referenceId },
      },
    });
  });

  const updated = await getAdminRefundById(shopId, id);
  return { status: 200, data: updated };
}

export async function markAdminRefundFailed(shopId: string, id: string, payload: Record<string, unknown>, actorId?: string | null) {
  const refund = await prisma.refundRequest.findFirst({ where: { id, shopId } });
  if (!refund) return { status: 404, error: "Refund not found" };
  if (refund.status === "PAID") return { status: 400, error: "Cannot modify PAID refund" };
  if (refund.status !== "APPROVED") return { status: 400, error: "Only APPROVED refunds can be marked failed" };

  const reason = String(payload.reason || "").trim();
  if (!reason) return { status: 400, error: "reason is required" };

  await prisma.$transaction(async (tx) => {
    await tx.refundRequest.update({ where: { id }, data: { status: "FAILED", adminNote: reason } });
    await tx.refundPayout.create({
      data: {
        refundRequestId: id,
        status: "FAILED",
        provider: "manual",
        amount: refund.amount,
        currency: refund.currency,
        failureReason: reason,
        initiatedAt: new Date(),
      },
    });
    await tx.refundEvent.create({
      data: {
        refundRequestId: id,
        actorType: "ADMIN",
        actorId: actorId || null,
        eventType: "ADMIN_MARKED_FAILED",
        fromStatus: refund.status,
        toStatus: "FAILED",
        message: reason,
      },
    });
  });

  const updated = await getAdminRefundById(shopId, id);
  return { status: 200, data: updated };
}
