import type { NextRequest } from "next/server";
import { submitVerifiedReview, type ReviewSubmissionErrorCode } from "../../../../../services/reviews/review-submission.ts";
import { activeSessionCustomerId, allowedOrigin, parseJson, rateLimit, reply, requireReviewProxy } from "../../../../../services/reviews/review-submission-http.ts";
function submitErrorStatus(errorCode: ReviewSubmissionErrorCode): number {
  switch (errorCode) {
    case "REVIEW_VALIDATION_FAILED":
      return 400;
    case "REVIEW_CUSTOMER_SESSION_MISMATCH":
      return 403;
    case "REVIEW_ALREADY_SUBMITTED":
      return 409;
    case "REVIEW_TOKEN_EXPIRED":
    case "REVIEW_TOKEN_REQUEST_INACTIVE":
    case "REVIEWS_DISABLED":
      return 410;
    case "REVIEW_TOKEN_INVALID":
    case "REVIEW_SHOP_MISMATCH":
    case "REVIEW_PRODUCT_UNAVAILABLE":
      return 404;
  }
}

export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 403);
  const shop = await requireReviewProxy(request).catch(() => null); if (!shop) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 401);
  if (!rateLimit(request, "review-submit", 5, 900_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const body = await parseJson(request); if (!body || typeof body.token !== "string") return reply({ ok: false, errorCode: "REVIEW_VALIDATION_FAILED" }, 400);
  const result = await submitVerifiedReview({ token: body.token, shopId: shop.id, rating: body.rating, title: body.title, body: body.body, customerDisplayName: body.customerDisplayName, sessionCustomerProfileId: await activeSessionCustomerId(request) });
  if (result.ok) return reply(result);
  return reply(result, submitErrorStatus(result.errorCode));
}
export const dynamic = "force-dynamic";
