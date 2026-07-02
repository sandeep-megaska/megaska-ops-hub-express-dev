import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { getAuthenticatedExchangeCustomer } from "../../../../services/exchange/auth";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";
import { auditCodAdvance, calculateEligibility, getLatestCodAdvanceSettings } from "../../../../services/cod-advance/core";

export const runtime = "nodejs";

async function optionalAuth(req: NextRequest) { try { return await getAuthenticatedExchangeCustomer(req); } catch { return null; } }
async function resolveShop(req: NextRequest) { const auth = await optionalAuth(req); if (auth) return { shop: auth.shop, customerProfileId: auth.session.customer.id }; const s = await resolveShopConfig(getShopDomainFromRequest(req)); return { shop: { id: s.id, shopDomain: s.shopDomain }, customerProfileId: null }; }

export async function GET(req: NextRequest) {
  const { shop } = await resolveShop(req);
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const amount = Number(req.nextUrl.searchParams.get("orderAmountPaise") || Math.round(Number(req.nextUrl.searchParams.get("orderAmountRupees") || 0) * 100));
  const settings = await getLatestCodAdvanceSettings(shop.id);
  if (!settings) return NextResponse.json({ ok: true, enabled: false, eligibility: { eligible: false, reasons: ["settings_missing"] }, advanceAmount: 0, codBalanceAmount: amount || 0, policyText: null });
  return NextResponse.json({ ok: true, ...calculateEligibility(settings, amount || 0) });
}

export async function POST(req: NextRequest) {
  const { shop, customerProfileId } = await resolveShop(req);
  if (!shop.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const orderAmountPaise = Number(body?.orderAmountPaise ?? Math.round(Number(body?.orderAmountRupees || 0) * 100));
  if (!Number.isInteger(orderAmountPaise) || orderAmountPaise <= 0) return NextResponse.json({ ok: false, error: "orderAmountPaise must be a positive integer" }, { status: 400 });
  const settings = await getLatestCodAdvanceSettings(shop.id);
  if (!settings) return NextResponse.json({ ok: false, error: "Fixed COD Advance settings are not configured" }, { status: 400 });
  const quote = calculateEligibility(settings, orderAmountPaise);
  if (!quote.eligibility.eligible) return NextResponse.json({ ok: false, error: "Order is not eligible for Fixed COD Advance", quote }, { status: 400 });
  const intent = await (prisma as any).codAdvanceIntent.create({ data: { shopId: shop.id, customerProfileId, cartReference: String(body?.cartReference || "").trim() || null, checkoutReference: String(body?.checkoutReference || "").trim() || null, orderAmountPaise, advanceAmountPaise: quote.advanceAmount, codBalanceAmountPaise: quote.codBalanceAmount, currency: quote.currency, metadata: (body?.metadata as never) ?? undefined } });
  await auditCodAdvance("cod_advance.intent.created", "CodAdvanceIntent", intent.id, { shopId: shop.id, orderAmountPaise });
  return NextResponse.json({ ok: true, intent, noteAttributes: { megaska_cod_advance_intent_id: intent.id, megaska_cod_advance_paid: "true" } }, { status: 201 });
}
