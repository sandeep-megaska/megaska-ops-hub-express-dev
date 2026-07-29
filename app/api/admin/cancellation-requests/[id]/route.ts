import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { deriveCancellationOutcome } from "../../../../../services/exchange/cancellation";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";


export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const requestItem = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "CANCELLATION" },
      include: {
        payments: { orderBy: { createdAt: "desc" } },
        shipments: true,
      },
    });

    if (!requestItem) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const refundRequests = await (prisma as any).refundRequest.findMany({
      where: { orderActionRequestId: requestItem.id },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      request: {
        ...requestItem,
        cancellationOutcome: deriveCancellationOutcome({
          cancellationStatus: requestItem.status,
          orderAmountSnapshot: requestItem.orderAmountSnapshot,
          refundRequests,
        }),
      },
    });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const adminNote = String(body?.adminNote || "").trim();

    if (!adminNote) {
      return NextResponse.json({ error: "adminNote is required" }, { status: 400 });
    }

    const existing = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "CANCELLATION" },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.orderActionRequest.update({
      where: { id: existing.id },
      data: { adminNote },
    });

    return NextResponse.json({ request: updated, message: "Admin note updated" });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
