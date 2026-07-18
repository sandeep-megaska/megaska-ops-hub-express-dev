import { prisma } from "../db/prisma.ts";
import { isOrderDeliveredForReview } from "../orders/canonical-delivery.ts";

type Db = typeof prisma;

export type ReviewEligibilityDiagnostics = {
  reviewRequestCountBeforeCustomerProfileFilter: number;
  reviewRequestCountAfterCustomerProfileFilter: number;
  finalCountAfterCanonicalDeliveryChecks: number;
};

const baseWhere = (input: { shopId: string; productId?: string }) => ({
  shopId: input.shopId,
  ...(input.productId ? { shopifyProductId: input.productId } : {}),
  suppressedAt: null,
  canceledAt: null,
  review: null,
});

export async function listEligibleReviewPurchases(input: { shopId: string; customerProfileId: string; productId?: string; take?: number }, db: Db = prisma) {
  return (await listEligibleReviewPurchasesWithDiagnostics(input, db)).purchases;
}

export async function listEligibleReviewPurchasesWithDiagnostics(input: { shopId: string; customerProfileId: string; productId?: string; take?: number }, db: Db = prisma) {
  const where = baseWhere(input);
  const [reviewRequestCountBeforeCustomerProfileFilter, reviewRequestCountAfterCustomerProfileFilter, rows] = await Promise.all([
    db.reviewRequest.count({ where }),
    db.reviewRequest.count({ where: { ...where, customerProfileId: input.customerProfileId } }),
    db.reviewRequest.findMany({
      where: { ...where, customerProfileId: input.customerProfileId },
      include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true, shopifyOrderName: true, deliveredAt: true, status: true } } },
      orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }],
      take: Math.min(25, Math.max(1, input.take ?? 20)),
    }),
  ]);
  const purchases = rows.filter((row) => row.megaskaOrder?.shopId === input.shopId && row.megaskaOrder.customerProfileId === input.customerProfileId && isOrderDeliveredForReview(row.megaskaOrder)).map((row) => ({ orderId: row.megaskaOrderId, orderLineId: row.shopifyLineItemId, productId: row.shopifyProductId, variantId: row.shopifyVariantId, productTitle: row.productTitleSnapshot, variantTitle: row.variantTitleSnapshot, productImageUrl: row.productImageUrlSnapshot, orderName: row.shopifyOrderName || row.megaskaOrder!.shopifyOrderName, deliveredAt: (row.deliveredAtSnapshot || row.megaskaOrder!.deliveredAt)?.toISOString() || null }));
  return {
    purchases,
    diagnostics: {
      reviewRequestCountBeforeCustomerProfileFilter,
      reviewRequestCountAfterCustomerProfileFilter,
      finalCountAfterCanonicalDeliveryChecks: purchases.length,
    } satisfies ReviewEligibilityDiagnostics,
  };
}
