import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { requireShopFromRequest } from "../../../../../../services/shopify/shop";
import { ensureReversePickupInvoice, sendReversePickupInvoiceEmail } from "../../../../../../services/exchange/invoice";

function isAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key") || "";
  const expected = String(process.env.ADMIN_OPS_KEY || "").trim();
  return Boolean(expected && key === expected);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shop = await requireShopFromRequest(req);
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
}
