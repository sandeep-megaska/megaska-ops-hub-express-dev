import test from "node:test";
import assert from "node:assert/strict";
import {
  DELHIVERY_TRACKING_COMPANY,
  FULFILLMENT_CREATE_MUTATION,
  ORDER_FULFILLMENT_ORDERS_QUERY,
  friendlyShopifyFulfillmentError,
  fulfillOrderWithTracking,
  selectFulfillableOrders,
} from "./shopify-fulfillment.ts";

const fo = (id: string, status: string, remaining = 1, actions = ["CREATE_FULFILLMENT"]) => ({
  id,
  status,
  supportedActions: actions.map((action) => ({ action })),
  lineItems: { nodes: [{ id: `${id}-li`, remainingQuantity: remaining }] },
});

test("only open fulfillment orders with remaining items and CREATE_FULFILLMENT are used", () => {
  const selection = selectFulfillableOrders([fo("a", "OPEN"), fo("b", "CLOSED", 0), fo("c", "OPEN", 0), fo("d", "IN_PROGRESS")]);
  assert.deepEqual(selection.fulfillable.map((node) => node.id), ["a", "d"]);
});

test("everything closed means already fulfilled; holds give a reason", () => {
  assert.equal(selectFulfillableOrders([fo("a", "CLOSED", 0)]).alreadyFulfilled, true);
  const held = selectFulfillableOrders([fo("a", "ON_HOLD", 1, [])]);
  assert.equal(held.alreadyFulfilled, false);
  assert.match(held.blockedReason || "", /on hold/);
});

test("permission errors become an actionable message", () => {
  assert.match(friendlyShopifyFulfillmentError("Access denied for fulfillmentOrders field. Required access: read_merchant_managed_fulfillment_orders"), /approve the updated permissions/);
  assert.equal(friendlyShopifyFulfillmentError("Line item quantity is invalid"), "Line item quantity is invalid");
});

test("creates one fulfillment covering every open fulfillment order with Delhivery tracking", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const graphql = async <T,>(query: string, variables: Record<string, unknown> = {}) => {
    calls.push({ query, variables });
    if (query === ORDER_FULFILLMENT_ORDERS_QUERY) {
      return { order: { fulfillmentOrders: { nodes: [fo("gid://FO/1", "OPEN"), fo("gid://FO/2", "OPEN"), fo("gid://FO/3", "CLOSED", 0)] } } } as T;
    }
    return { fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/5" }, userErrors: [] } } as T;
  };
  const result = await fulfillOrderWithTracking({ graphql, orderId: "gid://shopify/Order/1", awb: "AWB1", trackingUrl: "https://t/AWB1", notifyCustomer: true });
  assert.deepEqual(result, { outcome: "fulfilled", fulfillmentId: "gid://shopify/Fulfillment/5" });
  assert.equal(calls[1].query, FULFILLMENT_CREATE_MUTATION);
  assert.deepEqual(calls[1].variables, {
    fulfillment: {
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: "gid://FO/1" }, { fulfillmentOrderId: "gid://FO/2" }],
      trackingInfo: { company: DELHIVERY_TRACKING_COMPANY, number: "AWB1", url: "https://t/AWB1" },
      notifyCustomer: true,
    },
  });
});

test("already fulfilled orders are not fulfilled again", async () => {
  let mutations = 0;
  const graphql = async <T,>(query: string) => {
    if (query === FULFILLMENT_CREATE_MUTATION) mutations += 1;
    return { order: { fulfillmentOrders: { nodes: [fo("a", "CLOSED", 0)] } } } as T;
  };
  assert.deepEqual(await fulfillOrderWithTracking({ graphql, orderId: "o", awb: "A", trackingUrl: null, notifyCustomer: false }), { outcome: "already_fulfilled" });
  assert.equal(mutations, 0);
});

test("userErrors and missing scopes surface as errors", async () => {
  const userErrors = async <T,>(query: string) =>
    (query === ORDER_FULFILLMENT_ORDERS_QUERY
      ? { order: { fulfillmentOrders: { nodes: [fo("a", "OPEN")] } } }
      : { fulfillmentCreate: { fulfillment: null, userErrors: [{ message: "Tracking number is invalid" }] } }) as T;
  await assert.rejects(fulfillOrderWithTracking({ graphql: userErrors, orderId: "o", awb: "A", trackingUrl: null, notifyCustomer: false }), /Tracking number is invalid/);

  const denied = async () => { throw new Error("Access denied for fulfillmentOrders field. Required access: `read_merchant_managed_fulfillment_orders`"); };
  await assert.rejects(fulfillOrderWithTracking({ graphql: denied, orderId: "o", awb: "A", trackingUrl: null, notifyCustomer: false }), /approve the updated permissions/);
});
