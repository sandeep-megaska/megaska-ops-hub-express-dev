import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  CANCELLATION_ALLOWED_STATUS_TRANSITIONS,
  evaluateCancellationEligibility,
} from "../../../../../../services/exchange/cancellation";
import { createRefundRequest } from "../../../../../../services/refund-request";

export const runtime = "nodejs";

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

    if (!nextStatus) {
      return NextResponse.json({ error: "nextStatus is required" }, { status: 400 });
    }

    const existing = await prisma.orderActionRequest.findFirst({
      where: { id, requestType: "CANCELLATION" },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = CANCELLATION_ALLOWED_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(nextStatus) && nextStatus !== existing.status) {
      return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
    }

    if (nextStatus === "APPROVED") {
      const eligibility = evaluateCancellationEligibility({
        fulfillmentStatus: body?.fulfillmentStatus ? String(body.fulfillmentStatus) : null,
        financialStatus: body?.financialStatus ? String(body.financialStatus) : null,
      });

      if (!eligibility.eligible) {
        return NextResponse.json({ error: eligibility.reason }, { status: 400 });
      }
    }

    const updated = await prisma.orderActionRequest.update({
      where: { id: existing.id },
      data: {
        status: nextStatus as never,
        adminNote: adminNote ?? existing.adminNote,
      },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 }, customerProfile: { select: { id: true } } },
    });

    if (nextStatus.toUpperCase() === "APPROVED") {
      const refundAmountMinor = Number(updated.orderAmountSnapshot || 0);
      if (Number.isFinite(refundAmountMinor) && refundAmountMinor > 0) {
        await createRefundRequest({
          shop: { id: updated.shopId },
          orderId: updated.id,
          amount: Math.trunc(refundAmountMinor),
          reason: "Cancellation approved",
          source: "CANCELLATION_REQUEST",
          sourceId: updated.id,
          customer: { id: updated.customerProfile.id },
        });
      }
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
