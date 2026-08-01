import { prisma } from "../db/prisma";
import type { ExpressCheckoutIntentStatus } from "../../generated/prisma";
import { comparison, type AnalyticsRange } from "../reviews/review-analytics-date-range";
import { IDLE_ABANDON_MS } from "./checkout-funnel";

function serializeRange(r: AnalyticsRange) {
  return { start: r.start.toISOString(), end: r.end.toISOString(), timezone: r.timezone, label: r.label };
}

// Non-completed, non-expired, idle-past-threshold intents are "abandoned".
function abandonedWhere(shopId: string, r: { start: Date; end: Date }, idleBefore: Date) {
  return {
    shopId,
    createdAt: { gte: r.start, lte: r.end },
    updatedAt: { lt: idleBefore },
    completedAt: null,
    orderLink: { is: null },
    status: { notIn: ["ORDER_COMPLETED", "ORDER_CREATED", "EXPIRED", "CANCELLED"] as ExpressCheckoutIntentStatus[] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(0) } }],
  };
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 4) return "••••";
  return "••••••" + digits.slice(-4);
}

function lineCount(cartSnapshot: unknown): number {
  if (!cartSnapshot || typeof cartSnapshot !== "object") return 0;
  const snap = cartSnapshot as Record<string, unknown>;
  const items = (Array.isArray(snap.lineItems) && snap.lineItems)
    || (Array.isArray(snap.items) && snap.items)
    || (Array.isArray(snap.lines) && snap.lines)
    || [];
  return (items as unknown[]).reduce((sum: number, item) => {
    const qty = item && typeof item === "object" ? Number((item as Record<string, unknown>).quantity) : NaN;
    return sum + (Number.isFinite(qty) ? qty : 1);
  }, 0);
}

type RecoveryTokenRow = { status: string; clickedAt: Date | null; usedAt: Date | null; createdAt: Date };

function recoveryState(tokens: RecoveryTokenRow[]): {
  status: "none" | "sent" | "clicked" | "used";
  sentAt: string | null;
  clickedAt: string | null;
} {
  if (!tokens.length) return { status: "none", sentAt: null, clickedAt: null };
  const sorted = [...tokens].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const used = sorted.find((t) => t.usedAt || t.status === "USED");
  const clicked = sorted.find((t) => t.clickedAt);
  const latest = sorted[0];
  return {
    status: used ? "used" : clicked ? "clicked" : "sent",
    sentAt: latest.createdAt.toISOString(),
    clickedAt: clicked?.clickedAt ? clicked.clickedAt.toISOString() : null,
  };
}

/**
 * The abandoned-cart list Shopify can't produce — express-checkout intents that
 * stalled before an order, with the shopper's (masked) mobile, cart value,
 * furthest step, and recovery status.
 */
export async function getAbandonedCarts(shopId: string, r: AnalyticsRange, limit = 100) {
  const idleBefore = new Date(Date.now() - IDLE_ABANDON_MS);
  const where = abandonedWhere(shopId, { start: r.start, end: r.end }, idleBefore);

  const [rows, summary] = await Promise.all([
    prisma.expressCheckoutIntent.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(500, Math.max(1, limit)),
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        totalAmountPaise: true,
        currency: true,
        selectedPaymentMethod: true,
        status: true,
        phoneSnapshot: true,
        cartSnapshot: true,
        addressSnapshots: { select: { id: true }, take: 1 },
        payments: { select: { id: true }, take: 1 },
        recoveryTokens: { select: { status: true, clickedAt: true, usedAt: true, createdAt: true } },
      },
    }),
    prisma.expressCheckoutIntent.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalAmountPaise: true },
    }),
  ]);

  const carts = rows.map((intent) => {
    const furthestStep = intent.selectedPaymentMethod
      ? "Payment selected"
      : intent.addressSnapshots.length
        ? "Address completed"
        : "Checkout started";
    return {
      id: intent.id,
      startedAt: intent.createdAt.toISOString(),
      lastActivityAt: intent.updatedAt.toISOString(),
      valuePaise: intent.totalAmountPaise,
      currency: intent.currency,
      lineCount: lineCount(intent.cartSnapshot),
      paymentMethod: intent.selectedPaymentMethod,
      furthestStep,
      mobileMasked: maskPhone(intent.phoneSnapshot),
      recoverable: Boolean(intent.phoneSnapshot),
      recovery: recoveryState(intent.recoveryTokens as RecoveryTokenRow[]),
    };
  });

  return {
    range: serializeRange(r),
    summary: {
      abandonedCount: summary._count._all,
      valueAtRiskPaise: summary._sum.totalAmountPaise ?? 0,
      recoverableCount: carts.filter((c) => c.recoverable).length,
    },
    idleThresholdMinutes: Math.round(IDLE_ABANDON_MS / 60000),
    carts,
  };
}

/**
 * Recovery outcomes for the period: how many abandoned carts were sent a
 * recovery message, clicked it, and completed afterwards (attributed recovery).
 */
export async function getRecoverySummary(shopId: string, r: AnalyticsRange) {
  const current = async (start: Date, end: Date) => {
    const [tokensSent, tokensClicked, recovered] = await Promise.all([
      prisma.checkoutRecoveryToken.count({ where: { shopId, createdAt: { gte: start, lte: end } } }),
      prisma.checkoutRecoveryToken.count({ where: { shopId, createdAt: { gte: start, lte: end }, clickedAt: { not: null } } }),
      prisma.checkoutRecoveryToken.count({
        where: {
          shopId,
          createdAt: { gte: start, lte: end },
          OR: [{ usedAt: { not: null } }, { status: "USED" }],
        },
      }),
    ]);
    return { tokensSent, tokensClicked, recovered };
  };

  const [now, prev] = await Promise.all([
    current(r.start, r.end),
    current(r.comparisonStart, r.comparisonEnd),
  ]);

  return {
    range: serializeRange(r),
    metrics: {
      recoveryMessagesSent: comparison(now.tokensSent, prev.tokensSent),
      recoveryClicks: comparison(now.tokensClicked, prev.tokensClicked),
      cartsRecovered: comparison(now.recovered, prev.recovered),
      clickThroughRate: comparison(
        now.tokensSent ? now.tokensClicked / now.tokensSent : 0,
        prev.tokensSent ? prev.tokensClicked / prev.tokensSent : 0,
      ),
      recoveryRate: comparison(
        now.tokensSent ? now.recovered / now.tokensSent : 0,
        prev.tokensSent ? prev.recovered / prev.tokensSent : 0,
      ),
    },
  };
}
