import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderShipmentPayload,
  buildShippableOrdersSearch,
  bookOrderShipments,
  describeExistingShipment,
  extractOrderNumber,
  matchesOrderNumberFilters,
  normalizeCreateOptions,
  normalizeShippableOrder,
  parseOrderNumberList,
  resolveShipmentPayment,
  STALE_CREATING_MS,
  type OrderShipmentDb,
  type ShopifyShippableOrderNode,
} from "./order-shipments.ts";
import { OrderShipmentError } from "./order-shipments.ts";

const runtime = {
  configured: true,
  reason: "",
  apiToken: "token",
  baseUrl: "https://track.delhivery.com",
  pickupLocationName: "Megaska Warehouse",
  originPincode: "682001",
  trackingUrlTemplate: null,
  warehouse: { name: "Megaska Warehouse", email: "", phone: "9800000000", address: "1 Dock Rd", city: "Kochi", state: "Kerala", pin: "682001" },
  reversePickupPath: "/api/cmu/create.json",
  forwardShipmentPath: "/api/cmu/create.json",
  trackingPath: "/api/v1/packages/json/",
  clientWarehouseCreatePath: "/api/backend/clientwarehouse/create/",
} as never;

function orderNode(overrides: Partial<ShopifyShippableOrderNode> = {}): ShopifyShippableOrderNode {
  return {
    id: "gid://shopify/Order/1",
    name: "#1051",
    createdAt: "2026-09-29T10:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    email: "a@example.com",
    phone: null,
    currentTotalPriceSet: { shopMoney: { amount: "1999.00", currencyCode: "INR" } },
    totalOutstandingSet: { shopMoney: { amount: "0.00" } },
    customAttributes: [],
    shippingAddress: {
      name: "Asha Nair",
      phone: "+91 98765 43210",
      address1: "12 Beach Rd",
      address2: "Flat 3",
      city: "Kochi",
      province: "Kerala",
      zip: "682 001",
      country: "India",
    },
    lineItems: { nodes: [{ title: "Swimsuit", variantTitle: "M", sku: "SW-M", unfulfilledQuantity: 2 }, { title: "Cap", unfulfilledQuantity: 0 }] },
    ...overrides,
  };
}

test("prepaid when nothing is outstanding; COD collects Shopify's outstanding amount", () => {
  assert.deepEqual(resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 0 }), { ok: true, mode: "PREPAID", codAmountPaise: 0, source: "prepaid" });
  assert.deepEqual(resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900 }), { ok: true, mode: "COD", codAmountPaise: 199900, source: "outstanding" });
});

test("partial COD collects only the balance, never Shopify's full outstanding total", () => {
  // Shopify shows the full total as pending because the advance isn't a Shopify transaction.
  const fromIntent = resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900, paymentModeAttribute: "PARTIAL_COD", codBalanceAttribute: "149900", codIntentBalancePaise: 149900 });
  assert.deepEqual(fromIntent, { ok: true, mode: "COD", codAmountPaise: 149900, source: "partial_cod", warning: undefined });

  const fromAttribute = resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900, paymentModeAttribute: "PARTIAL_COD", codBalanceAttribute: "149900" });
  assert.equal(fromAttribute.ok && fromAttribute.codAmountPaise, 149900);
});

test("partial COD prefers the advance record and warns on mismatch", () => {
  const result = resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900, paymentModeAttribute: "PARTIAL_COD", codBalanceAttribute: "100000", codIntentBalancePaise: 149900 });
  assert.equal(result.ok && result.codAmountPaise, 149900);
  assert.match(result.ok ? result.warning || "" : "", /differs/);
});

test("partial COD without a known balance, or a balance above the total, is blocked", () => {
  assert.equal(resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900, paymentModeAttribute: "PARTIAL_COD" }).ok, false);
  assert.equal(resolveShipmentPayment({ totalPaise: 1000, outstandingPaise: 1000, codIntentBalancePaise: 5000 }).ok, false);
  assert.equal(resolveShipmentPayment({ totalPaise: 1000, outstandingPaise: 5000 }).ok, false);
});

