import { prisma } from "../db/prisma";
import type { ExpressCheckoutIntentStatus } from "../../generated/prisma";
import { comparison, type AnalyticsRange } from "../reviews/review-analytics-date-range";

// A shopper is treated as abandoned once idle past this window without an order.
export const IDLE_ABANDON_MS = 30 * 60 * 1000;

function serializeRange(r: AnalyticsRange) {
  return {
    start: r.start.toISOString(),
    end: r.end.toISOString(),
    comparisonStart: r.comparisonStart.toISOString(),
    comparisonEnd: r.comparisonEnd.toISOString(),
    timezone: r.timezone,
    label: r.label,
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

// COUNT(DISTINCT funnelSessionId) per event type in one query — the pre-intent
// funnel is session-based, so we count reach, not raw event volume.
async function distinctSessionsByEvent(shopId: string, start: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ eventType: string; sessions: bigint }>>`
    SELECT "eventType", COUNT(DISTINCT "funnelSessionId")::bigint AS sessions
    FROM "CheckoutFunnelEvent"
    WHERE "shopId" = ${shopId} AND "occurredAt" >= ${start} AND "occurredAt" <= ${end}
    GROUP BY "eventType"`;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.eventType, Number(row.sessions));
  return map;
}

async function distinctSessionsByExpressSource(shopId: string, start: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ source: string | null; sessions: bigint }>>`
    SELECT "source", COUNT(DISTINCT "funnelSessionId")::bigint AS sessions
    FROM "CheckoutFunnelEvent"
    WHERE "shopId" = ${shopId} AND "eventType" = 'EXPRESS_CLICK'
      AND "occurredAt" >= ${start} AND "occurredAt" <= ${end}
    GROUP BY "source"`;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.source ?? "UNKNOWN", Number(row.sessions));
  return map;
}

// Device split measured at the express-checkout-click stage (the point where the
// shopper has committed intent), so it reflects who is actually converting.
async function distinctSessionsByDevice(shopId: string, start: Date, end: Date) {
  const rows = await prisma.$queryRaw<Array<{ device: string; sessions: bigint }>>`
    SELECT "device", COUNT(DISTINCT "funnelSessionId")::bigint AS sessions
    FROM "CheckoutFunnelEvent"
    WHERE "shopId" = ${shopId} AND "eventType" = 'EXPRESS_CLICK'
      AND "occurredAt" >= ${start} AND "occurredAt" <= ${end}
    GROUP BY "device"`;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.device, Number(row.sessions));
  return map;
}

const intentInRange = (shopId: string, r: { start: Date; end: Date }) => ({
  shopId,
  createdAt: { gte: r.start, lte: r.end },
});

// Completion is derived from durable signals (a linked Shopify order or an
// explicit completedAt) rather than the drifting intermediate status vocabulary.
const COMPLETED_WHERE = {
  OR: [
    { completedAt: { not: null } },
    { orderLink: { is: { shopifyOrderId: { not: null } } } },
    { status: { in: ["ORDER_COMPLETED", "ORDER_CREATED"] as ExpressCheckoutIntentStatus[] } },
  ],
};

async function intentStageCounts(shopId: string, r: { start: Date; end: Date }) {
  const [created, withAddress, withPayment, paymentPending, completed] = await Promise.all([
    prisma.expressCheckoutIntent.count({ where: intentInRange(shopId, r) }),
    prisma.expressCheckoutIntent.count({ where: { ...intentInRange(shopId, r), addressSnapshots: { some: {} } } }),
    prisma.expressCheckoutIntent.count({ where: { ...intentInRange(shopId, r), selectedPaymentMethod: { not: null } } }),
    prisma.expressCheckoutIntent.count({ where: { ...intentInRange(shopId, r), payments: { some: {} } } }),
    prisma.expressCheckoutIntent.count({ where: { ...intentInRange(shopId, r), ...COMPLETED_WHERE } }),
  ]);
  return { created, withAddress, withPayment, paymentPending, completed };
}

export type FunnelStage = {
  key: string;
  label: string;
  basis: "session" | "intent";
  count: number;
  conversionFromPrevious: number | null;
  dropOffFromPrevious: number | null;
};

/**
 * The end-to-end express-checkout funnel. Stages 1–5 are session-based (from
 * CheckoutFunnelEvent); 6–9 are intent-based (from ExpressCheckoutIntent). The
 * handoff (checkout opened -> checkout started) is ~1:1 because opening the
 * modal creates the intent. Denominator basis is exposed per stage so the UI
 * can annotate the transition honestly.
 */
