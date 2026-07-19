import { prisma } from "../db/prisma.ts";
import { isOrderDeliveredForReview } from "../orders/canonical-delivery.ts";
import { getReviewSettings } from "./review-settings.ts";

export type ReviewSubmissionEligibilityInput = { shopId: string; customerProfileId: string; orderId: string; orderLineId: string; productId: string; variantId?: string | null };
export type ReviewSubmissionEligibilityReason = "REVIEWS_DISABLED" | "CUSTOMER_NOT_FOUND" | "ORDER_NOT_FOUND" | "ORDER_NOT_OWNED" | "ORDER_NOT_DELIVERED" | "ORDER_LINE_NOT_FOUND" | "PRODUCT_MISMATCH" | "VARIANT_MISMATCH" | "ALREADY_REVIEWED";
export type ReviewSubmissionEligibilityResult = { eligible: true; verifiedPurchase: true; shopId: string; customerProfileId: string; orderId: string; orderLineId: string; productId: string; variantId: string | null; productTitle: string; variantTitle: string | null; orderName: string | null } | { eligible: false; reason: ReviewSubmissionEligibilityReason };

type Settings = { reviewsEnabled: boolean };
type Customer = { id: string; shopId: string | null };
type Order = { id: string; shopId: string; customerProfileId: string; shopifyOrderId?: string | null; shopifyOrderName?: string | null; deliveredAt: Date | null; status: string };
type OrderLine = { id: string; shopId: string; customerProfileId: string; megaskaOrderId: string; shopifyOrderId: string; shopifyLineItemId: string; shopifyProductId: string; shopifyVariantId: string | null; productTitleSnapshot?: string; variantTitleSnapshot?: string | null; shopifyOrderName?: string | null };
type ExistingReview = { id: string; status: string };
export type ReviewSubmissionEligibilityDependencies = {
  getReviewSettings?: (shopId: string) => Promise<Settings>;
  findCustomer?: (input: { shopId: string; customerProfileId: string }) => Promise<Customer | null>;
  findOrder?: (input: { shopId: string; orderId: string }) => Promise<Order | null>;
  findOrderLine?: (input: { shopId: string; orderId: string; orderLineId: string }) => Promise<OrderLine | null>;
  findExistingReview?: (input: { shopId: string; customerProfileId: string; orderLineId: string }) => Promise<ExistingReview | null>;
  isDelivered?: (order: Order) => boolean;
};

type Db = { customerProfile: { findFirst(args: unknown): Promise<Customer | null> }; megaskaOrder: { findFirst(args: unknown): Promise<Order | null> }; reviewRequest: { findFirst(args: unknown): Promise<OrderLine | null> }; productReview: { findFirst(args: unknown): Promise<ExistingReview | null> }; reviewSettings?: unknown; shop?: unknown };
function id(value: string | null | undefined) { return value?.trim() || ""; }
function defaults(db: Db): Required<Omit<ReviewSubmissionEligibilityDependencies, "isDelivered">> & { isDelivered: (order: Order) => boolean } {
  return {
    getReviewSettings: (shopId) => getReviewSettings(shopId, db as never),
    findCustomer: ({ shopId, customerProfileId }) => db.customerProfile.findFirst({ where: { id: customerProfileId, shopId }, select: { id: true, shopId: true } }) as Promise<Customer | null>,
    findOrder: ({ shopId, orderId }) => db.megaskaOrder.findFirst({ where: { id: orderId, shopId }, select: { id: true, shopId: true, customerProfileId: true, shopifyOrderId: true, shopifyOrderName: true, deliveredAt: true, status: true } }) as Promise<Order | null>,
    findOrderLine: async ({ shopId, orderId, orderLineId }) => {
      const request = await db.reviewRequest.findFirst({ where: { shopId, megaskaOrderId: orderId, shopifyLineItemId: orderLineId }, select: { id: true, shopId: true, customerProfileId: true, megaskaOrderId: true, shopifyOrderId: true, shopifyOrderName: true, shopifyLineItemId: true, shopifyProductId: true, shopifyVariantId: true, productTitleSnapshot: true, variantTitleSnapshot: true } });
      return request ? { ...request, shopifyVariantId: request.shopifyVariantId ?? null } : null;
    },
    findExistingReview: ({ shopId, customerProfileId, orderLineId }) => db.productReview.findFirst({ where: { shopId, customerProfileId, shopifyLineItemId: orderLineId, status: { in: ["PENDING_MODERATION", "PUBLISHED", "REJECTED"] } }, select: { id: true, status: true } }) as Promise<ExistingReview | null>,
    isDelivered: isOrderDeliveredForReview,
  };
}

export async function evaluateReviewSubmissionEligibility(input: ReviewSubmissionEligibilityInput, dependencies: ReviewSubmissionEligibilityDependencies & { db?: Db } = {}): Promise<ReviewSubmissionEligibilityResult> {
  const deps = { ...defaults(dependencies.db ?? prisma as unknown as Db), ...dependencies };
  const shopId = id(input.shopId), customerProfileId = id(input.customerProfileId), orderId = id(input.orderId), orderLineId = id(input.orderLineId), productId = id(input.productId), variantId = id(input.variantId) || null;
  const settings = await deps.getReviewSettings(shopId);
  if (!settings.reviewsEnabled) return { eligible: false, reason: "REVIEWS_DISABLED" };
  const customer = await deps.findCustomer({ shopId, customerProfileId });
  if (!customer || customer.shopId !== shopId) return { eligible: false, reason: "CUSTOMER_NOT_FOUND" };
  const order = await deps.findOrder({ shopId, orderId });
  if (!order || order.shopId !== shopId) return { eligible: false, reason: "ORDER_NOT_FOUND" };
  if (order.customerProfileId !== customerProfileId) return { eligible: false, reason: "ORDER_NOT_OWNED" };
  if (!deps.isDelivered(order)) return { eligible: false, reason: "ORDER_NOT_DELIVERED" };
  const line = await deps.findOrderLine({ shopId, orderId: order.id, orderLineId });
  if (!line || line.shopId !== shopId || line.megaskaOrderId !== order.id) return { eligible: false, reason: "ORDER_LINE_NOT_FOUND" };
  if (line.shopifyProductId !== productId) return { eligible: false, reason: "PRODUCT_MISMATCH" };
  const canonicalVariantId = id(line.shopifyVariantId) || null;
  if (variantId && canonicalVariantId && variantId !== canonicalVariantId) return { eligible: false, reason: "VARIANT_MISMATCH" };
  if (await deps.findExistingReview({ shopId, customerProfileId, orderLineId: line.shopifyLineItemId })) return { eligible: false, reason: "ALREADY_REVIEWED" };
  const productTitle = id(line.productTitleSnapshot);
  if (!productTitle) return { eligible: false, reason: "ORDER_LINE_NOT_FOUND" };
  return { eligible: true, verifiedPurchase: true, shopId, customerProfileId, orderId: order.id, orderLineId: line.shopifyLineItemId, productId: line.shopifyProductId, variantId: canonicalVariantId, productTitle, variantTitle: id(line.variantTitleSnapshot) || null, orderName: id(line.shopifyOrderName) || id(order.shopifyOrderName) || null };
}
