import type { NextRequest } from "next/server";
import { submitEligibleReview, ReviewSubmissionDomainError } from "../../../../services/reviews/review-submission.ts";
import { resolveReviewSubmissionAccess, resolveCanonicalReviewTarget } from "../../../../services/reviews/review-submission-access.ts";
import { allowedOrigin, parseJson, rateLimit, reply, requireReviewProxy } from "../../../../services/reviews/review-submission-http.ts";

export const dynamic = "force-dynamic";
const forbidden = new Set(["shopId", "customerProfileId", "verifiedPurchase", "status", "source", "reviewRequestId"]);
function http(code: string) { return code === "UNAUTHENTICATED" ? 401 : code === "ALREADY_REVIEWED" ? 409 : code === "REVIEWS_DISABLED" || code === "EXPIRED_TOKEN" || code === "TOKEN_CONSUMED" ? 410 : code === "REVIEW_VALIDATION_FAILED" ? 400 : 403; }

export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "INVALID_REQUEST" }, 403);
  const shop = await requireReviewProxy(request).catch(() => null);
  if (!shop) return reply({ ok: false, errorCode: "INVALID_REQUEST" }, 401);
  if (!rateLimit(request, "review-submissions", 5, 15 * 60_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const body = await parseJson(request);
  if (!body || Object.keys(body).some((key) => forbidden.has(key))) return reply({ ok: false, errorCode: "REVIEW_VALIDATION_FAILED" }, 400);
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
  const access = await resolveReviewSubmissionAccess({ request, accessToken, sessionSource: "PRODUCT_PAGE", shopId: shop.id });
  if (!access.ok) return reply({ ok: false, errorCode: access.reason }, http(access.reason));
  const target = resolveCanonicalReviewTarget(access, { orderId: body.orderId as string, orderLineId: body.orderLineId as string, productId: body.productId as string, variantId: body.variantId as string | null });
  if (!target.ok) return reply({ ok: false, errorCode: target.reason }, 403);
  try {
    const review = await submitEligibleReview({ shopId: access.shopId, customerProfileId: access.customerProfileId, source: access.source, reviewRequestId: access.reviewRequestId, input: { rating: body.rating as number, title: body.title as string | null, body: String(body.body || ""), productId: target.productId || "", variantId: target.variantId, orderId: target.orderId || "", orderLineId: target.orderLineId || "" } });
    return reply({ ok: true, review }, 201);
  } catch (error) {
    if (error instanceof ReviewSubmissionDomainError) return reply({ ok: false, errorCode: error.code }, http(error.code));
    throw error;
  }
}