test("fully settled partial COD ships as prepaid", () => {
  const result = resolveShipmentPayment({ totalPaise: 199900, outstandingPaise: 199900, codIntentBalancePaise: 0 });
  assert.equal(result.ok && result.mode, "PREPAID");
});

test("normalization keeps unfulfilled items and flags missing shipping data", () => {
  const ready = normalizeShippableOrder(orderNode());
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.pin, "682001");
  assert.equal(ready.itemCount, 2);
  assert.deepEqual(ready.items, [{ title: "Swimsuit / M / SW-M", quantity: 2 }]);

  const broken = normalizeShippableOrder(orderNode({ shippingAddress: { name: "", phone: "123", address1: "", city: "", province: "", zip: "68" }, lineItems: { nodes: [] } }));
  assert.ok(broken.blockers.includes("Missing recipient name."));
  assert.ok(broken.blockers.includes("Pincode must be 6 digits."));
  assert.ok(broken.blockers.includes("Missing or invalid phone number."));
  assert.ok(broken.blockers.includes("No unfulfilled items."));

  assert.ok(normalizeShippableOrder(orderNode({ shippingAddress: null })).blockers.includes("No shipping address."));
  assert.ok(normalizeShippableOrder(orderNode({ displayFulfillmentStatus: "ON_HOLD" })).blockers.some((b) => /on hold/.test(b)));
  assert.ok(normalizeShippableOrder(orderNode({ displayFulfillmentStatus: "PARTIALLY_FULFILLED" })).blockers.length > 0);
  assert.ok(normalizeShippableOrder(orderNode({ displayFinancialStatus: "REFUNDED" })).blockers.includes("Order is refunded."));
});

test("falls back to the order phone when the address has none", () => {
  const order = normalizeShippableOrder(orderNode({ phone: "+919876543210", shippingAddress: { ...orderNode().shippingAddress, phone: null } }));
  assert.equal(order.phone, "+919876543210");
  assert.deepEqual(order.blockers, []);
});

test("payload carries COD amount in rupees, weight, mode and warehouse return address", () => {
  const order = normalizeShippableOrder(
    orderNode({ totalOutstandingSet: { shopMoney: { amount: "1999.00" } }, customAttributes: [{ key: "loopdesk_payment_mode", value: "PARTIAL_COD" }, { key: "loopdesk_cod_balance", value: "149900" }] })
  );
  const payload = buildOrderShipmentPayload(order, runtime, { weightGrams: 450, shippingMode: "Express" });
  const shipment = payload.shipments[0];
  assert.equal(payload.pickup_location.name, "Megaska Warehouse");
  assert.equal(shipment.order, "1051");
  assert.equal(shipment.payment_mode, "COD");
  assert.equal(shipment.cod_amount, 1499);
  assert.equal(shipment.total_amount, 1999);
  assert.equal(shipment.pin, "682001");
  assert.equal(shipment.weight, 450);
  assert.equal(shipment.shipping_mode, "Express");
  assert.equal(shipment.quantity, 2);
  assert.equal(shipment.add, "12 Beach Rd, Flat 3");
  assert.equal(shipment.return_pin, "682001");

  const prepaid = buildOrderShipmentPayload(normalizeShippableOrder(orderNode()), runtime, { weightGrams: 500, shippingMode: "Surface" });
  assert.equal(prepaid.shipments[0].payment_mode, "Prepaid");
  assert.equal(prepaid.shipments[0].cod_amount, 0);
});

test("payload refuses blocked orders and a missing pickup location", () => {
  assert.throws(() => buildOrderShipmentPayload(normalizeShippableOrder(orderNode({ shippingAddress: null })), runtime, { weightGrams: 500, shippingMode: "Surface" }));
  assert.throws(
    () => buildOrderShipmentPayload(normalizeShippableOrder(orderNode()), { ...(runtime as object), pickupLocationName: "" } as never, { weightGrams: 500, shippingMode: "Surface" }),
    /pickup location/
  );
});

