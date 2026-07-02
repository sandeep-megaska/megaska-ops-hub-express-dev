import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { ISSUE_ALLOWED_STATUS_TRANSITIONS } from "../../../../../../services/exchange/issue";
import { settleCodRefundAsStoreCredit } from "../../../../../../services/store-credit";
import { resolveIssueRefundSnapshot } from "../../../../../../services/issue-refund-recovery";

export const runtime = "nodejs";

const COD_STORE_CREDIT_ELIGIBLE_STATUSES = new Set(["MANUAL_PENDING", "APPROVED", "PAYOUT_PENDING"]);

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
    const needsRefundResolution = nextStatus.toUpperCase() === "APPROVED" || nextStatus.toUpperCase() === "RETURN_RECEIVED";
    const resolved = needsRefundResolution ? await resolveIssueRefundSnapshot(existing.id) : null;
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
      if (nextStatus.toUpperCase() === "RETURN_RECEIVED" && resolved.refundRequestId) {
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
