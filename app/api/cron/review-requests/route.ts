import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma.ts";
import { evaluateAndApplyReviewRequestEligibility } from "../../../../services/reviews/review-eligibility.ts";
import {
  expireReviewRequests,
  processDueReviewRequests,
  recoverStaleScheduledReviewRequests,
} from "../../../../services/reviews/review-request-processor.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROMOTE_BATCH = 100;
const SEND_BATCH = 25;
const DEFAULT_MAX_DELIVERY_AGE_DAYS = 30;

// Vercel Cron invokes this on a schedule (see vercel.json) and, when CRON_SECRET
// is set in the project, sends `Authorization: Bearer <CRON_SECRET>`. We fail
// closed if CRON_SECRET is not configured so the endpoint is never open.
function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Orders delivered longer ago than this never get a first review email, so turning
// automation on does not email customers about old purchases.
function maxDeliveryAgeDays(): number {
  const value = Number(process.env.REVIEW_REQUEST_MAX_DELIVERY_AGE_DAYS);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : DEFAULT_MAX_DELIVERY_AGE_DAYS;
}

// Requests wait in PENDING_ELIGIBILITY until the exchange/issue protection window
// after delivery ends; nothing else re-evaluates them once that time has passed.
async function promoteWaitingRequests(now: Date) {
  const waiting = await prisma.reviewRequest.findMany({
    take: PROMOTE_BATCH,
    where: {
      status: "PENDING_ELIGIBILITY",
      eligibleAt: { lte: now },
      shop: { reviewSettings: { is: { reviewsEnabled: true, automaticRequestsEnabled: true } } },
    },
    orderBy: [{ eligibleAt: "asc" }, { id: "asc" }],
    select: { id: true, shopId: true },
  });
  let eligible = 0;
  let failed = 0;
  for (const request of waiting) {
    try {
      const { persisted } = await evaluateAndApplyReviewRequestEligibility({ shopId: request.shopId, reviewRequestId: request.id, now });
      if (persisted.status === "ELIGIBLE") eligible += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: waiting.length, eligible, failed };
}

async function run(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const now = new Date();
  const deliveredAfter = new Date(now.getTime() - maxDeliveryAgeDays() * 86_400_000);
  try {
    const recovered = await recoverStaleScheduledReviewRequests({ now });
    const promoted = await promoteWaitingRequests(now);
    const processed = await processDueReviewRequests({ now, limit: SEND_BATCH, deliveredAfter });
    const expired = await expireReviewRequests({ now });
    const summary = {
      recovered: recovered.recovered,
      promoted: promoted.eligible,
      promoteFailures: promoted.failed,
      scanned: processed.scanned,
      sent: processed.sent,
      skipped: processed.skipped,
      retryableFailures: processed.retryableFailures,
      finalFailures: processed.finalFailures,
      expired: expired.expired,
    };
    console.info("[REVIEW REQUESTS] cron_completed", summary);
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[REVIEW REQUESTS] cron_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "Review request processing failed." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
