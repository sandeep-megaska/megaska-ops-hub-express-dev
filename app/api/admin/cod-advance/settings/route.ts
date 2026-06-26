import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../../services/shopify/shop";
import { auditCodAdvance, DEFAULT_COD_ADVANCE_AMOUNT_PAISE, rupeesToPaise } from "../../../../../services/cod-advance/core";

export const runtime = "nodejs";

async function shop(req: NextRequest) {
  return resolveShopConfig(getShopDomainFromRequest(req));
}

export async function GET(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const settings = await (prisma as any).codAdvanceSettings.findFirst({ where: { shopId: resolved.id }, orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ ok: true, settings: settings ?? { enabled: false, fixedAdvanceAmountPaise: DEFAULT_COD_ADVANCE_AMOUNT_PAISE, currency: "INR", minOrderAmountPaise: null, maxOrderAmountPaise: null, policyText: null }, shopDomain: resolved.shopDomain });
}

export async function POST(req: NextRequest) {
  const resolved = await shop(req);
  if (!resolved.id) return NextResponse.json({ ok: false, error: "Unable to resolve shop" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  const fixed = rupeesToPaise(body.fixedAdvanceAmountRupees ?? (Number(body.fixedAdvanceAmountPaise) / 100));
  const min = body.minOrderAmountRupees === "" || body.minOrderAmountRupees == null ? null : rupeesToPaise(body.minOrderAmountRupees);
  const max = body.maxOrderAmountRupees === "" || body.maxOrderAmountRupees == null ? null : rupeesToPaise(body.maxOrderAmountRupees);
  if (!fixed || fixed <= 0) return NextResponse.json({ ok: false, error: "Fixed advance amount must be greater than zero" }, { status: 400 });
  if (min !== null && max !== null && min > max) return NextResponse.json({ ok: false, error: "Minimum order value cannot exceed maximum order value" }, { status: 400 });
  const existing = await (prisma as any).codAdvanceSettings.findFirst({ where: { shopId: resolved.id }, orderBy: { updatedAt: "desc" } });
  const data = { shopId: resolved.id, enabled: Boolean(body.enabled), fixedAdvanceAmountPaise: fixed, currency: String(body.currency || "INR").trim() || "INR", minOrderAmountPaise: min, maxOrderAmountPaise: max, policyText: String(body.policyText || "").trim() || null };
  const settings = existing ? await (prisma as any).codAdvanceSettings.update({ where: { id: existing.id }, data }) : await (prisma as any).codAdvanceSettings.create({ data });
  await auditCodAdvance("cod_advance.settings.updated", "CodAdvanceSettings", settings.id, { shopId: resolved.id });
  return NextResponse.json({ ok: true, settings });
}
