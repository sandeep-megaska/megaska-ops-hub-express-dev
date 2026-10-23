import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getAuthenticatedExchangeCustomer } from "../../../../../services/exchange/auth";
export const runtime = "nodejs";
// Only the signed-in customer who created the intent can read it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthenticatedExchangeCustomer(req);
  if (!auth?.shop.id || !auth.session.customer.id) return NextResponse.json({ ok: false, error: "Invalid or expired session" }, { status: 401 });
  const intent = await (prisma as any).codAdvanceIntent.findFirst({ where: { id, shopId: auth.shop.id, customerProfileId: auth.session.customer.id } });
  if (!intent) return NextResponse.json({ ok: false, error: "Intent not found" }, { status: 404 });
  return NextResponse.json({ ok: true, intent });
}
