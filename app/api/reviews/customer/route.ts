import type { NextRequest } from "next/server";
import { listCustomerReviews } from "../../../../services/reviews/customer-review-query.ts";
import { resolveReviewAccessFromCustomerSession } from "../../../../services/reviews/review-submission-access.ts";
import { allowedOrigin, rateLimit, reply } from "../../../../services/reviews/review-submission-http.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEWS_UNAVAILABLE" }, 403);
  if (!rateLimit(request, "customer-reviews", 60, 60_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const access = await resolveReviewAccessFromCustomerSession({ request, source: "CUSTOMER_DASHBOARD" });
  if (!access.ok) return reply({ ok: false, errorCode: "UNAUTHENTICATED" }, 401);
  const data = await listCustomerReviews({ shopId: access.shopId, customerProfileId: access.customerProfileId, page: Number(request.nextUrl.searchParams.get("page")), pageSize: Number(request.nextUrl.searchParams.get("pageSize")) });
  return reply({ ok: true, ...data });
}
