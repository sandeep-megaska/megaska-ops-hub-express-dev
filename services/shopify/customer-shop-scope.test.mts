import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: profile completion once searched and created Shopify customers
// without a shop domain, so the Admin client fell back to the env store and
// profiles were linked to customer ids from a different Shopify store. Their
// orders then never matched (e.g. exchange requests refused as "not delivered").
test("Shopify customer find-or-create is always scoped to the customer's shop", async () => {
  const admin = await readFile(new URL("./admin.ts", import.meta.url), "utf8");
  const findOrCreate = admin.slice(admin.indexOf("export async function findOrCreateShopifyCustomer"));
  const body = findOrCreate.slice(0, findOrCreate.indexOf("\n}\n"));
  assert.match(body, /options: \{ shopDomain: string \}/);
  assert.doesNotMatch(body, /findCustomerByQuery\(`[^`]+`\)/, "every lookup passes the shop options");
  assert.match(body, /createCustomer\(\{[\s\S]*?\}, options\)/);

  const route = await readFile(new URL("../../app/api/profile/complete/route.ts", import.meta.url), "utf8");
  assert.match(route, /findOrCreateShopifyCustomer\(\{[\s\S]*?\}, \{ shopDomain: shop\.shopDomain \}\)/);
});

test("exchange eligibility can confirm delivery from Shopify when the local order is not delivered", async () => {
  const route = await readFile(new URL("../../app/api/account/exchange-requests/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveShopifyFulfillment\(input, targetOrderNumber\)/);
  assert.match(route, /findShopifyCustomerIdByIdentity\(/);
});
