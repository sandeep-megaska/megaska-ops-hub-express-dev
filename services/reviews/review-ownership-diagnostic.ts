export type ReviewOwnershipFailurePredicate =
  | "AUTHENTICATED_PROFILE_MISSING"
  | "CANONICAL_PROFILE_MISSING"
  | "REVIEW_REQUEST_PROFILE_MISSING"
  | "ORDER_PROFILE_MISSING"
  | "REVIEW_REQUEST_PROFILE_NOT_CANONICAL"
  | "ORDER_PROFILE_NOT_CANONICAL"
  | "REVIEW_REQUEST_ORDER_PROFILE_MISMATCH"
  | "REVIEW_REQUEST_TENANT_MISMATCH"
  | "ORDER_TENANT_MISMATCH"
  | "MERGE_MAPPING_NOT_FOUND"
  | "MERGE_MAPPING_CONFLICT";

type Comparison = "PASS" | "FAIL" | "MISSING";
type SessionComparison = "PASS" | "FAIL" | "NOT_APPLICABLE";

export type ReviewOwnershipTrace = {
  authenticatedCustomerProfileId: string | null;
  canonicalCustomerProfileId: string | null;
  reviewRequestCustomerProfileId: string | null;
  canonicalReviewRequestCustomerProfileId: string | null;
  orderCustomerProfileId: string | null;
  canonicalOrderCustomerProfileId: string | null;
  authenticatedToCanonical: SessionComparison;
  reviewRequestToCanonical: Comparison;
  orderToCanonical: Comparison;
  reviewRequestToOrder: Comparison;
  canonicalReviewRequestToSession: Comparison;
  canonicalOrderToSession: Comparison;
  canonicalReviewRequestToOrder: Comparison;
  requestShopId: string;
  reviewRequestShopId: string | null;
  orderShopId: string | null;
  reviewRequestTenantMatch: boolean;
  orderTenantMatch: boolean;
  mergeLookupAttempted: boolean;
  mergeDetected: boolean;
  mergeSourceCustomerProfileId?: string;
  mergeTargetCustomerProfileId?: string;
  mergeLoopDetected: boolean;
  mergeDepthExceeded: boolean;
  failingPredicate: ReviewOwnershipFailurePredicate | null;
  reviewRequestId: string | null;
  orderId: string | null;
};

type Merge = { sourceCustomerProfileId: string; targetCustomerProfileId: string; shopId: string };
export type OwnershipDb = {
  customerProfile: { findFirst(args: unknown): Promise<{ id: string } | null> };
  customerIdentityMerge: { findMany(args: unknown): Promise<Merge[]> };
};

type CanonicalResolution = {
  rawId: string | null;
  canonicalId: string | null;
  lookupAttempted: boolean;
  detected: boolean;
  conflict: boolean;
  loop: boolean;
  depthExceeded: boolean;
  firstSource?: string;
  terminalTarget?: string;
};

const MAX_MERGE_DEPTH = 20;

/** Read-only, tenant-scoped merge traversal used only to explain ownership. */
export async function resolveCanonicalOwnership(db: OwnershipDb, shopId: string, rawId: string | null): Promise<CanonicalResolution> {
  if (!rawId) return { rawId, canonicalId: null, lookupAttempted: false, detected: false, conflict: false, loop: false, depthExceeded: false };
  const exists = await db.customerProfile.findFirst({ where: { id: rawId, shopId }, select: { id: true } });
  if (!exists) return { rawId, canonicalId: null, lookupAttempted: false, detected: false, conflict: false, loop: false, depthExceeded: false };

  let current = rawId;
  const visited = new Set([rawId]);
  let firstSource: string | undefined;
  for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
    const mappings = await db.customerIdentityMerge.findMany({
      where: { shopId, OR: [{ sourceCustomerProfileId: current }, { targetCustomerProfileId: current }] },
      select: { shopId: true, sourceCustomerProfileId: true, targetCustomerProfileId: true },
    });
    const outgoing = mappings.filter((mapping) => mapping.shopId === shopId && mapping.sourceCustomerProfileId === current);
    const targets = [...new Set(outgoing.map((mapping) => mapping.targetCustomerProfileId))];
    if (targets.length > 1) return { rawId, canonicalId: null, lookupAttempted: true, detected: true, conflict: true, loop: false, depthExceeded: false, firstSource: firstSource ?? current };
    if (!targets.length) return { rawId, canonicalId: current, lookupAttempted: true, detected: current !== rawId, conflict: false, loop: false, depthExceeded: false, firstSource, terminalTarget: current };
    firstSource ??= current;
    const target = targets[0];
    const targetExists = await db.customerProfile.findFirst({ where: { id: target, shopId }, select: { id: true } });
    if (!targetExists) return { rawId, canonicalId: null, lookupAttempted: true, detected: true, conflict: true, loop: false, depthExceeded: false, firstSource, terminalTarget: target };
    if (visited.has(target)) return { rawId, canonicalId: null, lookupAttempted: true, detected: true, conflict: true, loop: true, depthExceeded: false, firstSource, terminalTarget: target };
    visited.add(target);
    current = target;
  }
  return { rawId, canonicalId: null, lookupAttempted: true, detected: true, conflict: true, loop: false, depthExceeded: true, firstSource, terminalTarget: current };
}

