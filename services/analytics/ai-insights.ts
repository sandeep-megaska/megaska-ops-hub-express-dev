import type { AnalyticsRange } from "../reviews/review-analytics-date-range";
import { aiModel, isAiConfigured, openaiChatJson } from "../ai/openai-client";
import { getCheckoutFunnel, getPaymentMix } from "./checkout-funnel";
import { getAbandonedCarts, getRecoverySummary } from "./abandoned-carts";
import { getLoginAnalytics } from "./login-analytics";

export type AiRecommendation = { title: string; detail: string; priority: "high" | "medium" | "low" };
export type AiInsight = {
  enabled: boolean;
  generatedAt?: string;
  model?: string;
  summary?: string;
  recommendations?: AiRecommendation[];
  anomalies?: { title: string; detail: string }[];
  error?: string;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expires: number; value: AiInsight }>();

const rupees = (paise: number) => Math.round((paise || 0) / 100);

/**
 * Aggregated, PII-free snapshot the model reasons over. No mobiles, names, or
 * per-cart rows — only counts, rates, and totals.
 */
async function buildInsightContext(shopId: string, r: AnalyticsRange) {
  const [funnel, paymentMix, abandoned, recovery, logins] = await Promise.all([
    getCheckoutFunnel(shopId, r),
    getPaymentMix(shopId, r),
    getAbandonedCarts(shopId, r, 1),
    getRecoverySummary(shopId, r),
    getLoginAnalytics(shopId, r),
  ]);

  const cmp = (m: { value: number; percentageChange: number | null }) => ({
    value: Number(m.value.toFixed(4)),
    changePct: m.percentageChange === null ? null : Number(m.percentageChange.toFixed(1)),
  });

  return {
    currency: "INR",
    period: r.label,
    funnel: funnel.stages.map((s) => ({
      stage: s.label,
      basis: s.basis,
      reached: s.count,
      stepConversion: s.conversionFromPrevious === null ? null : Number(s.conversionFromPrevious.toFixed(4)),
    })),
    headline: {
      checkoutsStarted: cmp(funnel.headline.checkoutsStarted),
      ordersPlaced: cmp(funnel.headline.ordersPlaced),
      startToOrderConversion: cmp(funnel.headline.startToOrderConversion),
      cartToOrderConversion: cmp(funnel.headline.topToOrderConversion),
    },
    entryPoint: funnel.segments.entryPoint.map((e) => ({ source: e.label, sessions: e.sessions, share: Number(e.share.toFixed(3)) })),
    device: funnel.segments.device.map((d) => ({ device: d.label, sessions: d.sessions, share: Number(d.share.toFixed(3)) })),
    paymentMix: paymentMix.methods.map((m) => ({
      method: m.label,
      share: Number(m.share.toFixed(3)),
      completionRate: Number(m.completionRate.toFixed(3)),
    })),
    abandonedCarts: {
      count: abandoned.summary.abandonedCount,
      valueAtRiskRupees: rupees(abandoned.summary.valueAtRiskPaise),
      recoverableCount: abandoned.summary.recoverableCount,
    },
    recovery: {
      messagesSent: recovery.metrics.recoveryMessagesSent.value,
      clicks: recovery.metrics.recoveryClicks.value,
      cartsRecovered: recovery.metrics.cartsRecovered.value,
      clickThroughRate: Number(recovery.metrics.clickThroughRate.value.toFixed(3)),
      recoveryRate: Number(recovery.metrics.recoveryRate.value.toFixed(3)),
    },
    customers: {
      verifiedLogins: logins.metrics.verifiedLogins.value,
      uniqueCustomers: logins.metrics.uniqueCustomers.value,
      newCustomers: logins.metrics.newCustomers.value,
      returningCustomers: logins.metrics.returningCustomers.value,
      loginToPurchaseRate: Number(logins.metrics.loginToPurchaseRate.value.toFixed(3)),
      identifiedCheckoutRate: Number(logins.metrics.identifiedCheckoutRate.value.toFixed(3)),
    },
  };
}

