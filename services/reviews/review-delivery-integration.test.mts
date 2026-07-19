import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeDeliveredOrderReviewCandidatesBestEffort } from "./review-delivery-integration.ts";

test("forwards canonical identity after delivery", async () => {
  let received: unknown;
  const outcome = await synchronizeDeliveredOrderReviewCandidatesBestEffort(
    { shopId: "shop-1", megaskaOrderId: "order-1", shopDomain: "store.myshopify.com", now: new Date("2026-07-19T00:00:00Z") },
    { sync: async (input) => { received = input; return { status: "SYNCED" } as never; } },
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(received, { shopId: "shop-1", megaskaOrderId: "order-1", shopDomain: "store.myshopify.com", now: new Date("2026-07-19T00:00:00Z") });
});

test("contains failures and logs only safe structured fields", async () => {
  let logged: unknown;
  const outcome = await synchronizeDeliveredOrderReviewCandidatesBestEffort(
    { shopId: "shop-1", megaskaOrderId: "order-1", shopDomain: "store.myshopify.com" },
    { sync: async () => { throw Object.assign(new Error("customer@example.com"), { code: "REVIEW_SOURCE_GRAPHQL_FAILED" }); }, log: (event) => { logged = event; } },
  );
  assert.deepEqual(outcome, { ok: false, errorCode: "REVIEW_SOURCE_GRAPHQL_FAILED" });
  assert.deepEqual(logged, { event: "review_candidate_sync_after_delivery_failed", shopId: "shop-1", megaskaOrderId: "order-1", errorCode: "REVIEW_SOURCE_GRAPHQL_FAILED" });
  assert.doesNotMatch(JSON.stringify(logged), /customer@example/);
});
