import type { NextRequest } from "next/server";
import { resolveReviewSubmissionAccess, resolveCanonicalReviewTarget } from "../../../../../services/reviews/review-submission-access.ts";
import { evaluateReviewSubmissionEligibility } from "../../../../../services/reviews/review-submission-eligibility.ts";
import { allowedOrigin, rateLimit, reply, requireReviewProxy } from "../../../../../services/reviews/review-submission-http.ts";

export const dynamic = "force-dynamic";

function status(reason: string) { return reason === "UNAUTHENTICATED" ? 401 : reason === "TOKEN_CONSUMED" || reason === "ALREADY_REVIEWED" ? 409 : reason === "EXPIRED_TOKEN" || reason === "TOKEN_REVOKED" || reason === "REQUEST_NOT_ELIGIBLE" || reason === "REVIEWS_DISABLED" ? 410 : 404; }

export async function GET(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "INVALID_TOKEN" }, 403);
  if (!rateLimit(request, "review-eligibility", 30, 60_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const shop = await requireReviewProxy(request).catch(() => null);
  const accessToken = request.nextUrl.searchParams.get("accessToken") || request.nextUrl.searchParams.get("token");
  const access = await resolveReviewSubmissionAccess({ request, accessToken, sessionSource: "PRODUCT_PAGE", shopId: shop?.id });
  if (!access.ok) return reply({ ok: false, errorCode: access.reason }, status(access.reason));
  const target = resolveCanonicalReviewTarget(access, { orderId: request.nextUrl.searchParams.get("orderId"), orderLineId: request.nextUrl.searchParams.get("orderLineId"), productId: request.nextUrl.searchParams.get("productId"), variantId: request.nextUrl.searchParams.get("variantId") });
  if (!target.ok) return reply({ ok: false, errorCode: target.reason }, 403);
  const result = await evaluateReviewSubmissionEligibility({ shopId: access.shopId, customerProfileId: access.customerProfileId, orderId: target.orderId || "", orderLineId: target.orderLineId || "", productId: target.productId || "", variantId: target.variantId });
  return result.eligible ? reply({ ok: true, eligible: true, purchase: { orderId: result.orderId, orderLineId: result.orderLineId, productId: result.productId, variantId: result.variantId, eligible: true } }) : reply({ ok: false, eligible: false, errorCode: result.reason }, status(result.reason));
}
