import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { settleExchangeFeeAndBookPickup } from "../../../../../../services/exchange/manual-reverse-pickup";
import { addressFromBody, manualPickupErrorResponse, noteFromBody } from "../../../../../../services/exchange/manual-reverse-pickup-http";

export const runtime = "nodejs";

// Records an exchange's reverse-pickup fee that was paid outside loopd2c's link
// (a Razorpay payment ID the team pastes, verified with Razorpay) or waives it,
// then books the Delhivery reverse pickup.
// Body: { mode: "PAYMENT_ID", paymentId } | { mode: "WAIVE", note },
//       plus optional address, allowOutsideWindow, outsideWindowNote.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });

    const mode = body.mode === "WAIVE" ? "WAIVE" : body.mode === "PAYMENT_ID" ? "PAYMENT_ID" : null;
    if (!mode) return NextResponse.json({ error: "mode must be PAYMENT_ID or WAIVE" }, { status: 400 });

    const result = await settleExchangeFeeAndBookPickup({
      shopId: shop.id,
      requestId: id,
      fee: mode === "PAYMENT_ID" ? { mode, paymentId: noteFromBody(body.paymentId, 60) } : { mode, note: noteFromBody(body.note) },
      address: addressFromBody(body.address),
      allowOutsideWindow: body.allowOutsideWindow === true,
      outsideWindowNote: noteFromBody(body.outsideWindowNote),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return manualPickupErrorResponse(error, "exchange fee");
  }
}
