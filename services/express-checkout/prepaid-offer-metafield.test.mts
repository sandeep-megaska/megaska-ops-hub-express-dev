import assert from "node:assert/strict";
import test from "node:test";
import { buildPrepaidOfferMetafieldValue, publishPrepaidOfferMetafield } from "./prepaid-offer-metafield.ts";

test("percentage offer serializes to the shape prepaid.rs parses", () => {
  const value = JSON.parse(buildPrepaidOfferMetafieldValue({ enabled: true, type: "PERCENTAGE", value: 15, maxPaise: 0, minSubtotalPaise: 0 }));
  assert.deepEqual(value, { schemaVersion: 1, type: "PERCENTAGE", maxAmount: "0.00", minSubtotal: "0.00", percent: "15" });
});

test("fixed-amount offer converts paise to major currency", () => {
  const value = JSON.parse(buildPrepaidOfferMetafieldValue({ enabled: true, type: "FIXED_AMOUNT", value: 5000, maxPaise: 0, minSubtotalPaise: 0 }));
  assert.equal(value.type, "FIXED_AMOUNT");
  assert.equal(value.amount, "50.00");
  assert.equal(value.percent, undefined);
});

test("cap and minimum-subtotal convert paise to major currency", () => {
  const value = JSON.parse(buildPrepaidOfferMetafieldValue({ enabled: true, type: "PERCENTAGE", value: 15, maxPaise: 20000, minSubtotalPaise: 99900 }));
  assert.equal(value.maxAmount, "200.00");
  assert.equal(value.minSubtotal, "999.00");
});

test("disabled offer publishes an empty object the parser rejects", () => {
  assert.equal(buildPrepaidOfferMetafieldValue({ enabled: false, type: "PERCENTAGE", value: 15, maxPaise: 0, minSubtotalPaise: 0 }), "{}");
  assert.equal(buildPrepaidOfferMetafieldValue({ enabled: true, type: "PERCENTAGE", value: 0, maxPaise: 0, minSubtotalPaise: 0 }), "{}");
});

test("publish writes a shop metafield in the app-reserved namespace", async () => {
  const calls: Array<{ query: string; variables: unknown }> = [];
  const graphql = (async (query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables });
    if (query.includes("shop { id }")) return { shop: { id: "gid://shopify/Shop/1" } } as never;
    return { metafieldsSet: { userErrors: [] } } as never;
  }) as Parameters<typeof publishPrepaidOfferMetafield>[2]["graphql"];
  const result = await publishPrepaidOfferMetafield("shop.myshopify.com", { enabled: true, type: "PERCENTAGE", value: 15, maxPaise: 0, minSubtotalPaise: 0 }, { graphql });
  assert.equal(result.ok, true);
  const setCall = calls.find((c) => c.query.includes("metafieldsSet"));
  const metafield = (setCall!.variables as { metafields: Array<Record<string, string>> }).metafields[0];
  assert.equal(metafield.ownerId, "gid://shopify/Shop/1");
  assert.equal(metafield.namespace, "$app:loopd2c-express");
  assert.equal(metafield.key, "prepaid-offer");
});
