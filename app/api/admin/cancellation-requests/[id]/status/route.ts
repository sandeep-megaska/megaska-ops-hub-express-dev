import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  CANCELLATION_ALLOWED_STATUS_TRANSITIONS,
  evaluateCancellationEligibility,
} from "../../../../../../services/exchange/cancellation";
import { createRefundRequest } from "../../../../../../services/refund-request";

export const runtime = "nodejs";

type RefundType = "COD" | "PREPAID" | "NO_REFUND";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

function detectPaymentMethod(paymentGatewayName: string | null | undefined): Exclude<RefundType, "NO_REFUND"> {
  const normalized = String(paymentGatewayName || "").trim().toLowerCase();
  if (normalized === "cod" || normalized === "cash on delivery") return "COD";
  return "PREPAID";
}

function shouldForceCodRefund(body: Record<string, unknown> | null): boolean {
  if (!body || typeof body !== "object") return false;

  const directFlag = body.refundRequired;
  if (typeof directFlag === "boolean") return directFlag;

  const metadata = body.metadata;
  if (metadata && typeof metadata === "object" && "refundRequired" in metadata) {
    return (metadata as { refundRequired?: unknown }).refundRequired === true;
  }

  return false;
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
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        items: { orderBy: { createdAt: "asc" }, take: 1, select: { eligibilitySnapshot: true } },
      },
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

    let orchestrationNote: string | null = null;

    if (nextStatus === "APPROVED") {
      const paymentGatewayName =
        existing.items[0]?.eligibilitySnapshot &&
        typeof existing.items[0].eligibilitySnapshot === "object" &&
        "paymentGatewayName" in existing.items[0].eligibilitySnapshot
          ? String(
              (existing.items[0].eligibilitySnapshot as { paymentGatewayName?: unknown }).paymentGatewayName || "",
            )
          : "";
      const refundMethod = detectPaymentMethod(paymentGatewayName);
      const refundRequiredForCod = shouldForceCodRefund(body);
      const refundAmountMinor = Number(existing.orderAmountSnapshot || 0);
      const hasValidAmount = Boolean(Number.isFinite(refundAmountMinor) && refundAmountMinor > 0);
      const refundType: RefundType = hasValidAmount
        ? refundMethod === "COD" && !refundRequiredForCod
          ? "NO_REFUND"
          : refundMethod
        : "NO_REFUND";

      if (existing.shopId) {
        await createRefundRequest({
          shop: { id: String(existing.shopId) },
          orderId: existing.id,
          amount: hasValidAmount ? Math.trunc(refundAmountMinor) : 1,
          reason: "Cancellation approved",
          source: "CANCELLATION_REQUEST",
          sourceId: existing.id,
          customer: { id: existing.customerProfileId },
          method: refundType === "NO_REFUND" ? "PREPAID" : refundType,
          status:
            refundType === "PREPAID"
              ? "PENDING"
              : refundType === "COD"
                ? "MANUAL_PENDING"
                : "NOT_REQUIRED",
          createdBy: { type: "ADMIN", id: req.headers.get("x-admin-id") || null },
        });
        orchestrationNote = `RefundRequest created after cancellation approval (${refundType}).`;
      } else {
        orchestrationNote = "No RefundRequest created: cancellation approved but shop context missing.";
      }
    }

    const updated = await prisma.orderActionRequest.update({
      where: { id: existing.id },
      data: {
        status: nextStatus as never,
        adminNote: [adminNote ?? existing.adminNote, orchestrationNote].filter(Boolean).join("\n") || null,
      },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1 }, customerProfile: { select: { id: true } } },
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
