import { NextRequest, NextResponse } from "next/server";
import { applyWalletTransaction, parseAmountToMinorUnits } from "../../../../../../services/wallet";
import { prisma } from "../../../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";

export async function POST(req: NextRequest, context: { params: Promise<{ customerProfileId: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { customerProfileId } = await context.params;

    // Tenant isolation: the customer must belong to the acting shop.
    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      select: { id: true, shopId: true },
    });
    if (!customer || customer.shopId !== shop.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const reason = String(body?.reason || "").trim();
    const adminNote = String(body?.adminNote || "").trim();
    const amount = parseAmountToMinorUnits(String(body?.amount || ""));
    const createdById = String(body?.adminId || "").trim() || null;

    if (!reason || !adminNote || amount <= 0) {
      return NextResponse.json({ error: "amount, reason, and adminNote are required" }, { status: 400 });
    }

    const result = await applyWalletTransaction({
      shopId: shop.id,
      customerProfileId,
      amount,
      direction: "DEBIT",
      transactionType: "MANUAL_DEBIT",
      sourceType: "ADMIN_MANUAL",
      sourceId: `${customerProfileId}:${Date.now()}`,
      reason,
      adminNote,
      createdByType: "ADMIN",
      createdById,
      allowNegativeBalance: false,
    });

    return NextResponse.json({ wallet: result.account, transaction: result.transaction });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