const SYSTEM_PROMPT = `You are a senior direct-to-consumer (D2C) e-commerce growth analyst for an Indian Shopify store.

Current store architecture (reason about THIS, not any older custom checkout):
- Shoppers add to cart and open a custom cart drawer. In the drawer they pick one of two options — "Pay Now" (prepaid) or "Cash on Delivery" (COD) — and are then handed off to Shopify's NATIVE checkout to complete the order. There is no custom checkout modal.
- Prepaid is incentivized with an automatic prepaid discount (paying online is cheaper than COD). Shifting volume from COD to prepaid is the primary lever, because COD carries return-to-origin (RTO) losses.
- Mobile OTP login verifies the shopper's phone; COD can be restricted/hidden for prepaid-eligible carts via a Shopify payment customization.

You are given an aggregated, anonymized metrics snapshot for one period (rates are fractions 0-1; money is in INR rupees).
Some funnel stage labels may still reflect an earlier checkout implementation; weight the payment mix (prepaid vs COD share and per-method completion), start-to-order and cart-to-order conversion, cart-drawer entry, abandoned-cart value, and recovery over any single legacy stage name.

Produce concise, specific, decision-ready insights grounded ONLY in the provided numbers — never invent data or cite metrics not present.
Frame recommendations around the current levers: raising the prepaid share (e.g. tuning the prepaid discount or how prominently it's presented), reducing COD dependence and RTO exposure, cutting drop-off in the cart-drawer → native-checkout hand-off, improving abandoned-cart recovery, and converting verified logins to orders. Apply Indian D2C context (COD prevalence, RTO risk, mobile-first shoppers).

Respond as strict minified JSON with exactly these keys:
  "summary": string (2-3 sentences on what stands out this period),
  "recommendations": array (max 5) of { "title": string, "detail": string (one specific action), "priority": "high"|"medium"|"low" },
  "anomalies": array (max 3) of { "title": string, "detail": string } — notable spikes/drops/imbalances; empty array if none.
If the data is too sparse to be meaningful, say so in "summary" and return few or no recommendations.`;

function coerceInsight(parsed: Record<string, unknown>, model: string): AiInsight {
  const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies : [];
  const priority = (p: unknown): "high" | "medium" | "low" =>
    p === "high" || p === "medium" || p === "low" ? p : "medium";
  return {
    enabled: true,
    generatedAt: new Date().toISOString(),
    model,
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1200) : "",
    recommendations: recs.slice(0, 5).map((r) => {
      const rec = (r || {}) as Record<string, unknown>;
      return {
        title: String(rec.title || "").slice(0, 160),
        detail: String(rec.detail || "").slice(0, 600),
        priority: priority(rec.priority),
      };
    }),
    anomalies: anomalies.slice(0, 3).map((a) => {
      const an = (a || {}) as Record<string, unknown>;
      return { title: String(an.title || "").slice(0, 160), detail: String(an.detail || "").slice(0, 600) };
    }),
  };
}

/**
 * Platform-owned AI analyst. Returns { enabled:false } when no key is configured
 * so the UI can hide the panel; soft-errors (never throws) so a provider hiccup
 * can't break the analytics page.
 */
export async function getAiInsights(shopId: string, r: AnalyticsRange, opts?: { refresh?: boolean }): Promise<AiInsight> {
  if (!isAiConfigured()) return { enabled: false };

  const cacheKey = `${shopId}|${r.start.toISOString()}|${r.end.toISOString()}`;
  if (!opts?.refresh) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;
  }

  try {
    const context = await buildInsightContext(shopId, r);
    const parsed = await openaiChatJson({
      system: SYSTEM_PROMPT,
      user: JSON.stringify(context),
      maxTokens: 900,
    });
    if (!parsed) return { enabled: false };
    const value = coerceInsight(parsed, aiModel());
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch {
    return { enabled: true, error: "AI insights are temporarily unavailable. Please try again shortly." };
  }
}
