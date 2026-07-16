/* The lifecycle test seam accepts narrow Prisma doubles whose generated types vary by test. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from "../../generated/prisma/index.js";
import { prisma as defaultPrisma } from "../db/prisma.ts";
import { ShopifyBillingAdapter, BillingProviderError } from "./adapters/shopify/shopify-billing-adapter.ts";
import { openMerchantBillingPeriod, type ResolvedMerchantBillingPeriod } from "./periods.ts";
import { rateBillingPeriod, type RateBillingPeriodResult } from "./rating.ts";
import type { BillingProvider } from "./subscription.ts";

/** Provider-normalized input. Provider adapters must translate their payload before calling here. */
export type ProviderBillingCycle = { provider: BillingProvider; externalSubscriptionId: string; periodStart: Date; periodEnd: Date; providerStatus: string; renewsAutomatically: boolean; trialStart?: Date | null; trialEnd?: Date | null };
export type BillingLifecycleStatus = { shopId: string; subscriptionId: string | null; subscriptionStatus: string | null; billingProvider: string | null; currentPeriodId: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; currentPeriodStatus: string | null; providerStatus: string | null; canInitialize: boolean; canRate: boolean; canSubmitUsage: boolean; canClose: boolean; canRollover: boolean; blockingReason: string | null };
export type PeriodUsageSubmissionResult = { billingPeriodId: string; submitted: number; skippedZeroAmount: number; alreadySucceeded: number; retryableFailures: number; finalFailures: number; results: Array<{ merchantRatedUsageId: string; featureCode: string; status: string; providerSubmissionId: string | null; errorCode: string | null }> };

const MAX_PERIOD_DURATION_MS = 366 * 24 * 60 * 60 * 1000;
const prisma = defaultPrisma as any;
let db: any = prisma;
export function __setBillingLifecyclePrismaForTests(client: any) { db = client; }
export class BillingLifecycleError extends Error { constructor(public readonly code: string) { super(code); this.name = "BillingLifecycleError"; } }
function log(event: string, fields: Record<string, unknown>) { console.info(event, fields); }
function validDate(value: unknown, field: string) { const date = value instanceof Date ? new Date(value) : new Date(String(value)); if (Number.isNaN(date.getTime())) throw new BillingLifecycleError(`INVALID_${field.toUpperCase()}`); return date; }
function validateCycle(cycle: ProviderBillingCycle) { const start = validDate(cycle.periodStart, "period_start"); const end = validDate(cycle.periodEnd, "period_end"); if (end <= start || end.getTime() - start.getTime() > MAX_PERIOD_DURATION_MS) throw new BillingLifecycleError("INVALID_PERIOD_RANGE"); const trialStart = cycle.trialStart == null ? null : validDate(cycle.trialStart, "trial_start"); const trialEnd = cycle.trialEnd == null ? null : validDate(cycle.trialEnd, "trial_end"); if (trialStart && trialEnd && trialEnd < trialStart) throw new BillingLifecycleError("INVALID_TRIAL_RANGE"); return { start, end, trialStart, trialEnd }; }
async function ownedSubscription(shopId: string, subscriptionId: string) { const subscription = await db.merchantSubscription.findFirst({ where: { id: subscriptionId, shopId } }); if (!subscription) throw new BillingLifecycleError("SUBSCRIPTION_NOT_FOUND"); return subscription; }
async function ownedPeriod(shopId: string, billingPeriodId: string) { const period = await db.merchantBillingPeriod.findFirst({ where: { id: billingPeriodId, shopId }, include: { subscription: true } }); if (!period) throw new BillingLifecycleError("BILLING_PERIOD_NOT_FOUND"); return period; }
function cancelled(status: string) { return status === "CANCELED" || status === "EXPIRED"; }

