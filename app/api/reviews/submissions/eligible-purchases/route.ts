import type { NextRequest } from "next/server";
import { prisma } from "../../../../../services/db/prisma.ts";
import { resolveReviewAccessFromCustomerSession } from "../../../../../services/reviews/review-submission-access.ts";
import { getReviewSettings } from "../../../../../services/reviews/review-settings.ts";
import { isOrderDeliveredForReview } from "../../../../../services/orders/canonical-delivery.ts";
import { allowedOrigin, rateLimit, reply } from "../../../../../services/reviews/review-submission-http.ts";
import { normalizeShopifyProductId } from "../../../../../services/reviews/review-storefront-query.ts";

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
  const rows = await prisma.reviewRequest.findMany({
    where: { shopId: access.shopId, customerProfileId: access.customerProfileId, shopifyProductId: productId, suppressedAt: null, canceledAt: null },
    include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true, shopifyOrderName: true, deliveredAt: true, status: true } }, review: { select: { id: true } } },
    orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }],
    take: 25,
  });
  const purchases = rows
    .filter((row) => row.megaskaOrder && row.megaskaOrder.customerProfileId === access.customerProfileId && isOrderDeliveredForReview(row.megaskaOrder) && !row.review)
    .map((row) => ({ orderId: row.megaskaOrderId, orderLineId: row.shopifyLineItemId, productId: row.shopifyProductId, variantId: row.shopifyVariantId, variantTitle: row.variantTitleSnapshot, orderName: row.shopifyOrderName || row.megaskaOrder.shopifyOrderName, deliveredAt: (row.deliveredAtSnapshot || row.megaskaOrder.deliveredAt)?.toISOString() || null, eligible: true }));
  return reply({ ok: true, purchases });
}
