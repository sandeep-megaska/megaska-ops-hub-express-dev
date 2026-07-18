import type { NextRequest } from "next/server";
import { resolveCanonicalReviewTarget, resolveReviewSubmissionAccess } from "../../../../../services/reviews/review-submission-access.ts";
import { evaluateReviewSubmissionEligibility } from "../../../../../services/reviews/review-submission-eligibility.ts";
import { allowedOrigin, rateLimit, reply } from "../../../../../services/reviews/review-submission-http.ts";
import { reviewSubmissionEntryPoints, reviewSubmissionErrorStatus, reviewSubmissionMessage } from "../../../../../services/reviews/review-submission-api.ts";

export const dynamic = "force-dynamic";

const allowedQueryFields = new Set(["productId", "variantId", "orderId", "orderLineId", "accessToken", "entryPoint"]);
function fail(errorCode: string) { return reply({ ok: false, errorCode, message: reviewSubmissionMessage(errorCode) }, reviewSubmissionErrorStatus(errorCode)); }
function targetFromParams(params: URLSearchParams) { return { productId: params.get("productId"), variantId: params.get("variantId"), orderId: params.get("orderId"), orderLineId: params.get("orderLineId") }; }
export function eligibilityMessage(reason: string) { return reviewSubmissionMessage(reason); }

export async function GET(request: NextRequest) {
  if (!allowedOrigin(request)) return fail("UNAUTHENTICATED");
  if (!rateLimit(request, "review-submission-eligibility", 30, 900_000)) return fail("RATE_LIMITED");
  const params = new URL(request.url).searchParams;
  for (const field of params.keys()) if (!allowedQueryFields.has(field)) return fail("INVALID_INPUT");
  const accessToken = params.get("accessToken");
  const entryPoint = params.get("entryPoint");
  if (!accessToken && (!entryPoint || !reviewSubmissionEntryPoints.has(entryPoint))) return fail("INVALID_INPUT");
  if (entryPoint && !reviewSubmissionEntryPoints.has(entryPoint)) return fail("INVALID_INPUT");
  const access = await resolveReviewSubmissionAccess({ request, accessToken, sessionSource: entryPoint as "CUSTOMER_DASHBOARD" | "PRODUCT_PAGE" | undefined });
  if (!access.ok) return fail(access.reason);
  const target = resolveCanonicalReviewTarget(access, targetFromParams(params));
  if (!target.ok) return fail(target.reason);
  if (!target.orderId || !target.orderLineId || !target.productId) return fail("INVALID_INPUT");
  const eligibility = await evaluateReviewSubmissionEligibility({ shopId: access.shopId, customerProfileId: access.customerProfileId, orderId: target.orderId, orderLineId: target.orderLineId, productId: target.productId, variantId: target.variantId });
  console.info("review_submission_eligibility_api_checked", { shopId: access.shopId, mode: access.mode, eligible: eligibility.eligible });
  if (!eligibility.eligible) return reply({ ok: true, eligible: false, reason: eligibility.reason, message: eligibilityMessage(eligibility.reason) });
  return reply({ ok: true, eligible: true, verifiedPurchase: true, target: { productId: eligibility.productId, variantId: eligibility.variantId, orderId: eligibility.orderId, orderLineId: eligibility.orderLineId } });
}
