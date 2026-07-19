import { prisma } from "../db/prisma.ts";
import type { getShopifyOrderForReviewSync, ShopifyReviewSourceOrder } from "../shopify/order-review-source.ts";
import { decideReviewCandidateLine, normalizeReviewText, normalizeVariantTitle, normalizeHttpsImageUrl } from "../reviews/review-candidate-policy.ts";
import type { createOrGetReviewRequest } from "../reviews/review-foundation.ts";
import { normalizeShopifyCustomerId, shopifyCustomerIdStorageForms } from "../../lib/shopify-customer-id.ts";
import { resolveShopifyCustomerProfile } from "../customers/shopify-profile.ts";

export type CanonicalShopifyOrderSyncErrorCode = "INVALID_ORDER_ID" | "SHOPIFY_ORDER_NOT_FOUND" | "SHOPIFY_CUSTOMER_REQUIRED";
export class CanonicalShopifyOrderSyncError extends Error {
  readonly code: CanonicalShopifyOrderSyncErrorCode;
  constructor(code: CanonicalShopifyOrderSyncErrorCode) { super(code); this.code = code; this.name = "CanonicalShopifyOrderSyncError"; }
}

type CanonicalOrder = { id: string; shopId: string; customerProfileId: string; shopifyOrderId: string | null; shopifyOrderName: string; status: string; deliveredAt: Date | null; metadata?: Record<string, unknown> | null };
type Customer = { id: string; shopId: string | null; shopifyCustomerId: string | null };
type SyncDb = {
  customerProfile: {
    findFirst(args: unknown): Promise<Customer | null>;
    create(args: unknown): Promise<Customer>;
  };
  megaskaOrder: {
    findFirst(args: unknown): Promise<CanonicalOrder | null>;
    create(args: unknown): Promise<CanonicalOrder>;
    update(args: unknown): Promise<CanonicalOrder>;
  };
};
type Dependencies = {
  db?: SyncDb;
  fetchOrder?: typeof getShopifyOrderForReviewSync;
  createOrderLine?: typeof createOrGetReviewRequest;
  resolveCustomer?: (input: { shopId: string; shopifyCustomerId: unknown }) => Promise<Customer>;
};

export function normalizeShopifyOrderIdentifier(value: unknown) {
  if (typeof value !== "string") throw new CanonicalShopifyOrderSyncError("INVALID_ORDER_ID");
  const identifier = value.trim();
  if (/^\d+$/.test(identifier)) return `gid://shopify/Order/${identifier}`;
  if (/^gid:\/\/shopify\/Order\/\d+$/.test(identifier)) return identifier;
  throw new CanonicalShopifyOrderSyncError("INVALID_ORDER_ID");
}

function canonicalStatus(source: ShopifyReviewSourceOrder) {
  if (source.cancelledAt) return "CANCELLED" as const;
  if (source.displayFinancialStatus === "REFUNDED") return "REFUNDED" as const;
  if (["IN_PROGRESS", "FULFILLED", "PARTIALLY_FULFILLED"].includes(source.displayFulfillmentStatus || "")) return "PROCESSING" as const;
  return "ORDER_CONFIRMED" as const;
}

/**
 * Canonical single-order ingestion. It intentionally creates no delivery event,
 * eligibility transition, review token, schedule, or notification.
 */
export async function syncCanonicalShopifyOrder(input: { shopId: string; shopDomain: string; orderIdentifier: string }, dependencies: Dependencies = {}) {
  const shopId = input.shopId.trim();
  const shopifyOrderId = normalizeShopifyOrderIdentifier(input.orderIdentifier);
  const db = dependencies.db ?? (prisma as unknown as SyncDb);
  const fetchOrder = dependencies.fetchOrder ?? (await import("../shopify/order-review-source.ts")).getShopifyOrderForReviewSync;
  const source = await fetchOrder({ shopDomain: input.shopDomain, shopifyOrderId });
  if (!source) throw new CanonicalShopifyOrderSyncError("SHOPIFY_ORDER_NOT_FOUND");
  if (!source.customerId) throw new CanonicalShopifyOrderSyncError("SHOPIFY_CUSTOMER_REQUIRED");

  const canonicalCustomerId = normalizeShopifyCustomerId(source.customerId);
  let customer: Customer;
  if (dependencies.resolveCustomer) customer = await dependencies.resolveCustomer({ shopId, shopifyCustomerId: canonicalCustomerId });
  else if (dependencies.db) {
    customer = await db.customerProfile.findFirst({ where: { shopId, shopifyCustomerId: { in: shopifyCustomerIdStorageForms(canonicalCustomerId) } } })
      ?? await db.customerProfile.create({ data: { shopId, shopifyCustomerId: canonicalCustomerId } });
  } else customer = await resolveShopifyCustomerProfile({ shopId, shopifyCustomerId: canonicalCustomerId });

  let order = await db.megaskaOrder.findFirst({ where: { shopId, OR: [{ shopifyOrderId: source.shopifyOrderId }, { shopifyOrderName: source.shopifyOrderName }] } });
  const data = {
    shopId,
    customerProfileId: customer.id,
    shopifyOrderId: source.shopifyOrderId,
    shopifyOrderName: source.shopifyOrderName,
    orderPlacedAt: source.processedAt ? new Date(source.processedAt) : source.createdAt ? new Date(source.createdAt) : null,
    status: order?.deliveredAt ? order.status : canonicalStatus(source),
    statusSource: `SHOPIFY:${source.displayFulfillmentStatus || "UNKNOWN"}`,
    statusUpdatedAt: new Date(),
    metadata: { shopifyFinancialStatus: source.displayFinancialStatus, shopifyFulfillmentStatus: source.displayFulfillmentStatus, shopifyDeliveredAt: source.deliveredAt },
  };
  order = order
    ? await db.megaskaOrder.update({ where: { id: order.id }, data })
    : await db.megaskaOrder.create({ data });

  const createOrderLine = dependencies.createOrderLine ?? (await import("../reviews/review-foundation.ts")).createOrGetReviewRequest;
  for (const line of source.lineItems) {
    const decision = source.cancelledAt ? { reviewable: false } : decideReviewCandidateLine(line);
    const title = normalizeReviewText(line.productTitle) ?? normalizeReviewText(line.title);
    if (!decision.reviewable || !line.shopifyProductId || !title) continue;
    await createOrderLine({
      shopId,
      customerProfileId: customer.id,
      megaskaOrderId: order.id,
      shopifyOrderId: source.shopifyOrderId,
      shopifyOrderName: source.shopifyOrderName,
      shopifyLineItemId: line.shopifyLineItemId,
      shopifyProductId: line.shopifyProductId,
      shopifyVariantId: line.shopifyVariantId ?? undefined,
      productTitleSnapshot: title,
      variantTitleSnapshot: normalizeVariantTitle(line.variantTitle) ?? undefined,
      productHandleSnapshot: normalizeReviewText(line.productHandle) ?? undefined,
      productImageUrlSnapshot: normalizeHttpsImageUrl(line.productImageUrl) ?? undefined,
      orderCreatedAt: source.createdAt ? new Date(source.createdAt) : null,
      deliveredAtSnapshot: order.deliveredAt,
    }, db as never);
  }
  return order;
}
