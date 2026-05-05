import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  CANCELLATION_ALLOWED_STATUS_TRANSITIONS,
  evaluateCancellationEligibility,
} from "../../../../../../services/exchange/cancellation";
import { createRefundRequest } from "../../../../../../services/refund-request";

export const runtime = "nodejs";

type RefundMethod = "COD" | "PREPAID";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

function detectPaymentMethod(paymentGatewayName: string | null | undefined): RefundMethod {
  const normalized = String(paymentGatewayName || "").trim().toLowerCase();
  return normalized.includes("cod") || normalized.includes("cash") ? "COD" : "PREPAID";
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

    if (nextStatus.toUpperCase() === "APPROVED") {
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
      const canCreateRefund =
        Boolean(existing.shopId) &&
        Number.isFinite(refundAmountMinor) &&
        refundAmountMinor > 0 &&
        (refundMethod === "PREPAID" || refundRequiredForCod);

      if (canCreateRefund) {
        await createRefundRequest({
          shop: { id: String(existing.shopId) },
          orderId: existing.id,
          amount: Math.trunc(refundAmountMinor),
          reason: "Cancellation approved",
          source: "CANCELLATION_REQUEST",
          sourceId: existing.id,
          customer: { id: existing.customerProfileId },
        });
        orchestrationNote =
          refundMethod === "COD"
            ? "RefundRequest created after cancellation approval (COD override: refundRequired=true)."
            : "RefundRequest created after cancellation approval (PREPAID).";
      } else if (refundMethod === "COD") {
        orchestrationNote = "No RefundRequest created: cancellation approved for COD order (default policy).";
      } else {
        orchestrationNote = "No RefundRequest created: cancellation approved but refund amount/shop context missing.";
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