test("order numbers parse from names and filter lists", () => {
  assert.equal(extractOrderNumber("#1051"), 1051);
  assert.equal(extractOrderNumber("MEG1051"), 1051);
  assert.equal(extractOrderNumber("draft"), null);
  assert.deepEqual(parseOrderNumberList("1051, #1052 1052\nMEG1060"), [1051, 1052, 1060]);
  assert.equal(matchesOrderNumberFilters(1055, { orderNumberFrom: 1050, orderNumberTo: 1060 }), true);
  assert.equal(matchesOrderNumberFilters(1061, { orderNumberFrom: 1050, orderNumberTo: 1060 }), false);
  assert.equal(matchesOrderNumberFilters(1052, { orderNumbers: [1051, 1052] }), true);
  assert.equal(matchesOrderNumberFilters(1053, { orderNumbers: [1051, 1052] }), false);
  assert.equal(matchesOrderNumberFilters(1053, {}), true);
});

test("search query limits to open unshipped orders and drops dates when filtering by number", () => {
  const byDate = buildShippableOrdersSearch({ from: "2026-09-28T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" });
  assert.equal(byDate, "status:open fulfillment_status:unshipped created_at:>='2026-09-28T00:00:00.000Z' created_at:<='2026-09-30T23:59:59.999Z'");
  assert.equal(buildShippableOrdersSearch({ from: "2026-09-28T00:00:00.000Z", orderNumbers: [1051] }), "status:open fulfillment_status:unshipped");
  assert.equal(buildShippableOrdersSearch({ from: "not a date" }), "status:open fulfillment_status:unshipped");
});

test("create options are clamped to sane values", () => {
  assert.deepEqual(normalizeCreateOptions({ weightGrams: "750", shippingMode: "Express" }), { weightGrams: 750, shippingMode: "Express" });
  assert.deepEqual(normalizeCreateOptions({ weightGrams: -5, shippingMode: "Teleport" }), { weightGrams: 500, shippingMode: "Surface" });
});

test("existing bookings are described, with stale CREATING shown as interrupted", () => {
  const now = Date.now();
  const base = { id: "s1", shopifyOrderId: "o", awb: null, trackingUrl: null, errorMessage: null };
  assert.deepEqual(describeExistingShipment(undefined), { state: "NONE" });
  assert.equal(describeExistingShipment({ ...base, status: "CREATED", awb: "A1", updatedAt: new Date(now) }, now).state, "CREATED");
  assert.equal(describeExistingShipment({ ...base, status: "CREATING", updatedAt: new Date(now - 1000) }, now).state, "IN_PROGRESS");
  assert.equal(describeExistingShipment({ ...base, status: "CREATING", updatedAt: new Date(now - STALE_CREATING_MS - 1) }, now).state, "INTERRUPTED");
});

// ── booking with fakes ─────────────────────────────────────────────────────

type Row = { id: string; shopifyOrderId: string; status: "CREATING" | "CREATED" | "FAILED"; awb: string | null; trackingUrl: string | null; errorMessage: string | null; updatedAt: Date; attempts: number };

function fakeDb(rows: Row[] = [], intents: Array<{ shopifyOrderId: string; codBalanceAmountPaise: number }> = []) {
  let seq = rows.length;
  const db = {
    rows,
    orderCourierShipment: {
      async findMany() { return rows; },
      async create({ data }: { data: Record<string, unknown> }) {
        if (rows.some((row) => row.shopifyOrderId === data.shopifyOrderId)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row: Row = { id: `row${++seq}`, shopifyOrderId: String(data.shopifyOrderId), status: "CREATING", awb: null, trackingUrl: null, errorMessage: null, updatedAt: new Date(), attempts: 1 };
        rows.push(row);
        return row;
      },
      async updateMany({ where }: { where: { id: string } }) {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row || row.status === "CREATED" || (row.status === "CREATING" && Date.now() - row.updatedAt.getTime() < STALE_CREATING_MS)) return { count: 0 };
        row.status = "CREATING";
        row.attempts += 1;
        return { count: 1 };
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    codAdvanceIntent: { async findMany() { return intents; } },
  };
  return db as typeof db & OrderShipmentDb;
}

const graphqlFor = (nodes: ShopifyShippableOrderNode[]) => async <T,>() => ({ nodes }) as T;
const options = { weightGrams: 500, shippingMode: "Surface" as const };

test("books ready orders, records the AWB and skips blocked ones", async () => {
  const db = fakeDb();
  const sent: unknown[] = [];
  const results = await bookOrderShipments({
    db,
    shopId: "shop",
    orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/2", "gid://shopify/Order/9"],
    runtime,
    graphql: graphqlFor([orderNode(), orderNode({ id: "gid://shopify/Order/2", name: "#1052", shippingAddress: null })]),
    options,
    submit: async (_runtime, payload) => {
      sent.push(payload);
      return { awb: "AWB1", trackingUrl: "https://t/AWB1", providerReference: "ref", status: "IN_TRANSIT", rawResponse: {} };
    },
  });
  assert.deepEqual(results.map((r) => r.outcome), ["created", "skipped", "skipped"]);
  assert.equal(sent.length, 1);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].status, "CREATED");
  assert.equal(db.rows[0].awb, "AWB1");
});

