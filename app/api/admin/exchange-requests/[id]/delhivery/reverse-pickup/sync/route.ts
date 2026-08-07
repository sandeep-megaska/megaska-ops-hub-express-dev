import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../../../services/db/prisma";
import { syncExchangeShipment } from "../../../../../../../../services/exchange/tracking-sync";
import { DelhiveryTrackingError } from "../../../../../../../../services/logistics/delhivery-adapter";
import { ShopResolutionError } from "../../../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../../../services/shopify/admin-auth";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const request = await prisma.orderActionRequest.findFirst({
      where: { id, shopId: shop.id, requestType: "EXCHANGE" },
      include: { shipments: true },
    });

    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const reverseShipment =
      request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP" && shipment.carrier === "DELHIVERY") || null;
    if (!reverseShipment?.awb) {
      return NextResponse.json({ error: "Delhivery reverse pickup AWB is required before syncing tracking." }, { status: 400 });
    }

    const sync = await syncExchangeShipment(
      { id: request.id, status: request.status, shopId: request.shopId },
      reverseShipment,
      { actorType: "admin" },
    );

    const updatedRequest = await prisma.orderActionRequest.findFirst({
      where: { id: request.id },
      include: { items: true, payments: true, shipments: true },
    });

    return NextResponse.json({ request: updatedRequest, shipment: sync.shipment, tracking: sync.tracking });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : error instanceof DelhiveryTrackingError ? error.statusCode : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to sync Delhivery reverse pickup tracking." }, { status });
  }
}
