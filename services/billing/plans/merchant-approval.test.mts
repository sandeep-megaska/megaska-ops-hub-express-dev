import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// These modules import Prisma, so their behaviour is checked against the source.
const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const lifecycle = read("./plan-lifecycle.ts");
const overview = read("../merchant-billing-overview.ts");
const dashboard = read("../../../components/billing/billing-dashboard.tsx");
const uninstall = read("../../../app/api/webhooks/app/uninstalled/route.ts");

test("only a subscription Shopify approved blocks choosing a plan", () => {
  const initial = lifecycle.slice(lifecycle.indexOf("export async function requestInitialSubscription("), lifecycle.indexOf("export async function requestPlanChange("));
  assert.match(initial, /if \(existing && \["ACTIVE", "PAST_DUE", "PAUSED"\]\.includes\(existing\.status\)\) throw new PlanLifecycleError\("PLAN_ALREADY_ACTIVE"\);/);
  assert.doesNotMatch(initial, /"TRIALING", "PAST_DUE"/, "TRIALING (not yet approved) no longer blocks");
});

test("every attempt gets a fresh Shopify approval and closes earlier unapproved ones", () => {
  const initial = lifecycle.slice(lifecycle.indexOf("export async function requestInitialSubscription("), lifecycle.indexOf("export async function requestPlanChange("));
  assert.match(initial, /updateMany\(\{ where: \{ shopId: input\.shopId, merchantSubscriptionId: sub\.id, changeType: "INITIAL_SUBSCRIPTION", status: \{ in: \["PENDING", "PENDING_PROVIDER_CONFIRMATION"\] \} \}, data: \{ status: "CANCELED" \} \}\);/);
  assert.match(initial, /const key = `plan-change:initial:\$\{input\.shopId\}:\$\{target\.id\}:\$\{crypto\.randomUUID\(\)\}`;/);
  assert.ok(initial.indexOf("updateMany(") < initial.indexOf("merchantPlanChange.create("), "close old attempts before creating the new one");
  assert.match(initial, /change = await createProviderConfirmation\(change\.id, input\.shopId, sub, target\);/);
});

test("the Billing page offers approval until Shopify confirms, including after a reinstall", () => {
  assert.match(overview, /\["TRIALING", "CANCELED", "EXPIRED"\]\.includes\(subscription\.status\)/);
  assert.match(overview, /planCode: subscription\.pricingPlan\.code/);
  assert.match(dashboard, /fetch\(`\/api\/admin\/billing\/plan\/select\?shop=\$\{encodeURIComponent\(shopDomain\)\}`, \{ method: "POST"/);
  assert.match(dashboard, /body: JSON\.stringify\(\{ targetPlanCode: planCode \}\)/);
  assert.match(dashboard, /window\.open\(url, "_top"\);/, "Shopify's approval page opens in the top window");
  assert.match(dashboard, /onClick=\{\(\) => void approve\(subscription\.planCode\)\}/);
});

test("uninstalling cancels the subscription and unresolved plan changes, as Shopify does", () => {
  assert.match(uninstall, /UPDATE "MerchantSubscription"\n {5}SET "status" = 'CANCELED',/);
  assert.match(uninstall, /UPDATE "MerchantPlanChange"\n {5}SET "status" = 'CANCELED',[\s\S]*?AND "status" IN \('PENDING', 'PENDING_PROVIDER_CONFIRMATION', 'SCHEDULED', 'PROCESSING'\)/);
  assert.ok(uninstall.indexOf("verifyShopifyWebhookHmac(rawBuffer, hmacHeader)") < uninstall.indexOf('UPDATE "MerchantSubscription"'), "only after the signature check");
});
