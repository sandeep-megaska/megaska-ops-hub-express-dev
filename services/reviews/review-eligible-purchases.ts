import { prisma } from "../db/prisma.ts";
import { isOrderDeliveredForReview } from "../orders/canonical-delivery.ts";

type Db = typeof prisma;

export async function listEligibleReviewPurchases(input: { shopId: string; customerProfileId: string; productId?: string; take?: number }, db: Db = prisma) {
  const rows = await db.reviewRequest.findMany({
    where: { shopId: input.shopId, customerProfileId: input.customerProfileId, ...(input.productId ? { shopifyProductId: input.productId } : {}), suppressedAt: null, canceledAt: null, review: null },
    include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true, shopifyOrderName: true, deliveredAt: true, status: true } } },
    orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }],
    take: Math.min(25, Math.max(1, input.take ?? 20)),
  });
  return rows.filter((row) => row.megaskaOrder?.shopId === input.shopId && row.megaskaOrder.customerProfileId === input.customerProfileId && isOrderDeliveredForReview(row.megaskaOrder)).map((row) => ({ orderId: row.megaskaOrderId, orderLineId: row.shopifyLineItemId, productId: row.shopifyProductId, variantId: row.shopifyVariantId, productTitle: row.productTitleSnapshot, variantTitle: row.variantTitleSnapshot, productImageUrl: row.productImageUrlSnapshot, orderName: row.shopifyOrderName || row.megaskaOrder!.shopifyOrderName, deliveredAt: (row.deliveredAtSnapshot || row.megaskaOrder!.deliveredAt)?.toISOString() || null }));
}
