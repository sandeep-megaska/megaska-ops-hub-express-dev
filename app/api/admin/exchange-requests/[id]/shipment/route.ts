import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import {
  requireShopFromRequest,
  ShopResolutionError,
} from "../../../../../../services/shopify/shop";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

function parseDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shop = await requireShopFromRequest(req);
    const { id } = await context.params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const direction = String(body?.direction || "").trim();
    const status = String(body?.status || "").trim() || "PENDING";
    const pickupAt = parseDate(body?.pickupAt);
    const shippedAt = parseDate(body?.shippedAt);
    const deliveredAt = parseDate(body?.deliveredAt);

    if (!direction) {
      return NextResponse.json(
        { error: "direction is required" },
        { status: 400 }
      );
    }

    if (
      pickupAt === undefined ||
      shippedAt === undefined ||
      deliveredAt === undefined
    ) {
      return NextResponse.json(
        { error: "Invalid shipment date format" },
        { status: 400 }
      );
    }

    const existing = await prisma.orderActionRequest.findFirst({
      where: {
        id,
        shopId: shop.id,
        requestType: "EXCHANGE",
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const dateFields = {
      pickupAt,
      shippedAt,
      deliveredAt,
    } as Record<string, Date | null>;

    const shipment = await prisma.shipmentTracking.upsert({
      where: {
        requestId_direction: {
          requestId: existing.id,
          direction: direction as never,
        },
      },
      create: {
        requestId: existing.id,
        direction: direction as never,
        carrier: String(body?.carrier || "").trim() || null,
        awb: String(body?.awb || "").trim() || null,
        trackingUrl: String(body?.trackingUrl || "").trim() || null,
        status: status as never,
        remarks: String(body?.remarks || "").trim() || null,
        ...dateFields,
      },
      update: {
        carrier: String(body?.carrier || "").trim() || null,
        awb: String(body?.awb || "").trim() || null,
        trackingUrl: String(body?.trackingUrl || "").trim() || null,
        status: status as never,
        remarks: String(body?.remarks || "").trim() || null,
        ...dateFields,
      },
    });

    return NextResponse.json({ shipment });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status }
    );
  }
}
