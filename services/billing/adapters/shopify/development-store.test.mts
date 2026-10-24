import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { isDevelopmentStore, SHOP_PLAN_QUERY } from "./development-store.ts";

const answer = (value: unknown) => async <T,>() => value as T;

test("development stores get test charges; paid stores and failed lookups get real ones", async () => {
  assert.equal(await isDevelopmentStore(answer({ shop: { plan: { partnerDevelopment: true } } }), "dev.myshopify.com"), true);
  assert.equal(await isDevelopmentStore(answer({ shop: { plan: { partnerDevelopment: false } } }), "paid.myshopify.com"), false);
  assert.equal(await isDevelopmentStore(answer({ shop: null }), "x.myshopify.com"), false);
  assert.equal(await isDevelopmentStore(async () => { throw new Error("network"); }, "x.myshopify.com"), false);
  const calls: Array<{ query: string; shopDomain: string }> = [];
  await isDevelopmentStore(async <T,>(query: string, _variables: Record<string, unknown>, options: { shopDomain: string }) => { calls.push({ query, shopDomain: options.shopDomain }); return {} as T; }, "dev.myshopify.com");
  assert.deepEqual(calls, [{ query: SHOP_PLAN_QUERY, shopDomain: "dev.myshopify.com" }]);
});

test("subscriptions use the development-store check unless the caller sets test", () => {
  const adapter = fs.readFileSync(new URL("./shopify-billing-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /const testCharge = input\.test \?\? \(await isDevelopmentStore\(this\.execute, shopDomain\)\);/);
  assert.match(adapter, /trialDays: input\.trialDays \?\? null, test: testCharge \}/);
});
