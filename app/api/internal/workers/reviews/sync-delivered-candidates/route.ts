import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncDeliveredOrderReviewCandidatesBatch } from "../../../../../../services/reviews/review-candidate-sync";
export const runtime = "nodejs";
function authorized(request: NextRequest) { const secret = String(process.env.REVIEW_PROCESSOR_SECRET ?? ""); const authorization = request.headers.get("authorization"); if (!secret || !authorization?.startsWith("Bearer ")) return false; const expected = Buffer.from(secret), received = Buffer.from(authorization.slice(7)); return expected.length === received.length && timingSafeEqual(expected, received); }
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "REVIEW_PROCESSOR_UNAUTHORIZED" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  const { shopId, limit, cursor } = body as Record<string, unknown>;
  if ((shopId !== undefined && (typeof shopId !== "string" || !shopId.trim())) || (cursor !== undefined && (typeof cursor !== "string" || !cursor.trim())) || (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100))) return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  try { const result = await syncDeliveredOrderReviewCandidatesBatch({ shopId: shopId as string | undefined, limit: limit as number | undefined, cursor: cursor as string | undefined }); return NextResponse.json({ ok: true, scanned: result.scanned, succeeded: result.succeeded, failed: result.failed, created: result.created, enriched: result.enriched, skipped: result.skipped, nextCursor: result.nextCursor }); }
  catch { return NextResponse.json({ ok: false, error: "REVIEW_CANDIDATE_RECONCILIATION_FAILED" }, { status: 500 }); }
}
