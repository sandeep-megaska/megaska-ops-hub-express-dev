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

function graphql(log: any[], options: { ambiguous?: boolean; badReadback?: boolean; expandedReadback?: boolean; storedNodeId?: string; createdNodeId?: string } = {}) {
  let discount: any = options.storedNodeId ? { id: options.storedNodeId, metafield: null, title: "LoopDesk Universal Promotions", discountClasses: ["PRODUCT"], appDiscountType: { functionId: "gid://shopify/AppFunction/1" } } : null;
  const node = (id: string, badReadback = false) => ({ id, metafield: discount?.metafield ? (badReadback ? { ...discount.metafield, value: "{}" } : { ...discount.metafield, namespace: options.expandedReadback ? "app--123456789--loopdesk-promotions" : discount.metafield.namespace }) : null, discount: { discountId: id, title: "LoopDesk Universal Promotions", status: "ACTIVE", discountClasses: discount?.discountClasses ?? ["PRODUCT"], combinesWith: discount?.combinesWith ?? { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true }, appDiscountType: { functionId: "gid://shopify/AppFunction/1" } } });
  return async (query: string, variables: any = {}) => {
    log.push({ query, variables });
    if (query.includes("shopifyFunctions")) return { shopifyFunctions: { nodes: [{ id: "gid://shopify/AppFunction/1", handle: "loopdesk-discount-function", title: "LoopDesk", apiType: "discounts" }] } };
    if (query.includes("discountNodes")) return { discountNodes: { nodes: options.ambiguous ? [node("gid://shopify/DiscountNode/1"), node("gid://shopify/DiscountNode/2")] : discount ? [node(discount.id)] : [] } };
    if (query.includes("discountAutomaticAppCreate")) { discount = { id: options.createdNodeId ?? "gid://shopify/DiscountNode/1", title: "LoopDesk Universal Promotions", discountClasses: ["PRODUCT"], appDiscountType: { functionId: "gid://shopify/AppFunction/1" } }; return { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: discount.id, title: discount.title, discountClasses: discount.discountClasses, appDiscountType: discount.appDiscountType }, userErrors: [] } }; }
    if (query.includes("discountAutomaticAppUpdate")) { discount = { ...discount, ...variables.automaticAppDiscount }; return { discountAutomaticAppUpdate: { automaticAppDiscount: { discountId: discount.id, title: discount.title, discountClasses: discount.discountClasses, combinesWith: discount.combinesWith, appDiscountType: discount.appDiscountType }, userErrors: [] } }; }
    if (query.includes("metafieldsSet")) { discount.metafield = variables.metafields[0]; return { metafieldsSet: { metafields: [{ id: "mf1" }], userErrors: [] } }; }
    if (query.includes("discountNode")) return { discountNode: discount?.id === variables.id ? node(variables.id, options.badReadback) : null };
    throw new Error("unexpected query");
  };
}

test("sync creates discount, writes metafield by ownerId, verifies read-back, then persists canonical id", async () => {
  const database = db(); const log: any[] = [];
  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log, { expandedReadback: true }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });
  assert.equal(result.ok, true);
  const createVars = log.find((c) => c.query.includes("discountAutomaticAppCreate")).variables.automaticAppDiscount;
  assert.equal(createVars.functionHandle, "loopdesk-discount-function");
  assert.equal(createVars.title, "LoopDesk Universal Promotions");
  assert.deepEqual(createVars.discountClasses, ["PRODUCT"]);
  const metafield = log.find((c) => c.query.includes("metafieldsSet")).variables.metafields[0];
  assert.equal(metafield.ownerId, "gid://shopify/DiscountNode/1");
  assert.equal(metafield.namespace, "$app:loopdesk-promotions");
  assert.equal(metafield.key, "function-config");
  assert.equal(metafield.type, "json");
  assert.deepEqual(JSON.parse(metafield.value), assembleFunctionConfiguration({ configurationVersion: 1, rules: [] }));
  assert.equal(database.state.shopifyAutomaticDiscountId, "gid://shopify/DiscountNode/1");
});


test("sync runtime payload includes offer product gid and handle for compiled READY promotions", async () => {
  const functionPayload = {
    schemaVersion: 1,
    ruleId: "rule-1",
    status: "ACTIVE",
    priority: 10,
    trigger: { type: "PRODUCT", matchMode: "ANY", minimumQuantity: 1, minimumCartSubtotal: null, sourceGroups: [{ sourceReferenceId: "ref-1", sourceType: "PRODUCT", sourceGid: "gid://shopify/Product/111", productGids: ["gid://shopify/Product/111"], unresolved: false }] },
    offer: { productGid: "gid://shopify/Product/999", handle: "offer-product" },
    reward: { type: "PERCENTAGE_OFF", value: "100", maximumQuantity: 1 },
  };
  const database = db();
  database.promotionRule = { findMany: async () => [{ id: "rule-1", status: "ACTIVE", priority: 10, currentCompilation: { version: 7, status: "READY", functionPayload } }] };
  const log: any[] = [];

  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });

  assert.equal(result.ok, true);
  const metafield = log.find((c) => c.query.includes("metafieldsSet")).variables.metafields[0];
  const payload = JSON.parse(metafield.value);
  assert.equal(payload.rules[0].offer.productGid, "gid://shopify/Product/999");
  assert.equal(payload.rules[0].offer.handle, "offer-product");
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

