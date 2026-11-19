import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../services/shopify/admin-auth";
import { arrangeReversePickupForOrder } from "../../../../services/exchange/manual-reverse-pickup";
import { isManualPickupReason } from "../../../../services/exchange/manual-reverse-pickup-rules";
import { addressFromBody, manualPickupErrorResponse, noteFromBody } from "../../../../services/exchange/manual-reverse-pickup-http";

export const runtime = "nodejs";

// Arranges a reverse pickup for any order: on its open issue request, or a new
// issue created by the team. Body: { orderNumber, lines: [{ shopifyLineItemId,
// quantity }], reason, note?, fee: { mode: "WAIVE" } | { mode: "PAYMENT_ID",
// paymentId }, address?, allowOutsideWindow?, outsideWindowNote? }.
export async function POST(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    if (!isManualPickupReason(body.reason)) return NextResponse.json({ error: "Choose a reason." }, { status: 400 });

    const feeRaw = (body.fee && typeof body.fee === "object" ? body.fee : {}) as Record<string, unknown>;
    const fee = feeRaw.mode === "PAYMENT_ID" ? { mode: "PAYMENT_ID" as const, paymentId: noteFromBody(feeRaw.paymentId, 60) } : { mode: "WAIVE" as const };
    const lines = Array.isArray(body.lines)
      ? body.lines.slice(0, 50).map((line) => ({ shopifyLineItemId: String((line as Record<string, unknown>)?.shopifyLineItemId ?? ""), quantity: Number((line as Record<string, unknown>)?.quantity ?? 0) }))
      : [];

    const result = await arrangeReversePickupForOrder({
      shopId: shop.id,
      orderNumber: noteFromBody(body.orderNumber, 40),
      lines,
      reason: body.reason,
      note: noteFromBody(body.note),
      fee,
      address: addressFromBody(body.address),
      allowOutsideWindow: body.allowOutsideWindow === true,
      outsideWindowNote: noteFromBody(body.outsideWindowNote),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return manualPickupErrorResponse(error, "arrange");
  }
}
