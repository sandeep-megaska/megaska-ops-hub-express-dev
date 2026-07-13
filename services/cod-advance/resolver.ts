/* eslint-disable @typescript-eslint/no-explicit-any */
import type { prisma } from "../db/prisma";
import { calculateCodAdvancePolicy } from "./policy";
import { createCodAdvancePricingFingerprint } from "./fingerprint";

type ResolverDb = typeof prisma;

type ResolveInput = {
  shopId: string;
  shopDomain: string;
  checkoutIntentId: string;
  customerProfileId: string;
};

export type CodPolicyDto = {
  available: boolean;
  eligible: boolean;
  requiresAdvance: boolean;
  reasons: string[];
  paymentMode: "COD" | "PARTIAL_COD";
  orderTotalPaise: number;
  storeCreditAppliedPaise: number;
  customerCashLiabilityPaise: number;
  advanceAmountPaise: number;
  codBalanceAmountPaise: number;
  currency: string;
  customerTitle: string | null;
  customerMessage: string | null;
  policyText: string | null;
  codAdvanceIntentId: string | null;
  expiresAt: string | null;
};

export class CodPolicyResolverError extends Error {
  status: 404 | 409;
  constructor(status: 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function minDate(a: Date | null | undefined, b: Date) {
  return a && a < b ? a : b;
}

function isPaidOrLinked(intent: { status: string; paidAt?: Date | null; consumedAt?: Date | null; shopifyOrderId?: string | null; shopifyOrderName?: string | null }) {
  return Boolean(intent.paidAt || intent.consumedAt || intent.shopifyOrderId || intent.shopifyOrderName || ["ADVANCE_PAID", "ORDER_LINKED"].includes(intent.status));
}

async function readActiveWalletReservation(db: ResolverDb, input: { shopId: string; customerProfileId: string; checkoutReference: string; cartReference: string }, audit: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>) {
  const now = new Date();
  const or: Array<{ checkoutReference: string } | { cartReference: string }> = [];
  if (input.checkoutReference) or.push({ checkoutReference: input.checkoutReference });
  if (input.cartReference) or.push({ cartReference: input.cartReference });

  if (!or.length) return null;

  const reservations = await (db as any).walletReservation.findMany({
    where: { shopId: input.shopId, customerProfileId: input.customerProfileId, status: "ACTIVE", expiresAt: { gt: now }, OR: or },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, reservedAmount: true, currency: true, expiresAt: true, createdAt: true },
  });

  if (reservations.length > 1) {
    console.warn("[COD ADVANCE] ambiguous active wallet reservations", { shopId: input.shopId, customerProfileId: input.customerProfileId, checkoutReference: input.checkoutReference || null, cartReference: input.cartReference || null, selectedReservationId: reservations[0].id, activeReservationCount: reservations.length });
    await audit("cod_advance.wallet_reservation.ambiguous", "WalletReservation", reservations[0].id, { shopId: input.shopId, checkoutReference: input.checkoutReference || null, cartReference: input.cartReference || null, activeReservationCount: reservations.length }).catch(() => undefined);
  }

  return reservations[0] || null;
}

export type CodPolicyResolverDeps = {
  getLatestSettings?: (shopId: string) => Promise<any>;
  audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<unknown>;
};

export async function resolveExpressCheckoutCodPolicy(input: ResolveInput, db?: ResolverDb, deps: CodPolicyResolverDeps = {}): Promise<CodPolicyDto> {
  const [{ auditCodAdvance, getLatestCodAdvanceSettings }, defaultDb] = await Promise.all([import("./core"), db ? Promise.resolve(db) : import("../db/prisma").then((mod) => mod.prisma)]);
  db = defaultDb;
  const getSettings = deps.getLatestSettings || getLatestCodAdvanceSettings;
  const audit = deps.audit || auditCodAdvance;
  const now = new Date();
  const intent = await (db as any).expressCheckoutIntent.findFirst({
    where: { id: input.checkoutIntentId },
    select: { id: true, shopId: true, customerProfileId: true, status: true, cartToken: true, shopifyCartId: true, cartSnapshot: true, subtotalAmountPaise: true, discountAmountPaise: true, shippingAmountPaise: true, codFeeAmountPaise: true, totalAmountPaise: true, currency: true, selectedPaymentMethod: true, expiresAt: true },
  });

  if (!intent || intent.shopId !== input.shopId) throw new CodPolicyResolverError(404, "Intent not found");
  if (intent.customerProfileId !== input.customerProfileId) throw new CodPolicyResolverError(404, "Intent not found");
  if (intent.expiresAt && intent.expiresAt <= now) throw new CodPolicyResolverError(409, "Intent expired");
  if (["ORDER_CREATED", "ORDER_COMPLETED", "CANCELLED", "EXPIRED", "ABANDONED"].includes(intent.status)) throw new CodPolicyResolverError(409, "Intent cannot be used for COD policy");
  if (intent.selectedPaymentMethod === "PREPAID") throw new CodPolicyResolverError(409, "Intent selected payment method is PREPAID");

  const settings = await getSettings(input.shopId);
  if (!settings) throw new CodPolicyResolverError(409, "COD advance settings not configured");

  const walletReservation = await readActiveWalletReservation(db, { shopId: input.shopId, customerProfileId: input.customerProfileId, checkoutReference: intent.id, cartReference: intent.cartToken || intent.shopifyCartId || "" }, audit);
  const storeCreditAppliedPaise = Math.max(0, Math.min(Number(walletReservation?.reservedAmount || 0), intent.totalAmountPaise));
  const policy = calculateCodAdvancePolicy({
    enabled: Boolean(settings.enabled),
    advanceType: settings.advanceType,
    fixedAdvanceAmountPaise: settings.fixedAdvanceAmountPaise,
    percentageBasisPoints: settings.percentageBasisPoints,
    minimumAdvanceAmountPaise: settings.minimumAdvanceAmountPaise,
    maximumAdvanceAmountPaise: settings.maximumAdvanceAmountPaise,
    minOrderAmountPaise: settings.minOrderAmountPaise,
    maxOrderAmountPaise: settings.maxOrderAmountPaise,
    orderTotalPaise: intent.totalAmountPaise,
    storeCreditAppliedPaise,
  });

  const pricingFingerprint = createCodAdvancePricingFingerprint({
    shopId: input.shopId,
    expressCheckoutIntentId: intent.id,
    cartToken: intent.cartToken,
    shopifyCartId: intent.shopifyCartId,
    cartSnapshot: intent.cartSnapshot,
    subtotalAmountPaise: intent.subtotalAmountPaise,
    discountAmountPaise: intent.discountAmountPaise,
    shippingAmountPaise: intent.shippingAmountPaise,
    codFeeAmountPaise: intent.codFeeAmountPaise,
    totalAmountPaise: intent.totalAmountPaise,
    currency: intent.currency,
    storeCreditReservationId: walletReservation?.id || null,
    storeCreditReservedAmountPaise: storeCreditAppliedPaise,
    codSettingsId: settings.id,
    codSettingsVersion: settings.version,
    advanceType: settings.advanceType,
    fixedAdvanceAmountPaise: settings.fixedAdvanceAmountPaise,
    percentageBasisPoints: settings.percentageBasisPoints,
    minimumAdvanceAmountPaise: settings.minimumAdvanceAmountPaise,
    maximumAdvanceAmountPaise: settings.maximumAdvanceAmountPaise,
    minOrderAmountPaise: settings.minOrderAmountPaise,
    maxOrderAmountPaise: settings.maxOrderAmountPaise,
  });

  const expiresAt = minDate(intent.expiresAt, addMinutes(now, 15));
  const existing = await (db as any).codAdvanceIntent.findMany({
    where: { shopId: input.shopId, expressCheckoutIntentId: intent.id, customerProfileId: input.customerProfileId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const reusable = existing.find((candidate: any) => ["CREATED", "PAYMENT_PENDING"].includes(candidate.status) && !candidate.consumedAt && !candidate.paidAt && (!candidate.expiresAt || candidate.expiresAt > now) && candidate.pricingFingerprint === pricingFingerprint && candidate.settingsVersion === settings.version && candidate.advanceAmountPaise === policy.advanceAmountPaise && candidate.codBalanceAmountPaise === policy.codBalanceAmountPaise);

  let codAdvanceIntent = reusable || null;
  if (codAdvanceIntent) {
    await audit("cod_advance.intent.reused", "CodAdvanceIntent", codAdvanceIntent.id, { shopId: input.shopId, expressCheckoutIntentId: intent.id });
  } else {
    for (const stale of existing) {
      if (["CREATED", "PAYMENT_PENDING"].includes(stale.status) && !isPaidOrLinked(stale)) {
        const status = stale.expiresAt && stale.expiresAt <= now ? "EXPIRED" : "CANCELLED";
        await (db as any).codAdvanceIntent.updateMany({ where: { id: stale.id, shopId: input.shopId, status: stale.status, paidAt: null, consumedAt: null, shopifyOrderId: null, shopifyOrderName: null }, data: { status } });
        await audit("cod_advance.intent.stale_cancelled", "CodAdvanceIntent", stale.id, { shopId: input.shopId, expressCheckoutIntentId: intent.id, status });
      }
    }

    codAdvanceIntent = await (db as any).codAdvanceIntent.create({ data: { shopId: input.shopId, customerProfileId: input.customerProfileId, cartReference: intent.cartToken || intent.shopifyCartId || null, checkoutReference: intent.id, expressCheckoutIntentId: intent.id, settingsId: settings.id, settingsVersion: settings.version, advanceType: settings.advanceType, advanceValueSnapshot: settings.advanceType === "FIXED" ? settings.fixedAdvanceAmountPaise : settings.percentageBasisPoints, pricingFingerprint, cartFingerprint: intent.shopifyCartId || intent.cartToken || null, merchandiseAmountPaise: intent.subtotalAmountPaise, shopifyDiscountAmountPaise: intent.discountAmountPaise, shippingAmountPaise: intent.shippingAmountPaise, codFeeAmountPaise: intent.codFeeAmountPaise, storeCreditAppliedPaise, customerCashLiabilityPaise: policy.customerCashLiabilityPaise, orderAmountPaise: policy.orderTotalPaise, advanceAmountPaise: policy.advanceAmountPaise, codBalanceAmountPaise: policy.codBalanceAmountPaise, currency: intent.currency, expiresAt } });
    await audit("cod_advance.intent.created", "CodAdvanceIntent", codAdvanceIntent.id, { shopId: input.shopId, expressCheckoutIntentId: intent.id });
  }

  await audit("cod_advance.policy.resolved", "ExpressCheckoutIntent", intent.id, { shopId: input.shopId, codAdvanceIntentId: codAdvanceIntent.id, available: policy.available, eligible: policy.eligible, requiresAdvance: policy.requiresAdvance });

  return { available: policy.available, eligible: policy.eligible, requiresAdvance: policy.requiresAdvance, reasons: policy.reasons, paymentMode: policy.requiresAdvance ? "PARTIAL_COD" : "COD", orderTotalPaise: policy.orderTotalPaise, storeCreditAppliedPaise: policy.storeCreditAppliedPaise, customerCashLiabilityPaise: policy.customerCashLiabilityPaise, advanceAmountPaise: policy.advanceAmountPaise, codBalanceAmountPaise: policy.codBalanceAmountPaise, currency: intent.currency || settings.currency || "INR", customerTitle: settings.customerTitle, customerMessage: settings.customerMessage, policyText: settings.policyText, codAdvanceIntentId: codAdvanceIntent.id, expiresAt: codAdvanceIntent.expiresAt ? codAdvanceIntent.expiresAt.toISOString() : null };
}
