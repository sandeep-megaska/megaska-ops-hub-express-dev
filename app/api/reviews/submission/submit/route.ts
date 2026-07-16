import type { NextRequest } from "next/server";
import { submitVerifiedReview } from "../../../../../services/reviews/review-submission.ts";
import { activeSessionCustomerId, allowedOrigin, parseJson, rateLimit, reply, requireReviewProxy } from "../../../../../services/reviews/review-submission-http.ts";
export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 403);
  const shop = await requireReviewProxy(request).catch(() => null); if (!shop) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 401);
  if (!rateLimit(request, "review-submit", 5, 900_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const body = await parseJson(request); if (!body || typeof body.token !== "string") return reply({ ok: false, errorCode: "REVIEW_VALIDATION_FAILED" }, 400);
  const result = await submitVerifiedReview({ token: body.token, shopId: shop.id, rating: body.rating, title: body.title, body: body.body, customerDisplayName: body.customerDisplayName, sessionCustomerProfileId: await activeSessionCustomerId(request) });
  if (result.ok) return reply(result);
  if (result.errorCode === "REVIEW_VALIDATION_FAILED") return reply(result, 400);
  const status = result.errorCode === "REVIEW_CUSTOMER_SESSION_MISMATCH" ? 403 : result.errorCode === "REVIEW_ALREADY_SUBMITTED" ? 409 : result.errorCode === "REVIEW_TOKEN_EXPIRED" || result.errorCode === "REVIEW_TOKEN_REQUEST_INACTIVE" || result.errorCode === "REVIEWS_DISABLED" ? 410 : 404;
  return reply({ ok: false, errorCode: result.errorCode }, status);
}
export const dynamic = "force-dynamic";
