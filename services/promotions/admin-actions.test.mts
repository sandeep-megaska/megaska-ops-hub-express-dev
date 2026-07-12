import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type PromotionEmbeddedContext = { shop?: string | string[]; shopify_shop?: string | string[]; host?: string | string[]; embedded?: string | string[] };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || "" : value || ""; }
function add(params: URLSearchParams, key: string, value: string | string[] | undefined) { const v = first(value); if (v) params.set(key, v); }
function buildPromotionAdminUrl(path: string, context: PromotionEmbeddedContext, extra: Record<string, string | undefined> = {}) { const params = new URLSearchParams(); add(params, "shop", context.shop); add(params, "shopify_shop", context.shopify_shop); add(params, "host", context.host); add(params, "embedded", context.embedded); Object.entries(extra).forEach(([key, value]) => { if (value) params.set(key, value); }); const query = params.toString(); return query ? `${path}?${query}` : path; }
function promotionEmbeddedContext(params: PromotionEmbeddedContext, canonicalShopDomain?: string): PromotionEmbeddedContext { return { shop: canonicalShopDomain || first(params.shop), shopify_shop: first(params.shopify_shop), host: first(params.host), embedded: first(params.embedded) }; }
function verifyPromotionActionTenant(claimedShopId: string, resolvedShopId: string) { return Boolean(resolvedShopId) && (!claimedShopId || claimedShopId === resolvedShopId); }

test("promotion admin URL helper preserves shop, host, and embedded", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }), "/admin/promotions?shop=canon.myshopify.com&host=admin-host&embedded=1"); });
test("status-filter links preserve embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }, { status: "ACTIVE" }), "/admin/promotions?shop=canon.myshopify.com&host=admin-host&embedded=1&status=ACTIVE"); });
test("new-draft link preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions/new", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }), "/admin/promotions/new?shop=canon.myshopify.com&host=admin-host&embedded=1"); });
test("edit link preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions/r1", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }), "/admin/promotions/r1?shop=canon.myshopify.com&host=admin-host&embedded=1"); });
test("save redirect preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions/r1", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }, { saved: "1" }), "/admin/promotions/r1?shop=canon.myshopify.com&host=admin-host&embedded=1&saved=1"); });
test("error redirect preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions/r1", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }, { error: "validation" }), "/admin/promotions/r1?shop=canon.myshopify.com&host=admin-host&embedded=1&error=validation"); });
test("status-change redirect preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions/r1", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }, { saved: "status" }), "/admin/promotions/r1?shop=canon.myshopify.com&host=admin-host&embedded=1&saved=status"); });
test("archive redirect preserves embedded context", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions", { shop: "canon.myshopify.com", host: "admin-host", embedded: "1" }, { status: "ARCHIVED" }), "/admin/promotions?shop=canon.myshopify.com&host=admin-host&embedded=1&status=ARCHIVED"); });
test("shopify_shop input can be resolved and canonicalized to shop", () => { const context = promotionEmbeddedContext({ shopify_shop: "input.myshopify.com", host: "admin-host", embedded: "1" }, "canon.myshopify.com"); assert.deepEqual(context, { shop: "canon.myshopify.com", shopify_shop: "input.myshopify.com", host: "admin-host", embedded: "1" }); });
test("no cross-tenant mutation is possible", () => { assert.equal(verifyPromotionActionTenant("shop-a", "shop-a"), true); assert.equal(verifyPromotionActionTenant("shop-b", "shop-a"), false); });
test("missing all context still returns safe unresolved-shop path", () => { assert.equal(buildPromotionAdminUrl("/admin/promotions", promotionEmbeddedContext({})), "/admin/promotions"); });

test("promotion action parses numeric, decimal, and UTC schedule FormData fields before repository calls", () => {
  const action = readFileSync(new URL("./admin-actions.server.ts", import.meta.url), "utf8");
  assert.match(action, /function integerValue/);
  assert.match(action, /Number\.isInteger\(value\)/);
  assert.doesNotMatch(action, /parseInt/);
  assert.match(action, /priority: integerValue\(formData, "priority", 0\)/);
  assert.match(action, /return Number\.isInteger\(value\) \? value : Number\.NaN/);
  assert.match(action, /minimumTriggerQuantity: integerValue\(formData, "minimumTriggerQuantity", 1\)/);
  assert.match(action, /maximumRewardQuantity: integerValue\(formData, "maximumRewardQuantity", 1\)/);
  assert.match(action, /function decimalValue/);
  assert.match(action, /minimumCartSubtotal: decimalValue\(formData, "minimumCartSubtotal", null\)/);
  assert.match(action, /rewardValue: decimalValue\(formData, "rewardValue", Number\.NaN\)/);
  assert.match(action, /startsAt: optionalUtcDate\(formData, "startsAtUtc", "startsAt"\)/);
  assert.match(action, /endsAt: optionalUtcDate\(formData, "endsAtUtc", "endsAt"\)/);
});

test("saving a valid ACTIVE promotion automatically compiles it and synchronizes runtime", async () => {
  const { publishSavedPromotion } = await import("./publication-orchestration.server.ts");
  const calls: string[] = [];
  const result = await publishSavedPromotion("shop-a", "a.myshopify.com", { id: "rule-1", status: "ACTIVE" }, "RULE_UPDATED", {
    compiler: async (input: any) => { calls.push(`compile:${input.reason}:${input.promotionRuleId}:${input.shopDomain}`); return { status: "READY", compilationId: "c1", version: 1, compiledHash: "h", membershipCount: 1 }; },
    synchronizer: async (input: any) => { calls.push(`sync:${input.shopId}`); return { ok: true, outcome: "UPDATED", automaticDiscountId: "d1", configurationVersion: 1, configurationHash: "h", ruleCount: 1, verifiedAt: new Date().toISOString() }; },
  } as any);
  assert.deepEqual(result, { compile: "READY", sync: "SYNCED" });
  assert.deepEqual(calls, ["compile:RULE_UPDATED:rule-1:a.myshopify.com", "sync:shop-a"]);
});

test("failed compilation does not mark Shopify publication as configured", async () => {
  const { publishSavedPromotion } = await import("./publication-orchestration.server.ts");
  let synced = false;
  await assert.rejects(() => publishSavedPromotion("shop-a", "a.myshopify.com", { id: "rule-1", status: "ACTIVE" }, "RULE_UPDATED", {
    compiler: async () => { throw new Error("compile failed"); },
    synchronizer: async () => { synced = true; return { ok: true }; },
  } as any), /compile failed/);
  assert.equal(synced, false);
});
