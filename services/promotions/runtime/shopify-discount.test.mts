/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { assembleFunctionConfiguration } from "./function-contract.ts";
import { createAutomaticDiscount, findCanonicalAutomaticDiscount, readAutomaticDiscount, verifyDiscountOwnsCanonicalConfiguration, writeFunctionConfigurationMetafield } from "./shopify-discount.server.ts";

const ownerId = "gid://shopify/DiscountAutomaticNode/1";
const appDiscount = { title: "LoopDesk Universal Promotions", status: "ACTIVE", discountClasses: ["PRODUCT"], appDiscountType: { appKey: "loopdesk", functionId: "gid://shopify/AppFunction/1" } };
const metafield = { namespace: "$app:loopdesk-promotions", key: "function-config", type: "json", value: JSON.stringify(assembleFunctionConfiguration({ configurationVersion: 1, rules: [] })) };
function node(id = ownerId, overrides: any = {}) { return { id, metafield, discount: appDiscount, ...overrides }; }

test("readAutomaticDiscount flattens DiscountAutomaticNode owner fields and app discount fields", async () => {
  const calls: any[] = [];
  const snapshot = await readAutomaticDiscount(async (query: string, variables: any) => { calls.push({ query, variables }); return { node: node() }; }, "test.myshopify.com", ownerId);
  assert.equal(snapshot?.id, ownerId);
  assert.equal(snapshot?.metafield?.key, "function-config");
  assert.equal(snapshot?.title, "LoopDesk Universal Promotions");
  assert.deepEqual(snapshot?.discountClasses, ["PRODUCT"]);
  assert.match(calls[0].query, /\.\.\. on DiscountAutomaticNode/);
  assert.doesNotMatch(calls[0].query, /\.\.\. on DiscountAutomaticApp \{[^}]*\bid\b/s);
  assert.doesNotMatch(calls[0].query, /\.\.\. on DiscountAutomaticApp \{[^}]*\bmetafield\b/s);
});

test("findCanonicalAutomaticDiscount flattens search nodes before canonical title matching", async () => {
  const snapshot = await findCanonicalAutomaticDiscount(async () => ({ discountNodes: { nodes: [node(ownerId), node("gid://shopify/DiscountAutomaticNode/2", { discount: { ...appDiscount, title: "Other" } })] } }), null);
  assert.equal(snapshot?.id, ownerId);
  assert.equal(snapshot?.title, "LoopDesk Universal Promotions");
  assert.equal(snapshot?.metafield?.namespace, "$app:loopdesk-promotions");
});

test("createAutomaticDiscount resolves canonical node owner ID with lookup when create payload has no id", async () => {
  const calls: any[] = [];
  const snapshot = await createAutomaticDiscount(async (query: string, variables: any) => {
    calls.push({ query, variables });
    if (query.includes("discountAutomaticAppCreate")) return { discountAutomaticAppCreate: { automaticAppDiscount: appDiscount, userErrors: [] } };
    if (query.includes("discountNodes")) return { discountNodes: { nodes: [node()] } };
    throw new Error("unexpected query");
  }, null, "2026-07-12T00:00:00.000Z");
  assert.equal(snapshot.id, ownerId);
  assert.deepEqual(calls.map((call) => call.query.includes("discountAutomaticAppCreate") ? "create" : "search"), ["create", "search"]);
  assert.doesNotMatch(calls[0].query, /automaticAppDiscount \{[^}]*\bid\b/s);
});

test("writeFunctionConfigurationMetafield uses DiscountAutomaticNode ownerId and verification reads canonical metafield", async () => {
  const config = assembleFunctionConfiguration({ configurationVersion: 1, rules: [] });
  let written: any;
  await writeFunctionConfigurationMetafield(async (_query: string, variables: any) => { written = variables.metafields[0]; return { metafieldsSet: { metafields: [{ id: "mf1" }], userErrors: [] } }; }, null, ownerId, config);
  assert.equal(written.ownerId, ownerId);
  assert.equal(written.namespace, "$app:loopdesk-promotions");
  assert.equal(written.key, "function-config");
  verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { namespace: written.namespace, key: written.key, type: written.type, value: written.value } }, config);
});

test("findCanonicalAutomaticDiscount rejects duplicate canonical node titles", async () => {
  await assert.rejects(() => findCanonicalAutomaticDiscount(async () => ({ discountNodes: { nodes: [node(ownerId), node("gid://shopify/DiscountAutomaticNode/2")] } }), null), /ambiguous/i);
});
