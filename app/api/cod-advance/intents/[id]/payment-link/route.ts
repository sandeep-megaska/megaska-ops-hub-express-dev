import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../../services/db/prisma";
import { createCodAdvancePaymentLink } from "../../../../../../services/cod-advance/razorpay";
import { auditCodAdvance } from "../../../../../../services/cod-advance/core";
export const runtime = "nodejs";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intent = await (prisma as any).codAdvanceIntent.findUnique({ where: { id }, include: { customerProfile: true } });
  if (!intent) return NextResponse.json({ ok: false, error: "Intent not found" }, { status: 404 });
  if (intent.advanceAmountPaise > intent.orderAmountPaise) return NextResponse.json({ ok: false, error: "Advance amount cannot exceed order amount" }, { status: 400 });
  if (intent.razorpayPaymentLinkId && intent.razorpayPaymentLinkUrl && ["CREATED", "PAYMENT_PENDING"].includes(intent.status)) return NextResponse.json({ ok: true, intent, idempotent: true });
  if (["ADVANCE_PAID", "ORDER_LINKED"].includes(intent.status)) return NextResponse.json({ ok: true, intent, idempotent: true });
  const link = await createCodAdvancePaymentLink({ intentId: intent.id, amountPaise: intent.advanceAmountPaise, currency: intent.currency, customerName: intent.customerProfile?.fullName, customerEmail: intent.customerProfile?.email, customerPhone: intent.customerProfile?.phoneE164 });
  const updated = await (prisma as any).codAdvanceIntent.update({ where: { id }, data: { status: "PAYMENT_PENDING", razorpayPaymentLinkId: link.id, razorpayPaymentLinkUrl: link.shortUrl, providerReferenceId: link.referenceId, expiresAt: link.expiresAt } });
  await auditCodAdvance("cod_advance.payment_link.created", "CodAdvanceIntent", id, { paymentLinkId: link.id });
  return NextResponse.json({ ok: true, intent: updated });
}
