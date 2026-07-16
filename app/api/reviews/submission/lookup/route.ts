import type { NextRequest } from "next/server";
import { getReviewSubmissionContext } from "../../../../../services/reviews/review-submission.ts";
import { allowedOrigin, parseJson, rateLimit, reply, requireReviewProxy } from "../../../../../services/reviews/review-submission-http.ts";
export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 403);
  const shop = await requireReviewProxy(request).catch(() => null); if (!shop) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 401);
  if (!rateLimit(request, "review-lookup", 20, 600_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const body = await parseJson(request); if (!body || typeof body.token !== "string") return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 400);
  const result = await getReviewSubmissionContext({ token: body.token, shopId: shop.id });
  if (result.ok) return reply(result);
  const status = result.errorCode === "REVIEW_TOKEN_EXPIRED" || result.errorCode === "REVIEW_TOKEN_REQUEST_INACTIVE" ? 410 : result.errorCode === "REVIEW_ALREADY_SUBMITTED" ? 409 : 404;
  return reply({ ok: false, errorCode: result.errorCode }, status);
}
export const dynamic = "force-dynamic";