const compare = (left: string | null, right: string | null): Comparison => !left || !right ? "MISSING" : left === right ? "PASS" : "FAIL";

export async function buildReviewOwnershipTrace(input: {
  shopId: string;
  authenticatedCustomerProfileId: string | null;
  reviewRequest: { id: string; shopId: string; customerProfileId: string | null } | null;
  order: { id: string; shopId: string; customerProfileId: string | null } | null;
}, db: OwnershipDb): Promise<ReviewOwnershipTrace> {
  const [session, request, order] = await Promise.all([
    resolveCanonicalOwnership(db, input.shopId, input.authenticatedCustomerProfileId),
    resolveCanonicalOwnership(db, input.shopId, input.reviewRequest?.customerProfileId ?? null),
    resolveCanonicalOwnership(db, input.shopId, input.order?.customerProfileId ?? null),
  ]);
  const reviewRequestTenantMatch = input.reviewRequest?.shopId === input.shopId && (!request.rawId || request.canonicalId !== null || request.conflict);
  const orderTenantMatch = input.order?.shopId === input.shopId && (!order.rawId || order.canonicalId !== null || order.conflict);
  const rawRequestToSession = compare(request.rawId, session.canonicalId);
  const rawOrderToSession = compare(order.rawId, session.canonicalId);
  const rawRequestToOrder = compare(request.rawId, order.rawId);
  const resolutions = [session, request, order];
  let failingPredicate: ReviewOwnershipFailurePredicate | null = null;
  if (!input.authenticatedCustomerProfileId) failingPredicate = "AUTHENTICATED_PROFILE_MISSING";
  else if (!session.canonicalId) failingPredicate = resolutions.some((item) => item.conflict) ? "MERGE_MAPPING_CONFLICT" : "CANONICAL_PROFILE_MISSING";
  else if (!input.reviewRequest?.customerProfileId) failingPredicate = "REVIEW_REQUEST_PROFILE_MISSING";
  else if (!input.order?.customerProfileId) failingPredicate = "ORDER_PROFILE_MISSING";
  else if (!reviewRequestTenantMatch) failingPredicate = "REVIEW_REQUEST_TENANT_MISMATCH";
  else if (!orderTenantMatch) failingPredicate = "ORDER_TENANT_MISMATCH";
  else if (resolutions.some((item) => item.conflict)) failingPredicate = "MERGE_MAPPING_CONFLICT";
  // These three predicates mirror the resolver's existing raw-ID gates. The
  // canonical comparisons below deliberately do not change eligibility.
  else if (rawRequestToSession !== "PASS") failingPredicate = "REVIEW_REQUEST_PROFILE_NOT_CANONICAL";
  else if (rawOrderToSession !== "PASS") failingPredicate = "ORDER_PROFILE_NOT_CANONICAL";
  else if (rawRequestToOrder !== "PASS") failingPredicate = "REVIEW_REQUEST_ORDER_PROFILE_MISMATCH";

  const detected = resolutions.find((item) => item.detected);
  return {
    authenticatedCustomerProfileId: session.rawId,
    canonicalCustomerProfileId: session.canonicalId,
    reviewRequestCustomerProfileId: request.rawId,
    canonicalReviewRequestCustomerProfileId: request.canonicalId,
    orderCustomerProfileId: order.rawId,
    canonicalOrderCustomerProfileId: order.canonicalId,
    authenticatedToCanonical: !session.rawId || !session.canonicalId ? "NOT_APPLICABLE" : session.rawId === session.canonicalId ? "PASS" : "FAIL",
    reviewRequestToCanonical: rawRequestToSession,
    orderToCanonical: rawOrderToSession,
    reviewRequestToOrder: rawRequestToOrder,
    canonicalReviewRequestToSession: compare(request.canonicalId, session.canonicalId),
    canonicalOrderToSession: compare(order.canonicalId, session.canonicalId),
    canonicalReviewRequestToOrder: compare(request.canonicalId, order.canonicalId),
    requestShopId: input.shopId,
    reviewRequestShopId: input.reviewRequest?.shopId ?? null,
    orderShopId: input.order?.shopId ?? null,
    reviewRequestTenantMatch,
    orderTenantMatch,
    mergeLookupAttempted: resolutions.some((item) => item.lookupAttempted),
    mergeDetected: resolutions.some((item) => item.detected),
    ...(detected?.firstSource ? { mergeSourceCustomerProfileId: detected.firstSource } : {}),
    ...(detected?.terminalTarget ? { mergeTargetCustomerProfileId: detected.terminalTarget } : {}),
    mergeLoopDetected: resolutions.some((item) => item.loop),
    mergeDepthExceeded: resolutions.some((item) => item.depthExceeded),
    failingPredicate,
    reviewRequestId: input.reviewRequest?.id ?? null,
    orderId: input.order?.id ?? null,
  };
}
