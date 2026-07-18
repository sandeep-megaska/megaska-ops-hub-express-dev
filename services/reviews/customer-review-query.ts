import { prisma } from "../db/prisma.ts";
import { getReviewSettings } from "./review-settings.ts";
import { listEligibleReviewPurchases } from "./review-eligible-purchases.ts";

type Db = typeof prisma;

export function customerReviewPage(input: { page?: number; pageSize?: number }) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(input.pageSize) || 10)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function listCustomerReviews(input: { shopId: string; customerProfileId: string; page?: number; pageSize?: number }, db: Db = prisma) {
  const pagination = customerReviewPage(input);
  const scope = { shopId: input.shopId, customerProfileId: input.customerProfileId };
  const [settings, totalCount, reviews, candidates] = await Promise.all([
    getReviewSettings(input.shopId, db),
    db.productReview.count({ where: scope }),
    db.productReview.findMany({
      where: scope,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: pagination.skip,
      take: pagination.pageSize,
      select: { id: true, shopifyProductId: true, shopifyVariantId: true, productTitleSnapshot: true, variantTitleSnapshot: true, rating: true, title: true, body: true, verifiedPurchase: true, status: true, submittedAt: true, publishedAt: true, reviewRequest: { select: { productImageUrlSnapshot: true, shopifyOrderName: true } }, megaskaOrder: { select: { shopifyOrderName: true } } },
    }),
    listEligibleReviewPurchases({ ...scope, take: 20 }, db),
  ]);
  const totalPages = Math.ceil(totalCount / pagination.pageSize);
  return {
    reviewsEnabled: settings.reviewsEnabled,
    reviews: reviews.map((review) => ({ id: review.id, productId: review.shopifyProductId, variantId: review.shopifyVariantId, productTitle: review.productTitleSnapshot, variantTitle: review.variantTitleSnapshot, productImageUrl: review.reviewRequest?.productImageUrlSnapshot ?? null, orderName: review.reviewRequest?.shopifyOrderName || review.megaskaOrder?.shopifyOrderName || null, rating: review.rating, title: review.title, body: review.body, verifiedPurchase: review.verifiedPurchase, status: review.status, submittedAt: review.submittedAt.toISOString(), publishedAt: review.publishedAt?.toISOString() ?? null })),
    awaitingReviews: settings.reviewsEnabled ? candidates : [],
    pagination: { page: pagination.page, pageSize: pagination.pageSize, totalCount, totalPages, hasNextPage: pagination.page < totalPages, hasPreviousPage: pagination.page > 1 },
  };
}
