import type { NextRequest } from "next/server";
import { resolveReviewAccessFromCustomerSession } from "../../../../../services/reviews/review-submission-access.ts";
import { getReviewSettings } from "../../../../../services/reviews/review-settings.ts";
import { listEligibleReviewPurchasesWithDiagnostics } from "../../../../../services/reviews/review-eligible-purchases.ts";
import { allowedOrigin, rateLimit, reply } from "../../../../../services/reviews/review-submission-http.ts";
import { normalizeShopifyProductId, shopifyProductIdCandidates } from "../../../../../services/reviews/shopify-product-id.ts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!allowedOrigin(request)) return reply({ ok: false, errorCode: "REVIEWS_UNAVAILABLE" }, 403);
  if (!rateLimit(request, "review-eligible-purchases", 30, 60_000)) return reply({ ok: false, errorCode: "RATE_LIMITED" }, 429);
  const productId = normalizeShopifyProductId(request.nextUrl.searchParams.get("productId"));
  if (!productId) return reply({ ok: false, errorCode: "PRODUCT_REQUIRED" }, 400);
  const access = await resolveReviewAccessFromCustomerSession({ request, source: "PRODUCT_PAGE" });
  if (!access.ok) return reply({ ok: false, errorCode: "UNAUTHENTICATED" }, 401);
  const settings = await getReviewSettings(access.shopId);
  if (!settings.reviewsEnabled) return reply({ ok: false, errorCode: "REVIEWS_DISABLED", purchases: [] }, 410);
  const result = await listEligibleReviewPurchasesWithDiagnostics({ shopId: access.shopId, customerProfileId: access.customerProfileId, productId, take: 25 });
  console.info("[REVIEW ELIGIBLE PURCHASES DIAGNOSTIC]", {
    shopId: access.shopId,
    customerProfileId: access.customerProfileId,
    normalizedProductId: productId,
    productIdCandidates: shopifyProductIdCandidates(productId),
    ...result.diagnostics,
  });
  const purchases = result.purchases.map(({ productTitle: _productTitle, productImageUrl: _productImageUrl, ...purchase }) => ({ ...purchase, eligible: true }));
  return reply({ ok: true, purchases });
}
