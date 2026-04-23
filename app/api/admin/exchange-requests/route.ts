import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import {
  requireShopFromRequest,
  ShopResolutionError,
} from "../../../../services/shopify/shop";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

function parseDateStart(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function parseDateEnd(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shop = await requireShopFromRequest(req);

    const status = req.nextUrl.searchParams.get("status")?.trim();
    const orderNumber = req.nextUrl.searchParams.get("orderNumber")?.trim();
    const customerPhone = req.nextUrl.searchParams.get("customerPhone")?.trim();
    const customerName = req.nextUrl.searchParams.get("customerName")?.trim();
    const startDate = parseDateStart(req.nextUrl.searchParams.get("startDate"));
    const endDate = parseDateEnd(req.nextUrl.searchParams.get("endDate"));

    const data = await prisma.orderActionRequest.findMany({
      where: {
        shopId: shop.id,
        requestType: "EXCHANGE",
        ...(status ? { status: status as never } : {}),
        ...(orderNumber
          ? { orderNumber: { contains: orderNumber, mode: "insensitive" } }
          : {}),
        ...(customerPhone
          ? {
              customerPhoneSnapshot: {
                contains: customerPhone,
                mode: "insensitive",
              },
            }
          : {}),
        ...(customerName
          ? {
              customerNameSnapshot: {
                contains: customerName,
                mode: "insensitive",
              },
            }
          : {}),
        ...(startDate || endDate
          ? {
              requestedAt: {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
              },
            }
          : {}),
      },
      include: {
        items: { take: 1 },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        shipments: true,
      },
      orderBy: { requestedAt: "desc" },
      take: 300,
    });

    return NextResponse.json({ requests: data });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status }
    );
  }
}
