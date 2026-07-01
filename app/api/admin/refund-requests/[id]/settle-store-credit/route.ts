import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { settleCodRefundAsStoreCredit } from "../../../../../../services/store-credit";
import { requireShopFromRequest, ShopResolutionError } from "../../../../../../services/shopify/shop";

const VALIDATION_MESSAGES = [
  "refundRequestId is required",
  "shopId is required",
  "customerProfileId is required",
  "Only COD refund requests can be settled as store credit",
  "amount must be positive",
  "cannot be settled as store credit",
  "is not eligible for store credit settlement",
  "store credit identity is incomplete",
  "wallet transaction was not found",
];

function isValidationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return VALIDATION_MESSAGES.some((item) => message.includes(item));
}

function safeSettlementResponse(result: Awaited<ReturnType<typeof settleCodRefundAsStoreCredit>>) {
  return {
    ok: true,
    refundRequest: result.refundRequest,
    walletAccount: result.walletAccount,
    walletTransaction: result.walletTransaction,
    alreadySettled: result.alreadySettled,
  };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireShopFromRequest(req);
    const { id } = await context.params;

    const refund = await (prisma as any).refundRequest.findFirst({
      where: { id, shopId: shop.id },
      select: { id: true },
    });
    if (!refund) return NextResponse.json({ error: "Refund not found" }, { status: 404 });

    const result = await settleCodRefundAsStoreCredit({
      refundRequestId: id,
      actor: { type: "ADMIN", id: shop.id },
    });

    return NextResponse.json(safeSettlementResponse(result));
  } catch (error) {
    if (error instanceof ShopResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to settle COD refund as Megaska Store Credit";
    if (message === "Refund request not found") return NextResponse.json({ error: "Refund not found" }, { status: 404 });
    if (isValidationError(error)) return NextResponse.json({ error: message }, { status: 400 });

    console.error("[STORE CREDIT] settlement_failed", { error: message });
    return NextResponse.json({ error: "Failed to settle COD refund as Megaska Store Credit" }, { status: 500 });
  }
}
