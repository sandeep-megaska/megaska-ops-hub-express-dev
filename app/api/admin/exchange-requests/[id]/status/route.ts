import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireShopFromRequest,
  ShopResolutionError,
} from "../../../../../../services/shopify/shop";
import {
  allowedStatusTransitions,
  canTransitionExchangeStatus,
} from "../../../../../../services/exchange/lifecycle";
import {
  sendExchangeApprovedPaymentRequiredEmail,
  sendExchangeStatusChangedEmail,
} from "../../../../../../services/notifications/exchange";

export const runtime = "nodejs";

const DEFAULT_PICKUP_CHARGE_PAISE = 12000;

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

function parsePickupChargePaise(raw: unknown) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_PICKUP_CHARGE_PAISE;
  }
  return Math.round(value * 100);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shop = await requireShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const nextStatus = String(body?.nextStatus || "").trim();
    const adminNote = String(body?.adminNote || "").trim() || null;
    const approvalMode = String(body?.approvalMode || "").trim().toUpperCase();
    const returnMethod =
      String(body?.returnMethod || "REVERSE_PICKUP").trim().toUpperCase() ===
      "SELF_SHIP"
        ? "SELF_SHIP"
        : "REVERSE_PICKUP";
    const pickupChargePaise = parsePickupChargePaise(body?.pickupChargeInr);

    if (!nextStatus) {
      return NextResponse.json(
        { error: "nextStatus is required" },
        { status: 400 }
      );
    }

    const existing = await prisma.orderActionRequest.findFirst({
      where: {
        id,
        shopId: shop.id,
        requestType: "EXCHANGE",
      },
      include: {
        items: { take: 1 },
        payments: {
          where: { purpose: "REVERSE_PICKUP_FEE" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let targetStatus = nextStatus;
    const isApprovalFlow = approvalMode === "APPROVE";

    if (isApprovalFlow) {
      targetStatus = returnMethod === "SELF_SHIP" ? "APPROVED" : "AWAITING_PAYMENT";
    }

    const allowed = allowedStatusTransitions[existing.status] || [];
    if (!canTransitionExchangeStatus(existing.status, targetStatus) && targetStatus !== existing.status) {
      return NextResponse.json(
        { error: "Invalid status transition", allowed },
        { status: 400 }
      );
    }

    if (
      targetStatus === "REPLACEMENT_SHIPPED" &&
      !["ITEM_RECEIVED", "REPLACEMENT_PROCESSING"].includes(existing.status)
    ) {
      return NextResponse.json(
        { error: "Cannot ship replacement before item is received." },
        { status: 400 }
      );
    }

    if (
      targetStatus === "PICKUP_COMPLETED" &&
      !["PICKUP_PENDING", "PICKUP_SCHEDULED"].includes(existing.status)
    ) {
      return NextResponse.json(
        {
          error: "Cannot complete pickup before pickup is pending/scheduled.",
        },
        { status: 400 }
      );
    }

    if (
      targetStatus === "PICKUP_PENDING" &&
      existing.status !== "PAYMENT_RECEIVED" &&
      existing.status !== "APPROVED"
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot mark reverse pickup pending before payment is received (or for approved self-ship flow).",
        },
        { status: 400 }
      );
    }

    const shouldRequirePayment = isApprovalFlow && returnMethod === "REVERSE_PICKUP";

    const updated = await prisma.$transaction(async (tx) => {
      if (shouldRequirePayment) {
        const latestPayment = existing.payments[0];
        if (latestPayment) {
          await tx.requestPayment.update({
            where: { id: latestPayment.id },
            data: {
              amount: pickupChargePaise,
              currency: "INR",
              status: latestPayment.status === "PAID" ? "PAID" : "NOT_CREATED",
              paymentLinkId: latestPayment.status === "PAID" ? latestPayment.paymentLinkId : null,
              paymentLinkUrl: latestPayment.status === "PAID" ? latestPayment.paymentLinkUrl : null,
              providerReferenceId:
                latestPayment.status === "PAID" ? latestPayment.providerReferenceId : null,
              paymentId: latestPayment.status === "PAID" ? latestPayment.paymentId : null,
              expiresAt: latestPayment.status === "PAID" ? latestPayment.expiresAt : null,
            },
          });
        } else {
          await tx.requestPayment.create({
            data: {
              requestId: existing.id,
              purpose: "REVERSE_PICKUP_FEE",
              provider: "RAZORPAY",
              amount: pickupChargePaise,
              currency: "INR",
              status: "NOT_CREATED",
            },
          });
        }
      }

      if (isApprovalFlow && returnMethod === "SELF_SHIP" && existing.payments[0] && existing.payments[0].status !== "PAID") {
        await tx.requestPayment.update({
          where: { id: existing.payments[0].id },
          data: {
            status: "CANCELLED",
            paymentLinkId: null,
            paymentLinkUrl: null,
            providerReferenceId: null,
            expiresAt: null,
          },
        });
      }

      return tx.orderActionRequest.update({
        where: { id: existing.id },
        data: {
          status: targetStatus as never,
          adminNote: adminNote ?? existing.adminNote,
        },
        include: { items: { take: 1 } },
      });
    });

    if (shouldRequirePayment) {
      void sendExchangeApprovedPaymentRequiredEmail({
        requestId: updated.id,
        orderNumber: updated.orderNumber,
        status: updated.status,
        customerName: updated.customerNameSnapshot,
        customerPhone: updated.customerPhoneSnapshot,
        customerEmail: updated.customerEmailSnapshot,
        currentSize: updated.items[0]?.currentSize,
        requestedSize: updated.items[0]?.requestedSize,
        adminNote: updated.adminNote,
        paymentAmountPaise: pickupChargePaise,
        paymentCurrency: "INR",
      });
    }

    void sendExchangeStatusChangedEmail({
      requestId: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
      customerName: updated.customerNameSnapshot,
      customerPhone: updated.customerPhoneSnapshot,
      customerEmail: updated.customerEmailSnapshot,
      itemTitle: updated.items[0]?.productTitle,
      currentSize: updated.items[0]?.currentSize,
      requestedSize: updated.items[0]?.requestedSize,
      adminNote: updated.adminNote,
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status }
    );
  }
}
