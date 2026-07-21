import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routePath = new URL("../../app/api/dashboard/summary/route.ts", import.meta.url);
const shopifyPath = new URL("../shopify/dashboard.ts", import.meta.url);

test("dashboard route derives all identity from a shop-scoped authenticated session", async () => {
  const source = await readFile(routePath, "utf8");

  assert.match(source, /customer: \{ shopId: shop\.id \}/);
  assert.match(source, /customer\.id !== session\.customerProfileId/);
  assert.match(source, /customer\.shopId !== shop\.id/);
  assert.doesNotMatch(source, /searchParams\.get\(["'](?:customer|customerProfileId|email|phone|token)/);
  assert.match(source, /Cache-Control["'], ["']private, no-store, max-age=0/);
});

test("Shopify dashboard has no email, phone, order, or address fallback", async () => {
  const source = await readFile(shopifyPath, "utf8");
  const dashboardService = source.slice(source.indexOf("export async function getMegaskaCustomerDashboardData"));

  assert.match(dashboardService, /customerId: string/);
  assert.match(dashboardService, /customer\.id !== customerGid/);
  assert.doesNotMatch(dashboardService, /searchOrdersByIdentity|input\.email|input\.phoneE164/);
  assert.doesNotMatch(dashboardService, /recentOrders\[0\].*(?:email|phone|shippingAddress)/);
});

test("runtime Shopify credential cache is partitioned by shop domain", async () => {
  const source = await readFile(shopifyPath, "utf8");
  assert.match(source, /cachedRuntimeTokens\.get\(shopDomain\)/);
  assert.match(source, /cachedRuntimeTokens\.set\(shopDomain,/);
});
