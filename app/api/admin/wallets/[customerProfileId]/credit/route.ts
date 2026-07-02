import { NextRequest, NextResponse } from "next/server";
import { applyWalletTransaction, parseAmountToMinorUnits } from "../../../../../../services/wallet";
import { notifyManualStoreCreditApplied } from "../../../../../../services/notifications/store-credit";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

export async function POST(req: NextRequest, context: { params: Promise<{ customerProfileId: string }> }) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { customerProfileId } = await context.params;
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

    notifyManualStoreCreditApplied({
      walletTransactionId: result.transaction.id,
      transactionType: result.transaction.transactionType,
    });

    return NextResponse.json({ wallet: result.account, transaction: result.transaction });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
