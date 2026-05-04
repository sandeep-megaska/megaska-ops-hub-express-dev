import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { prisma } from "../../../../../../services/db/prisma";
import { getAuthenticatedExchangeCustomer } from "../../../../../../services/exchange/auth";

export async function OPTIONS(req: NextRequest) { return handleOptions(req); }

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedExchangeCustomer(req);
  if (!auth) return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  const { id } = await context.params;

  const request = await prisma.orderActionRequest.findFirst({ where: { id, shopId: auth.shop.id, customerProfileId: auth.session.customer.id, requestType: "EXCHANGE" } });
  if (!request) return withCors(req, NextResponse.json({ error: "Not found" }, { status: 404 }));

  const invoice = await prisma.exchangePaymentInvoice.findFirst({ where: { requestId: id }, orderBy: { createdAt: "desc" } });
  if (!invoice) return withCors(req, NextResponse.json({ message: "Invoice will be available after payment confirmation." }, { status: 404 }));

  return withCors(req, NextResponse.json({ invoice }));
}
