import type { NextRequest } from "next/server";
import { getReviewSubmissionContext, type ReviewSubmissionDomainErrorCode } from "../../../../../services/reviews/review-submission.ts";
import { allowedOrigin, parseJson, rateLimit, reply, requireReviewProxy } from "../../../../../services/reviews/review-submission-http.ts";
function lookupErrorStatus(errorCode: ReviewSubmissionDomainErrorCode): number {
  switch (errorCode) {
    case "REVIEW_TOKEN_EXPIRED":
    case "REVIEW_TOKEN_REQUEST_INACTIVE":
      return 410;
    case "REVIEW_ALREADY_SUBMITTED":
      return 409;
    case "REVIEW_TOKEN_INVALID":
    case "REVIEW_SHOP_MISMATCH":
    case "REVIEWS_DISABLED":
    case "REVIEW_PRODUCT_UNAVAILABLE":
    case "REVIEW_CUSTOMER_SESSION_MISMATCH":
      return 404;
  }
}

export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 403);
  const shop = await requireReviewProxy(request).catch(() => null); if (!shop) return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 401);
  if (!rateLimit(request, "review-lookup", 20, 600_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const body = await parseJson(request); if (!body || typeof body.token !== "string") return reply({ ok: false, errorCode: "REVIEW_TOKEN_INVALID" }, 400);
  const result = await getReviewSubmissionContext({ token: body.token, shopId: shop.id });
  if (result.ok) return reply(result);
  return reply({ ok: false, errorCode: result.errorCode }, lookupErrorStatus(result.errorCode));
}
export const dynamic = "force-dynamic";
