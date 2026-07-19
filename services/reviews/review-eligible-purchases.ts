import { prisma } from "../db/prisma.ts";
import { diagnoseOrderDeliveryForReview } from "../orders/canonical-delivery.ts";
import { normalizeShopifyProductId, shopifyProductIdCandidates } from "./shopify-product-id.ts";
import { buildReviewOwnershipTrace, resolveCanonicalOwnership, type ReviewOwnershipTrace } from "./review-ownership-diagnostic.ts";

type Purchase = { orderId: string; orderLineId: string; productId: string; variantId: string | null; productTitle: string; variantTitle: string | null; productImageUrl: string | null; orderName: string; deliveredAt: string | null; existingReviewFound: boolean };
type Row = { id: string; shopId: string; customerProfileId: string; megaskaOrderId: string; shopifyLineItemId: string; shopifyProductId: string; shopifyVariantId: string | null; productTitleSnapshot: string; variantTitleSnapshot: string | null; productImageUrlSnapshot: string | null; shopifyOrderName: string | null; deliveredAtSnapshot: Date | null; megaskaOrder: { id: string; shopId: string; customerProfileId: string; shopifyOrderName: string; deliveredAt: Date | null; status: string } | null; review: { id: string; customerProfileId: string | null } | null };
type Db = {
  customerProfile: { findFirst(args: unknown): Promise<{ id: string } | null> };
  customerIdentityMerge: { findMany(args: unknown): Promise<{ sourceCustomerProfileId: string; targetCustomerProfileId: string; shopId: string }[]> };
  reviewRequest: { findMany(args: unknown): Promise<Row[]> };
};
type DbInput = Db | typeof prisma;

export type ReviewEligibilityFailureCode =
  | "CUSTOMER_PROFILE_MISSING"
  | "CUSTOMER_PROFILE_MERGED"
  | "CUSTOMER_OWNERSHIP_MISMATCH"
  | "PRODUCT_IDENTIFIER_MISSING"
  | "PRODUCT_IDENTIFIER_MISMATCH"
  | "ORDER_NOT_FOUND"
  | "PRODUCT_NOT_FOUND_IN_ORDER"
  | "ORDER_NOT_DELIVERED"
  | "DELIVERY_STATE_UNRECOGNIZED"
  | "DELIVERED_AT_MISSING"
  | "REVIEW_REQUEST_NOT_FOUND"
  | "IDENTITY_CONFLICT";

export type ReviewEligibilityDiagnosticContext = {
  sessionCustomerProfileId: string;
  canonicalCustomerProfileId: string | null;
  productIdentifierType: "SHOPIFY_PRODUCT_ID";
  normalizedProductId: string | null;
  orderSourceQueried: "ReviewRequest+MegaskaOrder";
  requestSource: "PRODUCT_PAGE" | "CUSTOMER_DASHBOARD" | "DIAGNOSTIC_CLI";
  eligibleOrderFound: boolean;
  deliveredOrderFound: boolean;
  productLineFound: boolean;
  reviewRequestFound: boolean;
  existingReviewFound: boolean;
  identityMergeDetected: boolean;
  reviewRequestCountBeforeCustomerProfileFilter: number;
  reviewRequestCountAfterCustomerProfileFilter: number;
};

export type ReviewEligibilityDiagnostic =
  | { eligible: true; code: "ELIGIBLE"; customerProfileId: string; eligibleOrderId: string; eligibleOrderLineId: string; reviewRequestId: string; existingReviewId?: string; diagnosticContext: ReviewEligibilityDiagnosticContext; ownershipTrace: ReviewOwnershipTrace }
  | { eligible: false; code: ReviewEligibilityFailureCode; diagnosticContext: ReviewEligibilityDiagnosticContext; ownershipTrace?: ReviewOwnershipTrace };

type Input = { shopId: string; customerProfileId: string; productId?: string; take?: number; requestSource?: ReviewEligibilityDiagnosticContext["requestSource"] };
function context(input: Input, values: Partial<ReviewEligibilityDiagnosticContext> = {}): ReviewEligibilityDiagnosticContext {
  return {
    sessionCustomerProfileId: input.customerProfileId,
    canonicalCustomerProfileId: null,
    productIdentifierType: "SHOPIFY_PRODUCT_ID",
    normalizedProductId: normalizeShopifyProductId(input.productId),
    orderSourceQueried: "ReviewRequest+MegaskaOrder",
    requestSource: input.requestSource ?? "PRODUCT_PAGE",
    eligibleOrderFound: false,
    deliveredOrderFound: false,
    productLineFound: false,
    reviewRequestFound: false,
    existingReviewFound: false,
    identityMergeDetected: false,
    reviewRequestCountBeforeCustomerProfileFilter: 0,
    reviewRequestCountAfterCustomerProfileFilter: 0,
    ...values,
  };
}

async function canonicalCustomer(shopId: string, profileId: string, db: Db) {
  const resolution = await resolveCanonicalOwnership(db, shopId, profileId);
  return { customerProfileId: resolution.canonicalId, mergeDetected: resolution.detected, conflict: resolution.conflict };
}

/**
 * Staged purchase resolver used by the product-page loader. ReviewRequest is the
 * authoritative purchased-line snapshot; MegaskaOrder is authoritative for
 * ownership and canonical delivery. Existing review detection is deliberately
 * performed after purchase resolution and never removes a purchased line.
 */
