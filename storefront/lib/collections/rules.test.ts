import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productMatches, sortMembers, type CollectionRules, type RuleProduct } from "./rules.ts";

const megaska = JSON.parse(readFileSync(new URL("../../data/megaska-collections.json", import.meta.url), "utf8")) as {
  collections: Array<{ handle: string; rules?: CollectionRules }>;
};
const rulesOf = (handle: string) => megaska.collections.find((c) => c.handle === handle)!.rules!;

const swimsuit: RuleProduct = {
  title: "Block Color Spandex Full Length Padded One Piece Swimming Costume",
  tags: ["One piece", "padded swimsuits", "solid_swimwear", "swimwear"],
  productType: "Swimwears",
  vendor: "MEGASKA",
  prices: ["995.00"],
  compareAtPrices: ["1899.00"],
};
const tee: RuleProduct = { ...swimsuit, title: "Cotton Printed Long Sleep Tee", tags: [], productType: "Long Sleep Tee", prices: ["449.00", "499.00"] };

test("Megaska's rule-based collections", () => {
  assert.ok(productMatches(swimsuit, rulesOf("all")));
  assert.ok(productMatches(swimsuit, rulesOf("best-sellers")), "title contains 'full length'");
  assert.ok(productMatches(swimsuit, rulesOf("modest-swimwears-full-length")), "tag 'One piece', case-insensitive");
  assert.ok(productMatches(swimsuit, rulesOf("solid-colors")));
  assert.ok(productMatches(swimsuit, rulesOf("swimwears")));
  assert.ok(!productMatches(swimsuit, rulesOf("monokini")));
  assert.ok(!productMatches(swimsuit, rulesOf("under-899-store")));
  assert.ok(productMatches(tee, rulesOf("night-wear")), "type is one of several values");
  assert.ok(productMatches(tee, rulesOf("under-499-store")), "any variant under 499");
  assert.ok(!productMatches(tee, rulesOf("swimwears")));
});

test("negative relations need every value to hold", () => {
  const rules: CollectionRules = { match: "all", conditions: [{ field: "type", relation: "not_contains", values: ["partial_cod_handle"] }] };
  assert.ok(productMatches(swimsuit, rules));
  assert.ok(!productMatches({ ...swimsuit, productType: "partial_cod_handle" }, rules));
  const noTag: CollectionRules = { match: "all", conditions: [{ field: "tag", relation: "not_equals", values: ["swimwear"] }] };
  assert.ok(!productMatches(swimsuit, noTag));
  assert.ok(productMatches(tee, noTag));
});

test("empty rules match nothing", () => {
  assert.ok(!productMatches(swimsuit, { match: "all", conditions: [] }));
});

test("sort orders", () => {
  const d = new Date("2026-01-01");
  const items = [
    { handle: "b", title: "Beta", minPrice: "500.00", salesRank: 2, createdAt: d },
    { handle: "a", title: "alpha", minPrice: "900.00", salesRank: null, createdAt: new Date("2026-02-01") },
    { handle: "c", title: "Gamma", minPrice: "100.00", salesRank: 1, createdAt: d },
  ];
  const order = (o: Parameters<typeof sortMembers>[1], manual?: string[]) => sortMembers(items, o, manual).map((i) => i.handle);
  assert.deepEqual(order("best_selling"), ["c", "b", "a"], "unranked last");
  assert.deepEqual(order("alpha_asc"), ["a", "b", "c"]);
  assert.deepEqual(order("price_asc"), ["c", "b", "a"]);
  assert.deepEqual(order("price_desc"), ["a", "b", "c"]);
  assert.deepEqual(order("created_desc"), ["a", "b", "c"]);
  assert.deepEqual(order("manual", ["b", "a"]), ["b", "a", "c"], "unlisted last");
});