/** Synchronizes provider state only; it deliberately does not know any provider GraphQL shape. */
export async function initializeMerchantBillingCycle(input: { shopId: string; merchantSubscriptionId: string; providerCycle: ProviderBillingCycle }): Promise<{ subscriptionId: string; billingPeriod: ResolvedMerchantBillingPeriod }> {
  const started = Date.now(); log("billing_cycle_sync_started", { shopId: input.shopId, subscriptionId: input.merchantSubscriptionId, provider: input.providerCycle.provider });
  const dates = validateCycle(input.providerCycle); const subscription = await ownedSubscription(input.shopId, input.merchantSubscriptionId);
  if (subscription.billingProvider !== input.providerCycle.provider) throw new BillingLifecycleError("BILLING_PROVIDER_MISMATCH");
  const providerStatus = String(input.providerCycle.providerStatus || "").trim();
  const isCancelled = /cancel/i.test(providerStatus);
  await db.merchantSubscription.update({ where: { id: subscription.id }, data: { externalSubscriptionReference: input.providerCycle.externalSubscriptionId, currentPeriodStart: dates.start, currentPeriodEnd: dates.end, trialStartsAt: dates.trialStart, trialEndsAt: dates.trialEnd, renewsAutomatically: input.providerCycle.renewsAutomatically, providerStatus, providerActivatedAt: isCancelled ? subscription.providerActivatedAt : (subscription.providerActivatedAt ?? new Date()), ...(isCancelled ? { status: "CANCELED", canceledAt: subscription.canceledAt ?? new Date(), cancellationEffectiveAt: dates.end } : {}) } });
  if (isCancelled) throw new BillingLifecycleError("SUBSCRIPTION_CANCELED");
  const billingPeriod = await openMerchantBillingPeriod(input.shopId, { periodStart: dates.start, periodEnd: dates.end });
  log("billing_cycle_initialized", { shopId: input.shopId, subscriptionId: subscription.id, billingPeriodId: billingPeriod.id, provider: subscription.billingProvider, duration: Date.now() - started });
  return { subscriptionId: subscription.id, billingPeriod };
}
export const synchronizeBillingCycleFromProvider = initializeMerchantBillingCycle;

export async function rateMerchantBillingPeriodLifecycle(input: { shopId: string; billingPeriodId: string; allowEarlyRating?: boolean }): Promise<RateBillingPeriodResult> {
  const period = await ownedPeriod(input.shopId, input.billingPeriodId);
  if (period.status === "RATED") return rateBillingPeriod(input.shopId, input.billingPeriodId);
  if (period.status !== "OPEN") throw new BillingLifecycleError("BILLING_PERIOD_NOT_RATEABLE");
  if (period.periodEnd > new Date() && !(input.allowEarlyRating && process.env.BILLING_UAT_CONTROLS_ENABLED === "true")) throw new BillingLifecycleError("BILLING_PERIOD_NOT_ENDED");
  const result = await rateBillingPeriod(input.shopId, input.billingPeriodId);
  log("billing_period_rated", { shopId: input.shopId, subscriptionId: period.subscriptionId, billingPeriodId: input.billingPeriodId, duration: 0 });
  return result;
}

async function submissionFor(row: any, period: any) {
  const existing = await db.merchantBillingProviderSubmission.findFirst({ where: { merchantRatedUsageId: row.id, shopId: period.shopId, operation: "CREATE_USAGE_RECORD" } });
  if (existing?.status === "SUCCEEDED") return { row, submission: existing, state: "already" };
  if (existing?.status === "PROCESSING") return { row, submission: existing, state: "processing" };
  const submission = existing ?? await db.merchantBillingProviderSubmission.create({ data: { shopId: period.shopId, merchantSubscriptionId: period.subscriptionId, merchantBillingPeriodId: period.id, merchantRatedUsageId: row.id, provider: period.subscription.billingProvider, operation: "CREATE_USAGE_RECORD", idempotencyKey: `usage:${row.id}`, amount: row.amount, currency: row.currency, status: "PENDING" } });
  const claimed = await db.merchantBillingProviderSubmission.updateMany({ where: { id: submission.id, shopId: period.shopId, status: { in: ["PENDING", "FAILED_RETRYABLE"] } }, data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastAttemptAt: new Date(), errorCode: null, errorMessage: null } });
  return { row, submission, state: claimed.count === 1 ? "claimed" : "processing" };
}

