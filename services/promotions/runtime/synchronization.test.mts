/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { assembleFunctionConfiguration } from "./function-contract.ts";
import { synchronizePromotionFunctionConfiguration } from "./synchronization.server.ts";

function db(overrides = {}) {
  const state: any = { id: "s1", shopId: "shop-1", synchronizationState: "NEVER_SYNCED", lastDeployedConfigurationVersion: null };
  const calls: any[] = [];
  return { calls, state, ...overrides,
    shop: { findUnique: async () => ({ id: "shop-1", shopDomain: "test.myshopify.com" }) },
    promotionRule: { findMany: async () => [] },
    promotionRuntimeSyncState: {
      upsert: async () => ({ ...state }),
      update: async ({ data }: any) => Object.assign(state, data),
      updateMany: async ({ where, data }: any) => { calls.push({ where, data }); if (where.OR || where.synchronizationAttemptId === state.synchronizationAttemptId) { Object.assign(state, data); return { count: 1 }; } return { count: 0 }; },
    },
  } as any;
}

function graphql(log: any[], options: { ambiguous?: boolean; badReadback?: boolean } = {}) {
  let discount: any = null;
  return async (query: string, variables: any) => {
    log.push({ query, variables });
    if (query.includes("discountNodes")) return { discountNodes: { nodes: options.ambiguous ? [{ discount: { id: "d1", title: "LoopDesk Universal Promotions" } }, { discount: { id: "d2", title: "LoopDesk Universal Promotions" } }] : [] } };
    if (query.includes("discountAutomaticAppCreate")) { discount = { id: "gid://shopify/DiscountAutomaticApp/1", title: "LoopDesk Universal Promotions", discountClasses: ["PRODUCT"], appDiscountType: { functionId: "gid://shopify/AppFunction/1" } }; return { discountAutomaticAppCreate: { automaticAppDiscount: discount, userErrors: [] } }; }
    if (query.includes("metafieldsSet")) { discount.metafield = variables.metafields[0]; return { metafieldsSet: { metafields: [{ id: "mf1" }], userErrors: [] } }; }
    if (query.includes("node")) return { node: discount ? { ...discount, metafield: options.badReadback ? { ...discount.metafield, value: "{}" } : discount.metafield } : null };
    throw new Error("unexpected query");
  };
}

test("sync creates discount, writes metafield by ownerId, verifies read-back, then persists canonical id", async () => {
  const database = db(); const log: any[] = [];
  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });
  assert.equal(result.ok, true);
  const createVars = log.find((c) => c.query.includes("discountAutomaticAppCreate")).variables.automaticAppDiscount;
  assert.equal(createVars.functionHandle, "loopdesk-discount-function");
  assert.equal(createVars.title, "LoopDesk Universal Promotions");
  assert.deepEqual(createVars.discountClasses, ["PRODUCT"]);
  const metafield = log.find((c) => c.query.includes("metafieldsSet")).variables.metafields[0];
  assert.equal(metafield.ownerId, "gid://shopify/DiscountAutomaticApp/1");
  assert.equal(metafield.namespace, "$app:loopdesk-promotions");
  assert.equal(metafield.key, "function-config");
  assert.equal(metafield.type, "json");
  assert.deepEqual(JSON.parse(metafield.value), assembleFunctionConfiguration({ configurationVersion: 1, rules: [] }));
  assert.equal(database.state.shopifyAutomaticDiscountId, "gid://shopify/DiscountAutomaticApp/1");
});

test("sync rejects ambiguous canonical discount ownership matches", async () => {
  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database: db(), graphql: graphql([], { ambiguous: true }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("expected sync to fail");
  assert.match(result.message, /ambiguous/i);
});

test("sync does not persist success when canonical read-back verification fails", async () => {
  const database = db();
  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql([], { badReadback: true }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });
  assert.equal(result.ok, false);
  assert.notEqual(database.state.synchronizationState, "SYNCED");
});
