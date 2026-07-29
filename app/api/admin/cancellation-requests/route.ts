import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { deriveCancellationOutcome } from "../../../../services/exchange/cancellation";
import { ShopResolutionError } from "../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../services/shopify/admin-auth";

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
    const shop = await requireAdminShopFromRequest(req);

    const status = req.nextUrl.searchParams.get("status")?.trim();
    const orderNumber = req.nextUrl.searchParams.get("orderNumber")?.trim();
    const customerPhone = req.nextUrl.searchParams.get("customerPhone")?.trim();
    const customerName = req.nextUrl.searchParams.get("customerName")?.trim();
    const startDate = parseDateStart(req.nextUrl.searchParams.get("startDate"));
    const endDate = parseDateEnd(req.nextUrl.searchParams.get("endDate"));

    const data = await prisma.orderActionRequest.findMany({
      where: {
        requestType: "CANCELLATION",
        shopId: shop.id,
        ...(status ? { status: status as never } : {}),
        ...(orderNumber ? { orderNumber: { contains: orderNumber, mode: "insensitive" } } : {}),
        ...(customerPhone
          ? { customerPhoneSnapshot: { contains: customerPhone, mode: "insensitive" } }
          : {}),
        ...(customerName ? { customerNameSnapshot: { contains: customerName, mode: "insensitive" } } : {}),
        ...((startDate || endDate)
          ? {
              requestedAt: {
                ...(startDate ? { gte: startDate } : {}),
                ...(endDate ? { lte: endDate } : {}),
              },
            }
          : {}),
      },
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        shipments: true,
      },
      orderBy: { requestedAt: "desc" },
      take: 300,
    });

    const refundRequests = data.length
      ? await (prisma as any).refundRequest.findMany({
          where: { orderActionRequestId: { in: data.map((request) => request.id) } },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    const refundsByRequestId = new Map<string, any[]>();
    for (const refund of refundRequests) {
      const key = String(refund.orderActionRequestId || "");
      if (!refundsByRequestId.has(key)) refundsByRequestId.set(key, []);
      refundsByRequestId.get(key)?.push(refund);
    }

    return NextResponse.json({
      requests: data.map((request) => ({
        ...request,
        cancellationOutcome: deriveCancellationOutcome({
          cancellationStatus: request.status,
          orderAmountSnapshot: request.orderAmountSnapshot,
          refundRequests: refundsByRequestId.get(request.id) || [],
        }),
      })),
    });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