test("partial COD balance from the advance record reaches Delhivery", async () => {
  const db = fakeDb([], [{ shopifyOrderId: "gid://shopify/Order/1", codBalanceAmountPaise: 120000 }]);
  let codAmount: unknown;
  await bookOrderShipments({
    db, shopId: "shop", orderIds: ["gid://shopify/Order/1"], runtime, options,
    graphql: graphqlFor([orderNode({ totalOutstandingSet: { shopMoney: { amount: "1999.00" } } })]),
    submit: async (_runtime, payload) => {
      codAmount = payload.shipments[0].cod_amount;
      return { awb: "AWB1", trackingUrl: null, providerReference: null, status: "IN_TRANSIT", rawResponse: {} };
    },
  });
  assert.equal(codAmount, 1200);
});

test("never books an order twice", async () => {
  const booked: Row = { id: "row1", shopifyOrderId: "gid://shopify/Order/1", status: "CREATED", awb: "AWB0", trackingUrl: null, errorMessage: null, updatedAt: new Date(), attempts: 1 };
  const inFlight: Row = { ...booked, id: "row2", shopifyOrderId: "gid://shopify/Order/2", status: "CREATING", awb: null };
  const db = fakeDb([booked, inFlight]);
  let calls = 0;
  const results = await bookOrderShipments({
    db, shopId: "shop", orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/2"], runtime, options,
    graphql: graphqlFor([orderNode(), orderNode({ id: "gid://shopify/Order/2", name: "#1052" })]),
    submit: async () => { calls += 1; return { awb: "X", trackingUrl: null, providerReference: null, status: "IN_TRANSIT", rawResponse: {} }; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(results.map((r) => r.outcome), ["already_created", "skipped"]);
});

test("a Delhivery rejection is stored as FAILED and can be retried", async () => {
  const db = fakeDb();
  const reject = async () => { throw new OrderShipmentError("Pin not serviceable", 502); };
  const first = await bookOrderShipments({ db, shopId: "shop", orderIds: ["gid://shopify/Order/1"], runtime, options, graphql: graphqlFor([orderNode()]), submit: reject });
  assert.equal(first[0].outcome, "failed");
  assert.equal(db.rows[0].status, "FAILED");
  assert.equal(db.rows[0].errorMessage, "Pin not serviceable");

  const retry = await bookOrderShipments({
    db, shopId: "shop", orderIds: ["gid://shopify/Order/1"], runtime, options, graphql: graphqlFor([orderNode()]),
    submit: async () => ({ awb: "AWB2", trackingUrl: null, providerReference: null, status: "IN_TRANSIT", rawResponse: {} }),
  });
  assert.equal(retry[0].outcome, "created");
  assert.equal(db.rows[0].status, "CREATED");
  assert.equal(db.rows[0].attempts, 2);
});

test("a settings error stops the batch instead of failing every order", async () => {
  const db = fakeDb();
  let calls = 0;
  const results = await bookOrderShipments({
    db, shopId: "shop", orderIds: ["gid://shopify/Order/1", "gid://shopify/Order/2"], runtime, options,
    graphql: graphqlFor([orderNode(), orderNode({ id: "gid://shopify/Order/2", name: "#1052" })]),
    submit: async () => { calls += 1; throw new OrderShipmentError("No pickup warehouse", 422); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(results.map((r) => r.outcome), ["failed", "skipped"]);
  assert.match(results[1].outcome === "skipped" ? results[1].error : "", /^Stopped:/);
});