export async function resolveReviewEligibility(input: Input, db: DbInput = prisma): Promise<{ diagnostics: ReviewEligibilityDiagnostic; purchases: Purchase[] }> {
  // Prisma's generic delegates derive their result from the query arguments, so
  // their method signatures are not structurally assignable to the narrow test
  // repository above even though this query selects the complete Row shape.
  const repository = db as unknown as Db;
  const normalizedProductId = normalizeShopifyProductId(input.productId);
  let diagnosticContext = context(input, { normalizedProductId });
  if (input.productId !== undefined && !normalizedProductId) return { purchases: [], diagnostics: { eligible: false, code: "PRODUCT_IDENTIFIER_MISSING", diagnosticContext } };

  const identity = await canonicalCustomer(input.shopId, input.customerProfileId, repository);
  diagnosticContext = { ...diagnosticContext, canonicalCustomerProfileId: identity.customerProfileId, identityMergeDetected: identity.mergeDetected };
  if (identity.conflict) return { purchases: [], diagnostics: { eligible: false, code: "IDENTITY_CONFLICT", diagnosticContext } };
  if (!identity.customerProfileId) return { purchases: [], diagnostics: { eligible: false, code: "CUSTOMER_PROFILE_MISSING", diagnosticContext } };

  const productWhere = { shopId: input.shopId, ...(normalizedProductId ? { shopifyProductId: { in: shopifyProductIdCandidates(normalizedProductId) } } : {}), suppressedAt: null, canceledAt: null };
  const [allProductRows, ownedRows] = await Promise.all([
    repository.reviewRequest.findMany({ where: productWhere, include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true, shopifyOrderName: true, deliveredAt: true, status: true } }, review: { select: { id: true, customerProfileId: true } } }, orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }], take: Math.min(25, Math.max(1, input.take ?? 20)) }),
    repository.reviewRequest.findMany({ where: { ...productWhere, customerProfileId: identity.customerProfileId }, include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true, shopifyOrderName: true, deliveredAt: true, status: true } }, review: { select: { id: true, customerProfileId: true } } }, orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }], take: Math.min(25, Math.max(1, input.take ?? 20)) }),
  ]) as unknown as [Row[], Row[]];
  diagnosticContext = { ...diagnosticContext, reviewRequestFound: allProductRows.length > 0, productLineFound: allProductRows.length > 0, reviewRequestCountBeforeCustomerProfileFilter: allProductRows.length, reviewRequestCountAfterCustomerProfileFilter: ownedRows.length };
  if (!allProductRows.length) return { purchases: [], diagnostics: { eligible: false, code: "PRODUCT_NOT_FOUND_IN_ORDER", diagnosticContext } };
  if (!ownedRows.length) {
    const candidate = allProductRows[0];
    const ownershipTrace = await buildReviewOwnershipTrace({ shopId: input.shopId, authenticatedCustomerProfileId: input.customerProfileId, reviewRequest: candidate, order: candidate.megaskaOrder }, repository);
    return { purchases: [], diagnostics: { eligible: false, code: "CUSTOMER_OWNERSHIP_MISMATCH", diagnosticContext, ownershipTrace } };
  }

  const tenantOwned = ownedRows.filter((row) => row.megaskaOrder?.shopId === input.shopId && row.megaskaOrder.customerProfileId === identity.customerProfileId);
  if (!tenantOwned.length) {
    const candidate = ownedRows[0];
    const ownershipTrace = await buildReviewOwnershipTrace({ shopId: input.shopId, authenticatedCustomerProfileId: input.customerProfileId, reviewRequest: candidate, order: candidate.megaskaOrder }, repository);
    return { purchases: [], diagnostics: { eligible: false, code: "CUSTOMER_OWNERSHIP_MISMATCH", diagnosticContext, ownershipTrace } };
  }
  const delivered = tenantOwned.filter((row) => diagnoseOrderDeliveryForReview(row.megaskaOrder!).delivered);
  diagnosticContext = { ...diagnosticContext, deliveredOrderFound: delivered.length > 0 };
  if (!delivered.length) {
    const delivery = diagnoseOrderDeliveryForReview(tenantOwned[0].megaskaOrder!);
    return { purchases: [], diagnostics: { eligible: false, code: delivery.delivered ? "ORDER_NOT_DELIVERED" : delivery.code, diagnosticContext } };
  }

  const purchases = delivered.map((row) => ({ orderId: row.megaskaOrderId, orderLineId: row.shopifyLineItemId, productId: row.shopifyProductId, variantId: row.shopifyVariantId, productTitle: row.productTitleSnapshot, variantTitle: row.variantTitleSnapshot, productImageUrl: row.productImageUrlSnapshot, orderName: row.shopifyOrderName || row.megaskaOrder!.shopifyOrderName, deliveredAt: (row.deliveredAtSnapshot || row.megaskaOrder!.deliveredAt)?.toISOString() || null, existingReviewFound: Boolean(row.review) }));
  const selected = delivered[0];
  const ownershipTrace = await buildReviewOwnershipTrace({ shopId: input.shopId, authenticatedCustomerProfileId: input.customerProfileId, reviewRequest: selected, order: selected.megaskaOrder }, repository);
  diagnosticContext = { ...diagnosticContext, eligibleOrderFound: true, existingReviewFound: delivered.some((row) => Boolean(row.review)) };
  return { purchases, diagnostics: { eligible: true, code: "ELIGIBLE", customerProfileId: identity.customerProfileId, eligibleOrderId: selected.megaskaOrderId, eligibleOrderLineId: selected.shopifyLineItemId, reviewRequestId: selected.id, ...(selected.review?.id ? { existingReviewId: selected.review.id } : {}), diagnosticContext, ownershipTrace } };
}

export async function listEligibleReviewPurchases(input: Input, db: DbInput = prisma) { return (await resolveReviewEligibility(input, db)).purchases; }
export const listEligibleReviewPurchasesWithDiagnostics = resolveReviewEligibility;
