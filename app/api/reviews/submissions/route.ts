import type { NextRequest } from "next/server";
import { resolveCanonicalReviewTarget, resolveReviewSubmissionAccess, type ReviewSubmissionAccess } from "../../../../services/reviews/review-submission-access.ts";
import { ReviewSubmissionDomainError, submitEligibleReview, submitEligibleReviewWithTokenConsumption, type PublicSubmittedReview } from "../../../../services/reviews/review-submission.ts";
import { ReviewSubmissionInputError, validateReviewSubmissionInput, type ReviewSubmissionInput } from "../../../../services/reviews/review-submission-input.ts";
import { allowedOrigin, parseJson, rateLimit, reply } from "../../../../services/reviews/review-submission-http.ts";
import { reviewSubmissionErrorStatus, reviewSubmissionMessage, validateSubmissionEnvelope } from "../../../../services/reviews/review-submission-api.ts";

export const dynamic = "force-dynamic";

function fail(errorCode: string) { return reply({ ok: false, errorCode, message: reviewSubmissionMessage(errorCode) }, reviewSubmissionErrorStatus(errorCode)); }
function publicReview(review: PublicSubmittedReview) { return { ...review, status: "PENDING", submittedAt: review.submittedAt.toISOString() }; }
function submissionFields(body: Record<string, unknown>) { return { rating: body.rating, title: body.title, body: body.body, productId: body.productId, variantId: body.variantId, orderId: body.orderId, orderLineId: body.orderLineId }; }



export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!allowedOrigin(request)) return fail("UNAUTHENTICATED");
  if (!rateLimit(request, "review-submissions", 10, 900_000)) return fail("RATE_LIMITED");
  const body = await parseJson(request);
  if (!body) return fail("INVALID_INPUT");
  const envelope = validateSubmissionEnvelope(body);
  if (!envelope.ok) return fail(envelope.errorCode);
  let parsed: ReviewSubmissionInput;
  try { parsed = validateReviewSubmissionInput(submissionFields(body)); } catch (error) { if (error instanceof ReviewSubmissionInputError) return fail("INVALID_INPUT"); throw error; }
  const access = await resolveReviewSubmissionAccess({ request, accessToken: envelope.accessToken, sessionSource: envelope.entryPoint ?? undefined });
  if (!access.ok) return fail(access.reason);
  const target = resolveCanonicalReviewTarget(access, parsed);
  if (!target.ok) return fail(target.reason);
  if (!target.orderId || !target.orderLineId || !target.productId) return fail("INVALID_INPUT");
  const input = { ...parsed, orderId: target.orderId, orderLineId: target.orderLineId, productId: target.productId, variantId: target.variantId };
  try {
    const command = { shopId: access.shopId, customerProfileId: access.customerProfileId, source: access.source, reviewRequestId: access.reviewRequestId, input };
    const review = access.mode === "REVIEW_REQUEST_TOKEN" ? await submitEligibleReviewWithTokenConsumption({ ...command, reviewRequestId: access.reviewRequestId }) : await submitEligibleReview(command);
    console.info("review_submission_api_created", { shopId: access.shopId, reviewId: review.id, mode: access.mode, duration: Date.now() - started });
    return reply({ ok: true, review: publicReview(review), message: "Review submitted for moderation." }, 201);
  } catch (error) {
    if (error instanceof ReviewSubmissionInputError) return fail("INVALID_INPUT");
    if (error instanceof ReviewSubmissionDomainError) return fail(error.code);
    console.error("review_submission_api_rejected", { shopId: (access as ReviewSubmissionAccess & { shopId?: string }).shopId, mode: access.mode, errorCode: "INTERNAL_ERROR", duration: Date.now() - started });
    return fail("INTERNAL_ERROR");
  }
}
