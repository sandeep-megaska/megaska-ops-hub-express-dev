import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../../services/shopify/admin-auth";
import { ensureReversePickupInvoice, sendReversePickupInvoiceEmail } from "../../../../../../services/exchange/invoice";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "generate");

    const payment = await prisma.requestPayment.findFirst({
      where: { requestId: id, purpose: "REVERSE_PICKUP_FEE", request: { shopId: shop.id, requestType: "EXCHANGE" } },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) return NextResponse.json({ error: "Reverse pickup payment not found" }, { status: 404 });
    if (payment.status !== "PAID") return NextResponse.json({ error: "Unpaid payment cannot generate invoice" }, { status: 400 });

    const invoice = action === "send" ? await sendReversePickupInvoiceEmail(payment.id) : await ensureReversePickupInvoice(payment.id);
    return NextResponse.json({ invoice });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
