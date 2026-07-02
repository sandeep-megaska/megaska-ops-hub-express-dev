import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { ISSUE_ALLOWED_STATUS_TRANSITIONS } from "../../../../../../services/exchange/issue";
import { settleCodRefundAsStoreCredit } from "../../../../../../services/store-credit";
import { resolveIssueRefundSnapshot } from "../../../../../../services/issue-refund-recovery";

export const runtime = "nodejs";

const COD_STORE_CREDIT_ELIGIBLE_STATUSES = new Set(["MANUAL_PENDING", "APPROVED", "PAYOUT_PENDING"]);
type RefundMethod = "COD" | "PREPAID";

function parseRefundAmountMinor(value: unknown): { amount: number | null; error: string | null } {
  const raw = String(value ?? "").trim();
  if (!raw) return { amount: null, error: "Refund amount is required when approving an issue for refund." };
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    return { amount: null, error: "Refund amount must be numeric with max 2 decimal places." };
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { amount: null, error: "Refund amount must be greater than 0." };
  return { amount: Math.round(amount * 100), error: null };
}

function parseRefundMethod(value: unknown): RefundMethod | null {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "COD" || normalized === "PREPAID" ? normalized : null;
}

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const nextStatus = String(body?.nextStatus || "").trim();
    const adminNote = String(body?.adminNote || "").trim() || null;
    const adminId = String(body?.adminId || "").trim() || null;
    const requestedRefundMethod = parseRefundMethod(body?.refundMethod);

    if (!nextStatus) {
      return NextResponse.json({ error: "nextStatus is required" }, { status: 400 });
    }

    const existing = await prisma.orderActionRequest.findFirst({
      where: { id, requestType: "ISSUE" },
      include: { items: { take: 1 } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = ISSUE_ALLOWED_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(nextStatus) && nextStatus !== existing.status) {
      return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
    }

    let storeCreditSettlement: { walletTransactionId: string; alreadySettled: boolean } | null = null;
    const normalizedNextStatus = nextStatus.toUpperCase();
    const refundAmountInput = body?.refundAmountPaise ?? body?.refundAmountMinor;
    const refundAmountMinor = typeof refundAmountInput === "number" && Number.isInteger(refundAmountInput) && refundAmountInput > 0 ? refundAmountInput : null;
    const approvalAmount = normalizedNextStatus === "APPROVED" ? parseRefundAmountMinor(body?.refundAmountRupees ?? body?.refundAmount ?? body?.amount) : { amount: null, error: null };

    if (normalizedNextStatus === "APPROVED") {
      const minorProvided = refundAmountInput !== undefined && refundAmountInput !== null && refundAmountInput !== "";
      const minorError = minorProvided && !refundAmountMinor ? "Refund amount minor value must be a positive integer." : null;
      const amountError = minorError || (!refundAmountMinor ? approvalAmount.error : null);
      if (amountError) {
        return NextResponse.json(
          {
            request: existing,
            storeCreditSettlement,
            error: amountError,
            serverError: amountError,
            validation: { invalidRefundAmount: true, missingRefundAmount: !minorProvided && !body?.refundAmountRupees && !body?.refundAmount && !body?.amount },
          },
          { status: 422 }
        );
      }
    }

    const adminRefundAmountMinor = refundAmountMinor || approvalAmount.amount;
    const needsRefundResolution = normalizedNextStatus === "APPROVED" || normalizedNextStatus === "RETURN_RECEIVED";
    const resolved = needsRefundResolution
      ? await resolveIssueRefundSnapshot(existing.id, { refundAmountMinor: adminRefundAmountMinor, refundMethod: requestedRefundMethod, adminNote, adminId })
      : null;
    if (resolved && !resolved.ok) {
      return NextResponse.json(
        {
          request: existing,
          storeCreditSettlement,
          error: resolved.error,
          serverError: resolved.error,
          validation: {
            missingShopContext: resolved.error?.includes("shop context") || false,
            missingRefundAmount: resolved.error?.includes("refund amount") || false,
            paymentMethodUndetermined: resolved.error?.includes("payment method") || false,
            missingCustomerProfile: resolved.error?.includes("customer profile") || false,
          },
        },
        { status: 422 }
      );
    }

    const updated = await prisma.orderActionRequest.update({
      where: { id: existing.id },
      data: {
        status: nextStatus as never,
        adminNote: adminNote ?? existing.adminNote,
      },
      include: { items: { take: 1 }, customerProfile: { select: { id: true } } },
    });

    if (resolved?.ok) {
      if (normalizedNextStatus === "RETURN_RECEIVED" && resolved.refundRequestId) {
        const refund = await prisma.refundRequest.findFirst({
          where: { id: resolved.refundRequestId, source: "ISSUE_REQUEST", orderActionRequestId: updated.id },
        });

        if (
          refund?.method === "COD" &&
          !refund.walletTransactionId &&
          COD_STORE_CREDIT_ELIGIBLE_STATUSES.has(refund.status)
        ) {
          const settlement = await settleCodRefundAsStoreCredit({
            refundRequestId: refund.id,
            actor: { type: "ADMIN", id: adminId },
          });
          storeCreditSettlement = {
            walletTransactionId: settlement.walletTransaction.id,
            alreadySettled: settlement.alreadySettled,
          };
          console.info("[ISSUE REFUND RECOVERY] settled", { issueId: updated.id, resolvedShopId: resolved.resolvedShopId || null, resolvedOrderId: resolved.resolvedOrderId || null, resolvedAmount: resolved.resolvedAmount || null, resolvedPaymentMethod: resolved.resolvedPaymentMethod || null, refundRequestId: refund.id, walletTransactionId: settlement.walletTransaction.id, skipReason: null });
        }
      }
    }

    return NextResponse.json({ request: updated, storeCreditSettlement });
  } catch (error) {
    const serverError = error instanceof Error ? error.message : "Failed";
    console.error("[admin issue status] failed", { error });
    return NextResponse.json({ error: serverError, serverError }, { status: 500 });
  }
}