test("sync updates stored automatic discount when Shopify node still exists", async () => {
  const database = db();
  database.state.shopifyAutomaticDiscountId = "gid://shopify/DiscountNode/existing";
  const log: any[] = [];

  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log, { storedNodeId: "gid://shopify/DiscountNode/existing" }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.outcome, "UPDATED");
  assert.equal(log.some((call) => call.query.includes("discountAutomaticAppCreate")), false);
  assert.equal(log.find((call) => call.query.includes("metafieldsSet")).variables.metafields[0].ownerId, "gid://shopify/DiscountNode/existing");
  assert.equal(database.state.shopifyAutomaticDiscountId, "gid://shopify/DiscountNode/existing");
});

test("sync creates replacement automatic discount when stored Shopify node is missing", async () => {
  const database = db();
  database.state.shopifyAutomaticDiscountId = "gid://shopify/DiscountNode/stale";
  const log: any[] = [];

  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log, { createdNodeId: "gid://shopify/DiscountNode/replacement" }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.outcome, "CREATED");
  assert.equal(log.some((call) => call.query.includes("discountNodes")), false);
  assert.equal(log.find((call) => call.query.includes("discountAutomaticAppCreate")).variables.automaticAppDiscount.functionHandle, "loopdesk-discount-function");
  assert.deepEqual(log.find((call) => call.query.includes("discountAutomaticAppCreate")).variables.automaticAppDiscount.discountClasses, ["PRODUCT"]);
  assert.equal(log.find((call) => call.query.includes("metafieldsSet")).variables.metafields[0].ownerId, "gid://shopify/DiscountNode/replacement");
});

test("sync persists replacement ID instead of stale ID", async () => {
  const database = db();
  database.state.shopifyAutomaticDiscountId = "gid://shopify/DiscountNode/stale";

  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql([], { createdNodeId: "gid://shopify/DiscountNode/replacement" }) as any, clock: { now: () => new Date("2026-07-12T00:00:00Z") } });

  assert.equal(result.ok, true);
  assert.equal(database.state.shopifyAutomaticDiscountId, "gid://shopify/DiscountNode/replacement");
});

test("V2 combined configuration upgrades PRODUCT-only discount in place without creating a duplicate", async () => {
  const productPayload: any = { schemaVersion: 1, functionContractVersion: 2, ruleId: "product", status: "ACTIVE", priority: 1, trigger: { type: "PRODUCT", matchMode: "ANY", minimumQuantity: 1, minimumCartSubtotal: null, sourceGroups: [{ sourceReferenceId: "p", sourceType: "PRODUCT", sourceGid: "gid://shopify/Product/1", productGids: ["gid://shopify/Product/1"], unresolved: false }] }, offer: { productGid: "gid://shopify/Product/2", handle: null }, reward: { scope: "product", method: "percentage", configuration: { productGid: "gid://shopify/Product/2", value: "10", quantityCap: 1 } } };
  const orderPayload: any = { ...productPayload, ruleId: "order", priority: 2, offer: { productGid: "", handle: null }, reward: { scope: "order", method: "percentage", configuration: { selectionMode: "highest_eligible", continuityMode: "continuous", basis: "eligible_merchandise_subtotal", tiers: [{ id: "tier", minimumSubtotal: "0", percentage: "10" }] } } };
  const database = db(); database.state.shopifyAutomaticDiscountId = "gid://shopify/DiscountNode/existing";
  database.promotionRule = { findMany: async () => [{ id: "product", status: "ACTIVE", priority: 1, currentCompilation: { version: 1, status: "READY", functionPayload: productPayload } }, { id: "order", status: "ACTIVE", priority: 2, currentCompilation: { version: 1, status: "READY", functionPayload: orderPayload } }] };
  const log: any[] = [];
  const result = await synchronizePromotionFunctionConfiguration({ shopId: "shop-1" }, { database, graphql: graphql(log, { storedNodeId: "gid://shopify/DiscountNode/existing" }) as any });
  assert.equal(result.ok, true);
  assert.equal(log.some((call) => call.query.includes("discountAutomaticAppCreate")), false);
  const classUpdate = log.find((call) => call.query.includes("UpdateDiscountClasses"));
  assert.deepEqual(classUpdate.variables.automaticAppDiscount.discountClasses, ["PRODUCT", "ORDER"]);
  const published = JSON.parse(log.find((call) => call.query.includes("metafieldsSet")).variables.metafields[0].value);
  assert.equal(published.functionContractVersion, 2);
  assert.deepEqual(published.rules.map((rule: any) => rule.reward.scope), ["product", "order"]);
});