export async function getCheckoutFunnel(shopId: string, r: AnalyticsRange) {
  const [events, expressSource, deviceSplit, intents, prevIntents, prevEvents] = await Promise.all([
    distinctSessionsByEvent(shopId, r.start, r.end),
    distinctSessionsByExpressSource(shopId, r.start, r.end),
    distinctSessionsByDevice(shopId, r.start, r.end),
    intentStageCounts(shopId, { start: r.start, end: r.end }),
    intentStageCounts(shopId, { start: r.comparisonStart, end: r.comparisonEnd }),
    distinctSessionsByEvent(shopId, r.comparisonStart, r.comparisonEnd),
  ]);

  const ev = (type: string) => events.get(type) ?? 0;

  const raw: Array<{ key: string; label: string; basis: "session" | "intent"; count: number }> = [
    { key: "cart_add", label: "Add to cart", basis: "session", count: ev("CART_ADD") },
    { key: "drawer_open", label: "Cart drawer opened", basis: "session", count: ev("DRAWER_OPEN") },
    { key: "express_click", label: "Express checkout clicked", basis: "session", count: ev("EXPRESS_CLICK") },
    { key: "otp_success", label: "Signed in", basis: "session", count: ev("OTP_SUCCESS") },
    { key: "modal_open", label: "Checkout opened", basis: "session", count: ev("MODAL_OPEN") },
    { key: "intent", label: "Checkout started", basis: "intent", count: intents.created },
    { key: "address", label: "Address completed", basis: "intent", count: intents.withAddress },
    { key: "payment", label: "Payment selected", basis: "intent", count: intents.withPayment },
    { key: "order", label: "Order placed", basis: "intent", count: intents.completed },
  ];

  const stages: FunnelStage[] = raw.map((stage, index) => {
    const prev = index > 0 ? raw[index - 1].count : null;
    const conversionFromPrevious = prev === null ? null : rate(stage.count, prev);
    return {
      ...stage,
      conversionFromPrevious,
      dropOffFromPrevious: conversionFromPrevious === null ? null : 1 - conversionFromPrevious,
    };
  });

  const topOfFunnel = ev("CART_ADD") || ev("DRAWER_OPEN") || ev("EXPRESS_CLICK");
  const prevTop = prevEvents.get("CART_ADD") ?? prevEvents.get("DRAWER_OPEN") ?? prevEvents.get("EXPRESS_CLICK") ?? 0;

  const drawerClicks = expressSource.get("DRAWER") ?? 0;
  const cartPageClicks = expressSource.get("CART_PAGE") ?? 0;
  const mobile = deviceSplit.get("MOBILE") ?? 0;
  const desktop = deviceSplit.get("DESKTOP") ?? 0;

  return {
    range: serializeRange(r),
    stages,
    headline: {
      checkoutsStarted: comparison(intents.created, prevIntents.created),
      ordersPlaced: comparison(intents.completed, prevIntents.completed),
      startToOrderConversion: comparison(
        rate(intents.completed, intents.created),
        rate(prevIntents.completed, prevIntents.created),
      ),
      topToOrderConversion: comparison(rate(intents.completed, topOfFunnel), rate(prevIntents.completed, prevTop)),
    },
    segments: {
      entryPoint: [
        { key: "drawer", label: "Cart drawer", sessions: drawerClicks, share: rate(drawerClicks, drawerClicks + cartPageClicks) },
        { key: "cart_page", label: "Cart page", sessions: cartPageClicks, share: rate(cartPageClicks, drawerClicks + cartPageClicks) },
      ],
      device: [
        { key: "mobile", label: "Mobile", sessions: mobile, share: rate(mobile, mobile + desktop) },
        { key: "desktop", label: "Desktop", sessions: desktop, share: rate(desktop, mobile + desktop) },
      ],
    },
    notes: {
      basisHandoff:
        "Stages up to 'Checkout opened' count distinct storefront sessions; 'Checkout started' onward count checkout intents. The two are ~1:1 at the handoff.",
    },
  };
}

/**
 * Payment-mix and per-method completion for the period. Answers "how much of my
 * express volume is COD vs prepaid, and which converts better?"
 */
export async function getPaymentMix(shopId: string, r: AnalyticsRange) {
  const where = intentInRange(shopId, r);
  const [byMethod, completedByMethod] = await Promise.all([
    prisma.expressCheckoutIntent.groupBy({
      by: ["selectedPaymentMethod"],
      where: { ...where, selectedPaymentMethod: { not: null } },
      _count: { _all: true },
    }),
    prisma.expressCheckoutIntent.groupBy({
      by: ["selectedPaymentMethod"],
      where: { ...where, selectedPaymentMethod: { not: null }, ...COMPLETED_WHERE },
      _count: { _all: true },
    }),
  ]);
  const completedMap = new Map(completedByMethod.map((row) => [row.selectedPaymentMethod, row._count._all]));
  const total = byMethod.reduce((sum, row) => sum + row._count._all, 0);
  return {
    range: serializeRange(r),
    methods: byMethod.map((row) => {
      const method = row.selectedPaymentMethod ?? "UNKNOWN";
      const selected = row._count._all;
      const completed = completedMap.get(row.selectedPaymentMethod) ?? 0;
      return {
        method,
        label: method === "COD" ? "Cash on delivery" : method === "PREPAID" ? "Prepaid" : method,
        selected,
        completed,
        share: rate(selected, total),
        completionRate: rate(completed, selected),
      };
    }),
  };
}
