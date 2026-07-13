import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync("app/api/express/checkout/intents/[id]/cod-policy/route.ts", "utf8");

test("COD policy route is customer-session protected and shop scoped", () => {
  assert.match(routeSource, /requireExpressCheckoutShop\(req\)/, "route must resolve the Express Checkout shop from the request");
  assert.match(routeSource, /requireCustomerSessionForShop\(getSessionTokenFromRequest\(req\), shop\.shopId\)/, "route must require a customer session scoped to the same shop");
  assert.match(routeSource, /customerProfileId = String\(auth\.customer\.id/, "route must resolve the customer profile from the authenticated customer");
});

test("COD policy route delegates to the resolver with intent and customer identity", () => {
  assert.match(routeSource, /resolveExpressCheckoutCodPolicy\(\{ shopId: shop\.shopId, shopDomain: shop\.shopDomain, checkoutIntentId, customerProfileId \}\)/, "route must delegate policy calculation and intent lifecycle to the service");
  assert.match(routeSource, /return jsonWithCors\(req, \{ ok: true, cod \}\)/, "route must return the customer-safe COD DTO");
});

test("COD policy route maps resolver failures to client-safe HTTP responses", () => {
  assert.match(routeSource, /error instanceof CodPolicyResolverError/, "route must recognize resolver domain errors");
  assert.match(routeSource, /status: error\.status/, "route must preserve resolver 404\/409 statuses");
  assert.match(routeSource, /Unable to resolve COD policy/, "route must hide unexpected server errors behind a generic message");
});