export async function submitRatedBillingPeriodUsage(input: { shopId: string; billingPeriodId: string }): Promise<PeriodUsageSubmissionResult> {
  const period = await ownedPeriod(input.shopId, input.billingPeriodId); if (period.status !== "RATED" && period.status !== "CLOSED") throw new BillingLifecycleError("BILLING_PERIOD_NOT_RATED");
  const rows = await db.merchantRatedUsage.findMany({ where: { shopId: input.shopId, billingPeriodId: period.id }, orderBy: { featureCodeSnapshot: "asc" } });
  const output: PeriodUsageSubmissionResult = { billingPeriodId: period.id, submitted: 0, skippedZeroAmount: 0, alreadySucceeded: 0, retryableFailures: 0, finalFailures: 0, results: [] };
  for (const row of rows) {
    if (new Prisma.Decimal(row.amount).isZero()) { output.skippedZeroAmount++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status: "SKIPPED_ZERO_AMOUNT", providerSubmissionId: null, errorCode: null }); continue; }
    const claim = await submissionFor(row, period);
    if (claim.state === "already") { output.alreadySucceeded++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status: "SUCCEEDED", providerSubmissionId: claim.submission.id, errorCode: null }); continue; }
    if (claim.state === "processing") { output.retryableFailures++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status: "PROCESSING", providerSubmissionId: claim.submission.id, errorCode: "PROCESSING" }); continue; }
    try {
      if (period.subscription.billingProvider !== "SHOPIFY") { await db.merchantBillingProviderSubmission.update({ where: { id: claim.submission.id }, data: { status: "SUCCEEDED", succeededAt: new Date() } }); output.submitted++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status: "SUCCEEDED", providerSubmissionId: claim.submission.id, errorCode: null }); continue; }
      const line = (period.subscription.providerMetadata as any)?.usageLineItemId;
      const result = await new ShopifyBillingAdapter().createUsageCharge({ shopId: input.shopId, merchantSubscriptionId: period.subscriptionId, merchantBillingPeriodId: period.id, merchantRatedUsageId: row.id, description: `Rated ${row.featureCodeSnapshot} usage`, currency: row.currency, amount: String(row.amount), usageLineItemId: line, idempotencyKey: `usage:${row.id}` });
      await db.merchantBillingProviderSubmission.update({ where: { id: claim.submission.id }, data: { status: "SUCCEEDED", succeededAt: new Date(), externalReference: result.externalUsageRecordId } }); output.submitted++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status: result.status, providerSubmissionId: claim.submission.id, errorCode: null });
    } catch (error) { const providerError = error instanceof BillingProviderError ? error : null; const status = providerError?.retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL"; await db.merchantBillingProviderSubmission.update({ where: { id: claim.submission.id }, data: { status, failedAt: new Date(), errorCode: providerError?.code ?? "PROVIDER_SUBMISSION_FAILED", errorMessage: providerError?.message ?? "Provider usage submission failed." } }); if (status === "FAILED_RETRYABLE") output.retryableFailures++; else output.finalFailures++; output.results.push({ merchantRatedUsageId: row.id, featureCode: row.featureCodeSnapshot, status, providerSubmissionId: claim.submission.id, errorCode: providerError?.code ?? "PROVIDER_SUBMISSION_FAILED" }); }
  }
  log("billing_period_usage_submission_completed", { shopId: input.shopId, ...output }); return output;
}

