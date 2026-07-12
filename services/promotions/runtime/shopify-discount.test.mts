/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { assembleFunctionConfiguration } from "./function-contract.ts";
import { createAutomaticDiscount, findCanonicalAutomaticDiscount, readAutomaticDiscount, verifyDiscountOwnsCanonicalConfiguration, writeFunctionConfigurationMetafield } from "./shopify-discount.server.ts";

const ownerId = "gid://shopify/DiscountNode/1";
const appDiscount = { discountId: ownerId, title: "LoopDesk Universal Promotions", status: "ACTIVE", discountClasses: ["PRODUCT"], appDiscountType: { appKey: "loopdesk", functionId: "gid://shopify/AppFunction/1" } };
const metafield = { namespace: "$app:loopdesk-promotions", key: "function-config", type: "json", value: JSON.stringify(assembleFunctionConfiguration({ configurationVersion: 1, rules: [] })) };
const expandedNamespace = "app--123456789--loopdesk-promotions";
function node(id = ownerId, overrides: any = {}) { return { id, metafield, discount: appDiscount, ...overrides }; }

test("readAutomaticDiscount uses DiscountNode and flattens owner fields and app discount fields", async () => {
  const calls: any[] = [];
  const snapshot = await readAutomaticDiscount(async (query: string, variables: any) => { calls.push({ query, variables }); return { discountNode: node() }; }, "test.myshopify.com", ownerId);
  assert.equal(snapshot?.id, ownerId);
  assert.equal(snapshot?.metafield?.key, "function-config");
  assert.equal(snapshot?.title, "LoopDesk Universal Promotions");
  assert.deepEqual(snapshot?.discountClasses, ["PRODUCT"]);
  assert.match(calls[0].query, /discountNode\(id: \$id\)/);
  assert.doesNotMatch(calls[0].query, /\bnode\(id: \$id\)/);
  assert.doesNotMatch(calls[0].query, /\.\.\. on DiscountAutomaticNode/);
  assert.match(calls[0].query, /discount \{\s*\.\.\. on DiscountAutomaticApp/s);
  assert.match(calls[0].query, /\.\.\. on DiscountAutomaticApp \{[^}]*\bdiscountId\b/s);
  assert.doesNotMatch(calls[0].query, /\.\.\. on DiscountAutomaticApp \{[^}]*\bid\b/s);
  assert.doesNotMatch(calls[0].query, /\.\.\. on DiscountAutomaticApp \{[^}]*\bmetafield\b/s);
});

test("findCanonicalAutomaticDiscount flattens search nodes before canonical title matching", async () => {
  const snapshot = await findCanonicalAutomaticDiscount(async () => ({ discountNodes: { nodes: [node(ownerId), node("gid://shopify/DiscountNode/2", { discount: { ...appDiscount, title: "Other" } })] } }), null);
  assert.equal(snapshot?.id, ownerId);
  assert.equal(snapshot?.title, "LoopDesk Universal Promotions");
  assert.equal(snapshot?.metafield?.namespace, "$app:loopdesk-promotions");
});

test("createAutomaticDiscount uses returned discountId directly and reads canonical node", async () => {
  const calls: any[] = [];
  const snapshot = await createAutomaticDiscount(async (query: string, variables: any) => {
    calls.push({ query, variables });
    if (query.includes("discountAutomaticAppCreate")) return { discountAutomaticAppCreate: { automaticAppDiscount: appDiscount, userErrors: [] } };
    if (query.includes("discountNode")) { assert.equal(variables.id, ownerId); return { discountNode: node() }; }
    if (query.includes("discountNodes")) throw new Error("create should not search for the created discount");
    throw new Error("unexpected query");
  }, null, "2026-07-12T00:00:00.000Z");
  assert.equal(snapshot.id, ownerId);
  assert.deepEqual(calls.map((call) => call.query.includes("discountAutomaticAppCreate") ? "create" : "read"), ["create", "read"]);
  assert.match(calls[0].query, /automaticAppDiscount \{[^}]*\bdiscountId\b/s);
  assert.doesNotMatch(calls[0].query, /automaticAppDiscount \{[^}]*\bid\b/s);
});

test("writeFunctionConfigurationMetafield uses DiscountNode ownerId and verification reads canonical metafield", async () => {
  const config = assembleFunctionConfiguration({ configurationVersion: 1, rules: [] });
  let written: any;
  await writeFunctionConfigurationMetafield(async (_query: string, variables: any) => { written = variables.metafields[0]; return { metafieldsSet: { metafields: [{ id: "mf1" }], userErrors: [] } }; }, null, ownerId, config);
  assert.equal(written.ownerId, ownerId);
  assert.equal(written.namespace, "$app:loopdesk-promotions");
  assert.equal(written.key, "function-config");
  verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { namespace: written.namespace, key: written.key, type: written.type, value: written.value } }, config);
});

test("verifyDiscountOwnsCanonicalConfiguration accepts Shopify-expanded app-owned namespace", () => {
  const config = assembleFunctionConfiguration({ configurationVersion: 1, rules: [] });
  verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { ...metafield, namespace: expandedNamespace, value: JSON.stringify(config) } }, config);
});

test("verifyDiscountOwnsCanonicalConfiguration reports specific identity mismatches", () => {
  const config = assembleFunctionConfiguration({ configurationVersion: 1, rules: [] });
  assert.throws(() => verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { ...metafield, namespace: "loopdesk-promotions", value: JSON.stringify(config) } }, config), /unexpected metafield namespace.*loopdesk-promotions/);
  assert.throws(() => verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { ...metafield, key: "wrong-key", value: JSON.stringify(config) } }, config), /unexpected metafield key.*wrong-key/);
  assert.throws(() => verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { ...metafield, type: "single_line_text_field", value: JSON.stringify(config) } }, config), /unexpected metafield type.*single_line_text_field/);
});

test("verifyDiscountOwnsCanonicalConfiguration rejects non-canonical configuration value", () => {
  const config = assembleFunctionConfiguration({ configurationVersion: 1, rules: [] });
  const wrongConfig = assembleFunctionConfiguration({ configurationVersion: 2, rules: [] });
  assert.throws(() => verifyDiscountOwnsCanonicalConfiguration({ id: ownerId, ...appDiscount, metafield: { ...metafield, namespace: expandedNamespace, value: JSON.stringify(wrongConfig) } }, config), /did not match the intended LoopDesk configuration/);
});

test("findCanonicalAutomaticDiscount rejects duplicate canonical node titles", async () => {
  await assert.rejects(() => findCanonicalAutomaticDiscount(async () => ({ discountNodes: { nodes: [node(ownerId), node("gid://shopify/DiscountNode/2")] } }), null), /ambiguous/i);
});
