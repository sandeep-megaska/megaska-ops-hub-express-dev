import { prisma } from "../db/prisma";

export const DEFAULT_COD_ADVANCE_AMOUNT_PAISE = 12000;

export function rupeesToPaise(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export async function auditCodAdvance(eventType: string, entityType: string, entityId: string | null, payload?: unknown) {
  await prisma.auditEvent.create({
    data: { actorType: "system", eventType, entityType, entityId, payload: payload as never },
  });
}

export async function getLatestCodAdvanceSettings(shopId: string) {
  return (prisma as any).codAdvanceSettings.findFirst({ where: { shopId }, orderBy: { updatedAt: "desc" } });
}

export function calculateEligibility(settings: { enabled: boolean; fixedAdvanceAmountPaise: number; minOrderAmountPaise: number | null; maxOrderAmountPaise: number | null; policyText: string | null; currency: string }, orderAmountPaise: number) {
  const reasons: string[] = [];
  if (!settings.enabled) reasons.push("disabled");
  if (settings.minOrderAmountPaise !== null && orderAmountPaise < settings.minOrderAmountPaise) reasons.push("below_min_order_amount");
  if (settings.maxOrderAmountPaise !== null && orderAmountPaise > settings.maxOrderAmountPaise) reasons.push("above_max_order_amount");
  if (settings.fixedAdvanceAmountPaise > orderAmountPaise) reasons.push("advance_exceeds_order_amount");
  const eligible = reasons.length === 0;
  return {
    enabled: settings.enabled,
    eligibility: { eligible, reasons },
    advanceAmount: eligible ? settings.fixedAdvanceAmountPaise : 0,
    codBalanceAmount: eligible ? orderAmountPaise - settings.fixedAdvanceAmountPaise : orderAmountPaise,
    policyText: settings.policyText,
    currency: settings.currency || "INR",
  };
}