export async function closeRatedBillingPeriodLifecycle(input: { shopId: string; billingPeriodId: string; allowDeferredProviderSubmission?: boolean }): Promise<ResolvedMerchantBillingPeriod> {
  const period = await ownedPeriod(input.shopId, input.billingPeriodId); if (period.status === "CLOSED") return period; if (period.status !== "RATED") throw new BillingLifecycleError("BILLING_PERIOD_NOT_RATED");
  const blocking = await db.merchantBillingProviderSubmission.findFirst({ where: { shopId: input.shopId, merchantBillingPeriodId: period.id, status: { in: input.allowDeferredProviderSubmission && process.env.BILLING_UAT_CONTROLS_ENABLED === "true" ? ["PROCESSING"] : ["PENDING", "PROCESSING", "FAILED_RETRYABLE", "FAILED_FINAL"] } } });
  if (blocking) { const code = blocking.status === "FAILED_FINAL" ? "PROVIDER_SUBMISSION_FAILED_FINAL" : "PROVIDER_SUBMISSION_UNRESOLVED"; log("billing_period_close_blocked", { shopId: input.shopId, billingPeriodId: period.id, normalizedErrorCode: code }); throw new BillingLifecycleError(code); }
  // Shopify is blocked by default until the latest immutable reconciliation audit matches every non-zero row.
  if (period.subscription.billingProvider === "SHOPIFY" && process.env.BILLING_REQUIRE_SHOPIFY_RECONCILIATION !== "false" && db.merchantBillingReconciliation?.findMany) {
    const audits = await db.merchantBillingReconciliation.findMany({ where: { shopId: input.shopId, billingPeriodId: period.id }, orderBy: { checkedAt: "desc" } });
    const latest = new Map<string, any>(); for (const audit of audits) if (audit.merchantRatedUsageId && !latest.has(audit.merchantRatedUsageId)) latest.set(audit.merchantRatedUsageId, audit);
    const rated = await db.merchantRatedUsage.findMany({ where: { shopId: input.shopId, billingPeriodId: period.id } });
    if (rated.some((row: any) => !new Prisma.Decimal(row.amount).isZero() && latest.get(row.id)?.status !== "MATCHED")) throw new BillingLifecycleError("PROVIDER_RECONCILIATION_UNRESOLVED");
  }
  const changed = await db.merchantBillingPeriod.updateMany({ where: { id: period.id, shopId: input.shopId, status: "RATED" }, data: { status: "CLOSED", closedAt: new Date() } }); if (changed.count !== 1) return ownedPeriod(input.shopId, period.id); const closed = await ownedPeriod(input.shopId, period.id); log("billing_period_closed", { shopId: input.shopId, subscriptionId: period.subscriptionId, billingPeriodId: period.id, previousStatus: "RATED", nextStatus: "CLOSED" }); return closed;
}

export async function rolloverMerchantBillingCycle(input: { shopId: string; subscriptionId: string; nextPeriodStart: Date; nextPeriodEnd: Date }): Promise<{ subscriptionId: string; billingPeriod: ResolvedMerchantBillingPeriod }> {
  const subscription = await ownedSubscription(input.shopId, input.subscriptionId); if (cancelled(subscription.status)) throw new BillingLifecycleError("SUBSCRIPTION_CANCELED"); const start = validDate(input.nextPeriodStart, "next_period_start"); const end = validDate(input.nextPeriodEnd, "next_period_end"); if (end <= start) throw new BillingLifecycleError("INVALID_PERIOD_RANGE");
  const previous = await db.merchantBillingPeriod.findFirst({ where: { shopId: input.shopId, subscriptionId: subscription.id }, orderBy: { periodEnd: "desc" } }); if (!previous || previous.status !== "CLOSED") throw new BillingLifecycleError("PREVIOUS_PERIOD_NOT_CLOSED"); if (previous.periodEnd.getTime() !== start.getTime()) throw new BillingLifecycleError("BILLING_PERIOD_CONTINUITY_REQUIRED");
  await db.merchantSubscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: start, currentPeriodEnd: end } }); const billingPeriod = await openMerchantBillingPeriod(input.shopId, { periodStart: start, periodEnd: end }); log("billing_cycle_rolled_over", { shopId: input.shopId, subscriptionId: subscription.id, billingPeriodId: billingPeriod.id }); return { subscriptionId: subscription.id, billingPeriod };
}

