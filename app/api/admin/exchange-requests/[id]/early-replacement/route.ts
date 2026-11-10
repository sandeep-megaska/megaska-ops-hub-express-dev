import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { EARLY_REPLACEMENT_MIN_REASON, earlyReplacementEligibility } from "../../../../../../services/exchange/early-replacement";
import { notifyExchangeMilestone } from "../../../../../../services/notifications/exchange-milestones";

// Clears the replacement to ship before the returned item arrives (the courier is slow
// with a return it has already picked up). Moves the exchange to "replacement
// processing" so "Create replacement shipment" works, and keeps the reason.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim().replace(/\s+/g, " ").slice(0, 500) : "";
    if (reason.length < EARLY_REPLACEMENT_MIN_REASON) return NextResponse.json({ error: "Write why the replacement is going out before the return arrives." }, { status: 400 });

    const request = await prisma.orderActionRequest.findFirst({ where: { id, shopId: shop.id, requestType: "EXCHANGE" }, include: { shipments: true } });
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const reverse = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") ?? null;
    const forward = request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT") ?? null;
    const eligibility = earlyReplacementEligibility({ status: request.status, earlyReplacementAt: request.earlyReplacementAt, reverseShipment: reverse, forwardAwb: forward?.awb });
    if (!eligibility.ok) return NextResponse.json({ error: eligibility.reason }, { status: 400 });

    // Conditional update: a concurrent status change (or a second click) can't double-apply.
    const updated = await prisma.orderActionRequest.updateMany({
      where: { id: request.id, status: request.status, earlyReplacementAt: null },
      data: { status: "REPLACEMENT_PROCESSING", earlyReplacementAt: new Date(), earlyReplacementReason: reason },
    });
    if (!updated.count) return NextResponse.json({ error: "The exchange changed meanwhile. Refresh and try again." }, { status: 409 });

    await prisma.auditEvent.create({
      data: {
        actorType: "admin",
        eventType: "exchange.early_replacement.approved",
        entityType: "OrderActionRequest",
        entityId: request.id,
        payload: { shopId: shop.id, fromStatus: request.status, reason, reverseAwb: reverse?.awb ?? null, reverseStatus: reverse?.status ?? null } as never,
      },
    });
    await notifyExchangeMilestone(request.id, "REPLACEMENT_PROCESSING");
    return NextResponse.json({ ok: true, status: "REPLACEMENT_PROCESSING" });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the exchange." }, { status });
  }
}
