import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewOwnershipTrace } from "./review-ownership-diagnostic.ts";

type Merge = { shopId: string; sourceCustomerProfileId: string; targetCustomerProfileId: string };
const makeDb = (profiles: Record<string, string>, merges: Merge[] = []) => ({
  customerProfile: { findFirst: async (args: unknown) => { const { where } = args as { where: { id: string; shopId: string } }; return profiles[where.id] === where.shopId ? { id: where.id } : null; } },
  customerIdentityMerge: { findMany: async (args: unknown) => { const { where } = args as { where: { shopId: string; OR: Array<{ sourceCustomerProfileId?: string; targetCustomerProfileId?: string }> } }; return merges.filter((merge) => merge.shopId === where.shopId && where.OR.some((part) => part.sourceCustomerProfileId === merge.sourceCustomerProfileId || part.targetCustomerProfileId === merge.targetCustomerProfileId)); } },
});
const trace = (owners: { session?: string | null; request?: string | null; order?: string | null; requestShop?: string; orderShop?: string }, profiles: Record<string, string>, merges: Merge[] = []) => buildReviewOwnershipTrace({
  shopId: "shop", authenticatedCustomerProfileId: owners.session === undefined ? "canonical" : owners.session,
  reviewRequest: { id: "request", shopId: owners.requestShop ?? "shop", customerProfileId: owners.request === undefined ? "canonical" : owners.request },
  order: { id: "order", shopId: owners.orderShop ?? "shop", customerProfileId: owners.order === undefined ? "canonical" : owners.order },
}, makeDb(profiles, merges));

const baseProfiles = { canonical: "shop", source: "shop", unrelated: "shop", foreign: "other" };
const sourceMerge = [{ shopId: "shop", sourceCustomerProfileId: "source", targetCustomerProfileId: "canonical" }];

test("exact ownership matches every raw and canonical predicate", async () => {
  const result = await trace({}, baseProfiles);
  assert.equal(result.failingPredicate, null);
  assert.equal(result.reviewRequestToCanonical, "PASS");
  assert.equal(result.orderToCanonical, "PASS");
  assert.equal(result.reviewRequestToOrder, "PASS");
});

test("historical source order reports raw mismatch and canonical match without changing the gate", async () => {
  const result = await trace({ order: "source" }, baseProfiles, sourceMerge);
  assert.equal(result.orderToCanonical, "FAIL");
  assert.equal(result.canonicalOrderToSession, "PASS");
  assert.equal(result.mergeDetected, true);
  assert.equal(result.failingPredicate, "ORDER_PROFILE_NOT_CANONICAL");
});

test("historical source ReviewRequest is canonicalized but retains its raw mismatch", async () => {
  const result = await trace({ request: "source" }, baseProfiles, sourceMerge);
  assert.equal(result.reviewRequestToCanonical, "FAIL");
  assert.equal(result.canonicalReviewRequestToSession, "PASS");
  assert.equal(result.failingPredicate, "REVIEW_REQUEST_PROFILE_NOT_CANONICAL");
});

test("unrelated order has a predicate-specific failure", async () => {
  assert.equal((await trace({ order: "unrelated" }, baseProfiles)).failingPredicate, "ORDER_PROFILE_NOT_CANONICAL");
});

test("cross-tenant order and cross-tenant owner fail before profile equality", async () => {
  assert.equal((await trace({ orderShop: "other" }, baseProfiles)).failingPredicate, "ORDER_TENANT_MISMATCH");
  assert.equal((await trace({ order: "foreign" }, baseProfiles)).failingPredicate, "ORDER_TENANT_MISMATCH");
});

test("conflicting mappings fail safely", async () => {
  const profiles = { ...baseProfiles, other: "shop" };
  const merges = [...sourceMerge, { shopId: "shop", sourceCustomerProfileId: "source", targetCustomerProfileId: "other" }];
  const result = await trace({ order: "source" }, profiles, merges);
  assert.equal(result.failingPredicate, "MERGE_MAPPING_CONFLICT");
  assert.equal(result.canonicalOrderCustomerProfileId, null);
});

test("merge loops terminate with an explicit conflict", async () => {
  const merges = [...sourceMerge, { shopId: "shop", sourceCustomerProfileId: "canonical", targetCustomerProfileId: "source" }];
  const result = await trace({}, baseProfiles, merges);
  assert.equal(result.mergeLoopDetected, true);
  assert.equal(result.failingPredicate, "MERGE_MAPPING_CONFLICT");
});

test("missing ownership field is not collapsed into a generic mismatch", async () => {
  assert.equal((await trace({ order: null }, baseProfiles)).failingPredicate, "ORDER_PROFILE_MISSING");
});