export async function getBillingLifecycleStatus(input: { shopId: string }): Promise<BillingLifecycleStatus> { const subscription = await db.merchantSubscription.findFirst({ where: { shopId: input.shopId }, include: { billingPeriods: { where: { status: { not: "VOID" } }, orderBy: { periodStart: "desc" }, take: 1 }, billingProviderSubmissions: { where: { status: { in: ["PENDING", "PROCESSING", "FAILED_RETRYABLE", "FAILED_FINAL"] } }, take: 1 } } }); if (!subscription) return { shopId: input.shopId, subscriptionId: null, subscriptionStatus: null, billingProvider: null, currentPeriodId: null, currentPeriodStart: null, currentPeriodEnd: null, currentPeriodStatus: null, providerStatus: null, canInitialize: true, canRate: false, canSubmitUsage: false, canClose: false, canRollover: false, blockingReason: "SUBSCRIPTION_REQUIRED" }; const period = subscription.billingPeriods[0] ?? null; const failed = subscription.billingProviderSubmissions[0]; const block = failed?.status === "FAILED_FINAL" ? "PROVIDER_SUBMISSION_FAILED_FINAL" : failed ? "PROVIDER_SUBMISSION_UNRESOLVED" : cancelled(subscription.status) ? "SUBSCRIPTION_CANCELED" : null; return { shopId: input.shopId, subscriptionId: subscription.id, subscriptionStatus: subscription.status, billingProvider: subscription.billingProvider, currentPeriodId: period?.id ?? null, currentPeriodStart: period?.periodStart.toISOString() ?? subscription.currentPeriodStart?.toISOString() ?? null, currentPeriodEnd: period?.periodEnd.toISOString() ?? subscription.currentPeriodEnd?.toISOString() ?? null, currentPeriodStatus: period?.status ?? null, providerStatus: subscription.providerStatus, canInitialize: !cancelled(subscription.status), canRate: period?.status === "OPEN" && period.periodEnd <= new Date(), canSubmitUsage: period?.status === "RATED", canClose: period?.status === "RATED" && !block, canRollover: period?.status === "CLOSED" && !cancelled(subscription.status), blockingReason: block }; }

export async function processDueBillingPeriods(input: { now?: Date; limit?: number } = {}) { const now = input.now ?? new Date(); const limit = Math.min(Math.max(input.limit ?? 50, 1), 100); const periods = await db.merchantBillingPeriod.findMany({ where: { status: "OPEN", periodEnd: { lte: now } }, orderBy: [{ periodEnd: "asc" }, { id: "asc" }], take: limit, select: { id: true, shopId: true } }); const results: Array<{ billingPeriodId: string; status: string; errorCode?: string }> = []; for (const period of periods) try { await rateMerchantBillingPeriodLifecycle({ shopId: period.shopId, billingPeriodId: period.id }); await submitRatedBillingPeriodUsage({ shopId: period.shopId, billingPeriodId: period.id }); await closeRatedBillingPeriodLifecycle({ shopId: period.shopId, billingPeriodId: period.id }); results.push({ billingPeriodId: period.id, status: "CLOSED" }); } catch (error) { results.push({ billingPeriodId: period.id, status: "PARTIAL", errorCode: error instanceof BillingLifecycleError ? error.code : "BILLING_LIFECYCLE_FAILED" }); log("billing_lifecycle_failed", { shopId: period.shopId, billingPeriodId: period.id }); } return { processed: results.length, results }; }
