import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { prisma } from "../../../../../services/db/prisma";
import { hashSessionToken } from "../../../../../services/auth/session";
import { requireShopFromRequest } from "../../../../../services/shopify/shop";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

function getSessionToken(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

export async function GET(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);
    const token = getSessionToken(req);
    if (!token) return withCors(req, NextResponse.json({ error: "Session token required" }, { status: 401 }));

    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash: hashSessionToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    });

    if (!session) return withCors(req, NextResponse.json({ error: "Invalid or expired session" }, { status: 401 }));

    const orders = await prisma.megaskaOrder.findMany({
      where: { customerProfileId: session.customer.id, shopId: shop.id },
      include: { shipments: { include: { events: { orderBy: { occurredAt: "desc" }, take: 20 } } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const responseOrders = orders.map((order) => {
      const shipments = order.shipments.map((shipment) => ({
        ...shipment,
        isMock: Boolean((shipment.metadata as { mock?: boolean } | null)?.mock),
        events: shipment.events.map((event) => ({
          ...event,
          isMock: Boolean((event.metadata as { mock?: boolean } | null)?.mock),
        })),
      }));

      const hasShipmentWithAwb = shipments.some((shipment) => Boolean(String(shipment.awb || "").trim()));

      return {
        ...order,
        shipments,
        hasTracking: hasShipmentWithAwb,
        fallback: {
          title: "Order confirmed",
          message: "Tracking will appear once your order is shipped.",
        },
      };
    });

    return withCors(req, NextResponse.json({ orders: responseOrders }));
  } catch (error) {
    return withCors(req, NextResponse.json({ error: error instanceof Error ? error.message : "Internal error" }, { status: 500 }));
  }
}
