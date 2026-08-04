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

    const transactionType = reason.toUpperCase().includes("GOODWILL") ? "GOODWILL_CREDIT" : "MANUAL_CREDIT";

    const result = await applyWalletTransaction({
      shopId: shop.id,
      customerProfileId,
      amount,
      direction: "CREDIT",
      transactionType,
      sourceType: "ADMIN_MANUAL",
      sourceId: `${customerProfileId}:${Date.now()}`,
      reason,
      adminNote,
      createdByType: "ADMIN",
      createdById,
    });

    // Mirror the manual credit onto the customer's Shopify gift card so it is actually
    // spendable at checkout (create on first grant, top up otherwise). Best-effort and
    // durably retryable via the same projection the COD-refund settlement uses; a failure
    // never fails the ledger credit. On a first-time create, email the customer the code.
    let giftCard: unknown = { status: "skipped" };
    try {
      const { projectCreditToGiftCard } = await import("../../../../../../services/store-credit/gift-card-projection");
      const projection = await projectCreditToGiftCard(result.transaction.id);
      giftCard = projection;
      // Log the outcome (incl. the failure reason) - a returned failure was previously
      // invisible: not logged and not shown, so a silent gift-card top-up failure looked
      // like "nothing happened".
      console.info("[WALLET ADMIN] gift_card_projection", { customerProfileId, walletTransactionId: result.transaction.id, ...projection });
      if (projection.status === "created") {
        const { notifyGiftCardCodeGenerated } = await import("../../../../../../services/notifications/store-credit");
        notifyGiftCardCodeGenerated({ shopId: shop.id, customerProfileId });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("[WALLET ADMIN] gift_card_projection_failed", { customerProfileId, error: reason });
      // Carry the thrown message back so the admin UI shows the real reason (a thrown
      // GraphQL/network error, vs a graceful userError) instead of "unknown reason".
      giftCard = { status: "failed", reason };
    }

    return NextResponse.json({ wallet: result.account, transaction: result.transaction, giftCard });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
