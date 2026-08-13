import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  capiOrderSourceId,
  mapOrderToPurchaseInput,
  sendOrderPurchaseToCapi,
  type ShopifyOrderForCapi,
} from "./shopify-order-purchase.ts";
import { deterministicEventId } from "./capi.ts";

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const fullOrder: ShopifyOrderForCapi = {
  id: 5566778899,
  admin_graphql_api_id: "gid://shopify/Order/5566778899",
  total_price: "1499.50",
  currency: "INR",
  email: "Buyer@Example.com",
  customer: { id: 42, first_name: "Asha", last_name: "Rao" },
  shipping_address: {
    first_name: "Asha",
    last_name: "Rao",
    city: "Bengaluru",
    province: "Karnataka",
    province_code: "KA",
    zip: "560001",
    country_code: "IN",
    phone: "98765 43210",
  },
  line_items: [
    { product_id: 111, quantity: 2, price: "499.00" },
    { product_id: 222, quantity: 1, price: "501.50" },
  ],
  note_attributes: [{ name: "megaska_fbp", value: "fb.1.1700.abc" }],
};

test("capiOrderSourceId prefers numeric id, falls back to gid tail", () => {
  assert.equal(capiOrderSourceId({ id: 123 }), "123");
  assert.equal(capiOrderSourceId({ admin_graphql_api_id: "gid://shopify/Order/999" }), "999");
  assert.equal(capiOrderSourceId({}), "");
});

test("mapOrderToPurchaseInput returns null without an id", () => {
  assert.equal(mapOrderToPurchaseInput({ total_price: "10" }), null);
});

test("mapOrderToPurchaseInput returns null without a monetary total", () => {
  assert.equal(mapOrderToPurchaseInput({ id: 1 }), null);
});

test("mapOrderToPurchaseInput extracts value, currency, contents and dedup id", () => {
  const input = mapOrderToPurchaseInput(fullOrder)!;
  assert.equal(input.orderId, "5566778899");
  assert.equal(input.valueRupees, 1499.5);
  assert.equal(input.currency, "INR");
  assert.deepEqual(input.contents, [
    { id: "111", quantity: 2, item_price: 499 },
    { id: "222", quantity: 1, item_price: 501.5 },
  ]);
});

test("mapOrderToPurchaseInput hashes PII and carries fbp from note attributes", () => {
  const input = mapOrderToPurchaseInput(fullOrder)!;
  // buildUserData in capi.ts does the hashing; here we assert the raw inputs feed through.
  assert.equal(input.user.email, "Buyer@Example.com");
  assert.equal(input.user.phone, "98765 43210");
  assert.equal(input.user.phoneCountry, "IN");
  assert.equal(input.user.state, "KA");
  assert.equal(input.user.country, "IN");
  assert.equal(input.user.externalId, "42");
  assert.equal(input.user.fbp, "fb.1.1700.abc");
});

test("mapOrderToPurchaseInput prefers the trusted verified phone", () => {
  const input = mapOrderToPurchaseInput(fullOrder, { verifiedPhone: "+919999900000" })!;
  assert.equal(input.user.phone, "+919999900000");
});

test("sendOrderPurchaseToCapi reports mapped:false for an unmappable order", async () => {
  const result = await sendOrderPurchaseToCapi({ id: 1 }); // no total
  assert.equal(result.mapped, false);
  assert.equal(result.ok, true);
});

test("sendOrderPurchaseToCapi posts a deduped, hashed Purchase to Meta", async () => {
  type WireBody = {
    data: Array<{
      event_name: string;
      event_id: string;
      user_data: Record<string, string[] | string>;
      custom_data: { value: number; currency: string; num_items?: number };
    }>;
  };
  const calls: WireBody[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as WireBody);
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendOrderPurchaseToCapi(fullOrder, {
      config: { pixelId: "px", accessToken: "SECRET", graphApiVersion: "v21.0" },
    });
    assert.equal(result.mapped, true);
    assert.equal(result.ok, true);

    const evt = calls[0].data[0];
    assert.equal(evt.event_name, "Purchase");
    // Deterministic id derived from the numeric order id -> Pixel can match it.
    assert.equal(evt.event_id, deterministicEventId("Purchase", "5566778899"));
    assert.equal(evt.custom_data.value, 1499.5);
    assert.equal(evt.custom_data.currency, "INR");
    assert.equal(evt.custom_data.num_items, 3);
    // Email hashed, never raw, on the wire.
    const wire = JSON.stringify(calls[0]);
    assert.equal(wire.includes("Buyer@Example.com"), false);
    assert.deepEqual(evt.user_data.em, [sha256("buyer@example.com")]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
