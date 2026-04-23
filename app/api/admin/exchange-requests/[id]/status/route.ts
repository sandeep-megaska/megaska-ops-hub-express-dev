import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireShopFromRequest,
  ShopResolutionError,
} from "../../../../../../services/shopify/shop";
import { allowedStatusTransitions } from "../../../../../../services/exchange/lifecycle";
import { sendExchangeStatusChangedEmail } from "../../../../../../services/notifications/exchange";

export const runtime = "nodejs";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
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
      include: { items: { take: 1 } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = allowedStatusTransitions[existing.status] || [];
    if (!allowed.includes(nextStatus) && nextStatus !== existing.status) {
      return NextResponse.json(
        { error: "Invalid status transition" },
        { status: 400 }
      );
    }

    if (
      nextStatus === "REPLACEMENT_SHIPPED" &&
      !["ITEM_RECEIVED", "REPLACEMENT_PROCESSING"].includes(existing.status)
    ) {
      return NextResponse.json(
        { error: "Cannot ship replacement before item is received." },
        { status: 400 }
      );
    }

    if (
      nextStatus === "PICKUP_COMPLETED" &&
      !["PICKUP_PENDING", "PICKUP_SCHEDULED"].includes(existing.status)
    ) {
      return NextResponse.json(
        {
          error: "Cannot complete pickup before pickup is pending/scheduled.",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.orderActionRequest.update({
      where: { id: existing.id },
      data: {
        status: nextStatus as never,
        adminNote: adminNote ?? existing.adminNote,
      },
      include: { items: { take: 1 } },
    });

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
