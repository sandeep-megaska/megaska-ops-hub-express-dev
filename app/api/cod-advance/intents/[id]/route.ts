import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";
export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shop = await resolveShopConfig(getShopDomainFromRequest(req));
  const intent = await (prisma as any).codAdvanceIntent.findFirst({ where: { id, ...(shop.id ? { shopId: shop.id } : {}) } });
  if (!intent) return NextResponse.json({ ok: false, error: "Intent not found" }, { status: 404 });
  return NextResponse.json({ ok: true, intent });
}
