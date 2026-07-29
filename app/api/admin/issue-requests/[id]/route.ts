import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";


export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const requestItem = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "ISSUE" },
      include: {
        items: true,
        payments: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!requestItem) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ request: requestItem });
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
      where: { id, shopId: shop.id, requestType: "ISSUE" },
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
