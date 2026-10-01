// Bulk outbound shipment booking: unfulfilled Shopify orders → Delhivery
// manifests, from the admin "Shipments" page. Payment mode and COD amount are
// always recomputed server-side from Shopify + Partial COD records; the client
// only ever sends order ids.
// Only types and pure helpers are imported eagerly: the Delhivery submit path
// pulls in the database layer, so it is loaded lazily (and injectable in tests).
import { toDelhiveryPhone, toDelhiveryPincode } from "./delhivery-format.ts";
import type { DelhiveryRuntimeConfig } from "./delhivery-runtime";
import type { DelhiveryCmuPayload, DelhiveryForwardShipmentResult } from "./delhivery-forward-shipment";

/** Order not ready to ship, or Delhivery settings incomplete (422 / 503). */
export class OrderShipmentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "OrderShipmentError";
    this.statusCode = statusCode;
  }
}

// Both this error and the Delhivery submit error carry statusCode; 422/503
// mean settings (token, warehouse) rather than this particular order.
function isSettingsError(error: unknown) {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return statusCode === 422 || statusCode === 503;
}

export const MAX_ORDERS_PER_CREATE_REQUEST = 10;
export const MAX_ORDERS_SCANNED = 500;
export const DEFAULT_WEIGHT_GRAMS = 500;
// A booking still CREATING after this long was interrupted mid-call; Delhivery
// may or may not have the manifest, so it is surfaced for a manual check.
export const STALE_CREATING_MS = 5 * 60 * 1000;

export type ShippingMode = "Surface" | "Express";

// ON_HOLD / SCHEDULED are deliberate merchant holds; anything else is already
// (partly) shipped.
const SHIPPABLE_FULFILLMENT_STATUSES = ["UNFULFILLED", "OPEN", "PENDING_FULFILLMENT"];

type Money = { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;

export type ShopifyShippableOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  email?: string | null;
  phone?: string | null;
  currentTotalPriceSet?: Money;
  totalOutstandingSet?: Money;
  customAttributes?: Array<{ key: string; value?: string | null }> | null;
  shippingAddress?: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  } | null;
  lineItems?: { nodes?: Array<{ title?: string | null; variantTitle?: string | null; sku?: string | null; unfulfilledQuantity?: number | null }> } | null;
};

export type ShipmentPayment =
  | { ok: true; mode: "PREPAID" | "COD"; codAmountPaise: number; source: "prepaid" | "outstanding" | "partial_cod"; warning?: string }
  | { ok: false; reason: string };

export type ShippableOrder = {
  id: string;
  name: string;
  orderNumber: number | null;
  createdAt: string;
  financialStatus: string | null;
  customerName: string;
  phone: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  pin: string;
  country: string;
  items: Array<{ title: string; quantity: number }>;
  itemCount: number;
  totalPaise: number;
  payment: ShipmentPayment;
  blockers: string[];
  warnings: string[];
};

const ORDER_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  email
  phone
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  totalOutstandingSet { shopMoney { amount } }
  customAttributes { key value }
  shippingAddress { name firstName lastName phone address1 address2 city province zip country }
  lineItems(first: 50) { nodes { title variantTitle sku unfulfilledQuantity } }
`;

export const SHIPPABLE_ORDERS_QUERY = `
  query ShippableOrders($query: String!, $after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} }
    }
  }
`;

export const ORDERS_BY_ID_QUERY = `
  query ShippableOrdersById($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Order { ${ORDER_FIELDS} } }
  }
`;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function moneyToPaise(money: Money | undefined): number {
  const amount = Number.parseFloat(clean(money?.shopMoney?.amount));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function paiseToRupees(paise: number) {
  return Math.round(paise) / 100;
}

// "#1234" / "MEG1234" → 1234 (the trailing number Shopify increments).
export function extractOrderNumber(name: string): number | null {
  const match = clean(name).match(/(\d+)\D*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function parseOrderNumberList(input: string): number[] {
  return Array.from(
    new Set(
      clean(input)
        .split(/[\s,]+/)
        .map((part) => extractOrderNumber(part))
        .filter((value): value is number => value !== null)
    )
  );
}

function attribute(order: ShopifyShippableOrderNode, key: string) {
  return clean(order.customAttributes?.find((entry) => entry.key === key)?.value);
}

/**
 * Partial COD orders are completed in Shopify with payment pending for the FULL
 * total (the paid advance is not a Shopify transaction), so Shopify's outstanding
 * amount would make the courier collect the advance twice. The balance comes
 * from the CodAdvanceIntent (authoritative) or the order's loopdesk_cod_balance
 * attribute; only ordinary orders use Shopify's outstanding amount.
 */
export function resolveShipmentPayment(input: {
  totalPaise: number;
  outstandingPaise: number;
  paymentModeAttribute?: string;
  codBalanceAttribute?: string;
  codIntentBalancePaise?: number | null;
}): ShipmentPayment {
  const attributeBalance = /^\d+$/.test(clean(input.codBalanceAttribute)) ? Number.parseInt(clean(input.codBalanceAttribute), 10) : null;
  const intentBalance = typeof input.codIntentBalancePaise === "number" ? input.codIntentBalancePaise : null;
  const isPartialCod = clean(input.paymentModeAttribute).toUpperCase() === "PARTIAL_COD" || intentBalance !== null;

  if (isPartialCod) {
    const balance = intentBalance ?? attributeBalance;
    if (balance === null) return { ok: false, reason: "Partial COD order without a recorded COD balance. Book it manually." };
    if (balance > input.totalPaise) return { ok: false, reason: "COD balance is higher than the order total. Check the order." };
    const warning = intentBalance !== null && attributeBalance !== null && intentBalance !== attributeBalance
      ? `COD balance differs between the advance record (₹${paiseToRupees(intentBalance)}) and the order note (₹${paiseToRupees(attributeBalance)}); using the advance record.`
      : undefined;
    if (balance <= 0) return { ok: true, mode: "PREPAID", codAmountPaise: 0, source: "partial_cod", warning };
    return { ok: true, mode: "COD", codAmountPaise: balance, source: "partial_cod", warning };
  }

  if (input.outstandingPaise > 0) {
    if (input.outstandingPaise > input.totalPaise) return { ok: false, reason: "Amount due is higher than the order total. Check the order." };
    return { ok: true, mode: "COD", codAmountPaise: input.outstandingPaise, source: "outstanding" };
  }

  return { ok: true, mode: "PREPAID", codAmountPaise: 0, source: "prepaid" };
}

export function normalizeShippableOrder(order: ShopifyShippableOrderNode, codIntentBalancePaise?: number | null): ShippableOrder {
  const address = order.shippingAddress || null;
  const items = (order.lineItems?.nodes || [])
    .map((item) => ({
      title: [item.title, item.variantTitle, item.sku].map(clean).filter(Boolean).join(" / "),
      quantity: Math.max(0, Number(item.unfulfilledQuantity) || 0),
    }))
    .filter((item) => item.quantity > 0);
  const totalPaise = moneyToPaise(order.currentTotalPriceSet);
  const payment = resolveShipmentPayment({
    totalPaise,
    outstandingPaise: moneyToPaise(order.totalOutstandingSet),
    paymentModeAttribute: attribute(order, "loopdesk_payment_mode"),
    codBalanceAttribute: attribute(order, "loopdesk_cod_balance"),
    codIntentBalancePaise,
  });

  const customerName = clean(address?.name) || [address?.firstName, address?.lastName].map(clean).filter(Boolean).join(" ");
  const phone = clean(address?.phone) || clean(order.phone);
  const pinDigits = clean(address?.zip).replace(/\D/g, "");
  const financialStatus = clean(order.displayFinancialStatus).toUpperCase() || null;

  const fulfillmentStatus = clean(order.displayFulfillmentStatus).toUpperCase();
  const blockers: string[] = [];
  if (order.cancelledAt) blockers.push("Order is cancelled.");
  if (fulfillmentStatus && !SHIPPABLE_FULFILLMENT_STATUSES.includes(fulfillmentStatus)) {
    blockers.push(`Order is ${fulfillmentStatus.toLowerCase().replace(/_/g, " ")} in Shopify.`);
  }
  if (financialStatus && ["REFUNDED", "VOIDED"].includes(financialStatus)) blockers.push(`Order is ${financialStatus.toLowerCase()}.`);
  if (!address) blockers.push("No shipping address.");
  else {
    if (!customerName) blockers.push("Missing recipient name.");
    if (!clean(address.address1)) blockers.push("Missing street address.");
    if (!clean(address.city)) blockers.push("Missing city.");
    if (!clean(address.province)) blockers.push("Missing state.");
    if (pinDigits.length !== 6) blockers.push("Pincode must be 6 digits.");
  }
  if (phone.replace(/\D/g, "").length < 10) blockers.push("Missing or invalid phone number.");
  if (!items.length) blockers.push("No unfulfilled items.");
  if (!payment.ok) blockers.push(payment.reason);

  const warnings: string[] = [];
  if (payment.ok && payment.warning) warnings.push(payment.warning);

  return {
    id: order.id,
    name: order.name,
    orderNumber: extractOrderNumber(order.name),
    createdAt: order.createdAt,
    financialStatus,
    customerName,
    phone,
    email: clean(order.email),
    address1: clean(address?.address1),
    address2: clean(address?.address2),
    city: clean(address?.city),
    state: clean(address?.province),
    pin: pinDigits,
    country: clean(address?.country) || "India",
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalPaise,
    payment,
    blockers,
    warnings,
  };
}

export function buildOrderShipmentPayload(
  order: ShippableOrder,
  runtime: Pick<DelhiveryRuntimeConfig, "pickupLocationName" | "warehouse">,
  options: { weightGrams: number; shippingMode: ShippingMode }
): DelhiveryCmuPayload {
  if (order.blockers.length || !order.payment.ok) {
    throw new OrderShipmentError(order.blockers[0] || "Order is not ready to ship.", 400);
  }
  const pickupLocationName = clean(runtime.pickupLocationName);
  if (!pickupLocationName) {
    throw new OrderShipmentError("Set the Delhivery pickup location in Settings → Delhivery before booking shipments.", 422);
  }
  const warehouse = runtime.warehouse;
  const isCod = order.payment.mode === "COD";

  return {
    pickup_location: { name: pickupLocationName },
    shipments: [
      {
        order: order.name.replace(/^#/, ""),
        order_date: order.createdAt,
        name: order.customerName,
        phone: toDelhiveryPhone(order.phone),
        email: order.email || undefined,
        add: [order.address1, order.address2].filter(Boolean).join(", "),
        city: order.city,
        state: order.state,
        pin: toDelhiveryPincode(order.pin),
        country: order.country,
        products_desc: order.items.map((item) => `${item.title} x${item.quantity}`).join("; ").slice(0, 500),
        quantity: order.itemCount,
        payment_mode: isCod ? "COD" : "Prepaid",
        cod_amount: isCod ? paiseToRupees(order.payment.codAmountPaise) : 0,
        total_amount: paiseToRupees(order.totalPaise),
        weight: options.weightGrams,
        shipping_mode: options.shippingMode,
        seller_name: warehouse.name || pickupLocationName,
        seller_add: warehouse.address || undefined,
        seller_city: warehouse.city || undefined,
        seller_state: warehouse.state || undefined,
        seller_pin: warehouse.pin || undefined,
        return_name: warehouse.name || pickupLocationName,
        return_phone: warehouse.phone || undefined,
        return_add: warehouse.address || undefined,
        return_city: warehouse.city || undefined,
        return_state: warehouse.state || undefined,
        return_pin: warehouse.pin || undefined,
      },
    ],
  };
}

export function normalizeCreateOptions(input: { weightGrams?: unknown; shippingMode?: unknown }) {
  const weight = Math.round(Number(input.weightGrams));
  return {
    weightGrams: Number.isFinite(weight) && weight >= 1 && weight <= 50000 ? weight : DEFAULT_WEIGHT_GRAMS,
    shippingMode: (input.shippingMode === "Express" ? "Express" : "Surface") as ShippingMode,
  };
}

// ── Shopify reads ───────────────────────────────────────────────────────────

type GraphqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

export type OrderSearchFilters = {
  from?: string | null;
  to?: string | null;
  orderNumberFrom?: number | null;
  orderNumberTo?: number | null;
  orderNumbers?: number[];
};

function isoOrNull(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function buildShippableOrdersSearch(filters: OrderSearchFilters) {
  const parts = ["status:open", "fulfillment_status:unshipped"];
  // Order-number filters scan all open unshipped orders instead of a date window.
  const byNumber = Boolean(filters.orderNumbers?.length || filters.orderNumberFrom || filters.orderNumberTo);
  if (!byNumber) {
    const from = isoOrNull(filters.from);
    const to = isoOrNull(filters.to);
    if (from) parts.push(`created_at:>='${from}'`);
    if (to) parts.push(`created_at:<='${to}'`);
  }
  return parts.join(" ");
}

export function matchesOrderNumberFilters(orderNumber: number | null, filters: OrderSearchFilters) {
  if (filters.orderNumbers?.length) return orderNumber !== null && filters.orderNumbers.includes(orderNumber);
  if (filters.orderNumberFrom && (orderNumber === null || orderNumber < filters.orderNumberFrom)) return false;
  if (filters.orderNumberTo && (orderNumber === null || orderNumber > filters.orderNumberTo)) return false;
  return true;
}

export async function fetchShippableOrderNodes(graphql: GraphqlFn, filters: OrderSearchFilters) {
  const query = buildShippableOrdersSearch(filters);
  const nodes: ShopifyShippableOrderNode[] = [];
  let after: string | null = null;
  let truncated = false;
  do {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyShippableOrderNode[] } } =
      await graphql(SHIPPABLE_ORDERS_QUERY, { query, after });
    nodes.push(...(data.orders.nodes || []));
    after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
    if (after && nodes.length >= MAX_ORDERS_SCANNED) {
      truncated = true;
      after = null;
    }
  } while (after);
  return { nodes: nodes.filter((node) => matchesOrderNumberFilters(extractOrderNumber(node.name), filters)), truncated };
}

export async function fetchOrderNodesById(graphql: GraphqlFn, ids: string[]) {
  const data = await graphql<{ nodes: Array<ShopifyShippableOrderNode | null> }>(ORDERS_BY_ID_QUERY, { ids });
  return (data.nodes || []).filter((node): node is ShopifyShippableOrderNode => Boolean(node?.id && node?.name));
}

// ── Booking ─────────────────────────────────────────────────────────────────

type ShipmentRow = {
  id: string;
  shopifyOrderId: string;
  status: "CREATING" | "CREATED" | "FAILED";
  awb: string | null;
  trackingUrl: string | null;
  errorMessage: string | null;
  updatedAt: Date;
};

// Minimal Prisma surface used here, so the booking logic is testable with fakes.
export type OrderShipmentDb = {
  orderCourierShipment: {
    findMany(args: unknown): Promise<ShipmentRow[]>;
    create(args: unknown): Promise<ShipmentRow>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<ShipmentRow>;
  };
  codAdvanceIntent: {
    findMany(args: unknown): Promise<Array<{ shopifyOrderId: string | null; codBalanceAmountPaise: number }>>;
  };
};

export async function loadCodIntentBalances(db: OrderShipmentDb, shopId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, number>();
  const intents = await db.codAdvanceIntent.findMany({
    where: { shopId, shopifyOrderId: { in: orderIds } },
    select: { shopifyOrderId: true, codBalanceAmountPaise: true },
  });
  return new Map(intents.filter((row) => row.shopifyOrderId).map((row) => [row.shopifyOrderId as string, row.codBalanceAmountPaise]));
}

export async function loadExistingShipments(db: OrderShipmentDb, shopId: string, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, ShipmentRow>();
  const rows = await db.orderCourierShipment.findMany({
    where: { shopId, provider: "DELHIVERY", shopifyOrderId: { in: orderIds } },
  });
  return new Map(rows.map((row) => [row.shopifyOrderId, row]));
}

export function describeExistingShipment(row: ShipmentRow | undefined, now = Date.now()) {
  if (!row) return { state: "NONE" as const };
  if (row.status === "CREATED") return { state: "CREATED" as const, awb: row.awb, trackingUrl: row.trackingUrl };
  if (row.status === "FAILED") return { state: "FAILED" as const, error: row.errorMessage };
  return now - row.updatedAt.getTime() > STALE_CREATING_MS
    ? { state: "INTERRUPTED" as const, error: "Booking was interrupted. Check Delhivery for this order before retrying." }
    : { state: "IN_PROGRESS" as const };
}

export type OrderShipmentResult =
  | { orderId: string; orderName: string; outcome: "created"; awb: string | null; trackingUrl: string | null }
  | { orderId: string; orderName: string; outcome: "already_created"; awb: string | null; trackingUrl: string | null }
  | { orderId: string; orderName: string; outcome: "skipped" | "failed"; error: string };

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

/**
 * Takes the per-order booking lock. Returns false when another request holds it
 * or the order is already booked. FAILED and interrupted bookings are retried
 * only because the admin explicitly re-selected them.
 */
async function claimBooking(
  db: OrderShipmentDb,
  shopId: string,
  order: ShippableOrder,
  existing: ShipmentRow | undefined,
  options: { weightGrams: number; shippingMode: ShippingMode },
  now: Date
) {
  const bookingData = {
    status: "CREATING",
    shopifyOrderName: order.name,
    paymentMode: order.payment.ok ? order.payment.mode : "PREPAID",
    codAmountPaise: order.payment.ok ? order.payment.codAmountPaise : 0,
    weightGrams: options.weightGrams,
    shippingMode: options.shippingMode,
    errorMessage: null,
  };

  if (!existing) {
    try {
      const row = await db.orderCourierShipment.create({
        data: { shopId, shopifyOrderId: order.id, provider: "DELHIVERY", attempts: 1, ...bookingData },
      });
      return row.id;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  const claimed = await db.orderCourierShipment.updateMany({
    where: {
      id: existing.id,
      OR: [{ status: "FAILED" }, { status: "CREATING", updatedAt: { lt: new Date(now.getTime() - STALE_CREATING_MS) } }],
    },
    data: { ...bookingData, attempts: { increment: 1 } },
  });
  return claimed.count === 1 ? existing.id : null;
}

export async function bookOrderShipments(input: {
  db: OrderShipmentDb;
  shopId: string;
  orderIds: string[];
  runtime: DelhiveryRuntimeConfig;
  graphql: GraphqlFn;
  options: { weightGrams: number; shippingMode: ShippingMode };
  submit?: (runtime: DelhiveryRuntimeConfig, payload: DelhiveryCmuPayload) => Promise<DelhiveryForwardShipmentResult>;
  now?: () => Date;
}): Promise<OrderShipmentResult[]> {
  const submit = input.submit || (async (runtime, payload) => {
    const { submitDelhiveryShipmentPayload } = await import("./delhivery-forward-shipment");
    return submitDelhiveryShipmentPayload(runtime, payload, {
      logTag: "[DELHIVERY ORDER SHIPMENT] response",
      failureMessage: "Delhivery shipment creation failed.",
    });
  });
  const now = input.now || (() => new Date());

  // Re-read from Shopify so payment mode and address are never client-supplied.
  const nodes = await fetchOrderNodesById(input.graphql, input.orderIds);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const codBalances = await loadCodIntentBalances(input.db, input.shopId, input.orderIds);
  const existingRows = await loadExistingShipments(input.db, input.shopId, input.orderIds);

  const results: OrderShipmentResult[] = [];
  for (const orderId of input.orderIds) {
    const node = nodesById.get(orderId);
    if (!node) {
      results.push({ orderId, orderName: orderId, outcome: "skipped", error: "Order not found in Shopify." });
      continue;
    }
    const existing = existingRows.get(orderId);
    if (existing?.status === "CREATED") {
      results.push({ orderId, orderName: node.name, outcome: "already_created", awb: existing.awb, trackingUrl: existing.trackingUrl });
      continue;
    }
    const order = normalizeShippableOrder(node, codBalances.get(orderId) ?? null);
    if (order.blockers.length) {
      results.push({ orderId, orderName: order.name, outcome: "skipped", error: order.blockers.join(" ") });
      continue;
    }

    let payload: DelhiveryCmuPayload;
    try {
      payload = buildOrderShipmentPayload(order, input.runtime, input.options);
    } catch (error) {
      results.push({ orderId, orderName: order.name, outcome: "skipped", error: error instanceof Error ? error.message : "Order is not ready to ship." });
      continue;
    }

    const rowId = await claimBooking(input.db, input.shopId, order, existing, input.options, now());
    if (!rowId) {
      results.push({ orderId, orderName: order.name, outcome: "skipped", error: "A booking for this order is already in progress or done. Refresh the list." });
      continue;
    }

    try {
      const created = await submit(input.runtime, payload);
      await input.db.orderCourierShipment.update({
        where: { id: rowId },
        data: {
          status: "CREATED",
          awb: created.awb,
          trackingUrl: created.trackingUrl,
          providerReference: created.providerReference,
          rawResponse: created.rawResponse as never,
          errorMessage: null,
        },
      });
      results.push({ orderId, orderName: order.name, outcome: "created", awb: created.awb, trackingUrl: created.trackingUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delhivery shipment creation failed.";
      await input.db.orderCourierShipment.update({ where: { id: rowId }, data: { status: "FAILED", errorMessage: message.slice(0, 1000) } });
      results.push({ orderId, orderName: order.name, outcome: "failed", error: message });
      // A missing token or warehouse fails every remaining order the same way.
      if (isSettingsError(error)) {
        for (const remaining of input.orderIds.slice(input.orderIds.indexOf(orderId) + 1)) {
          results.push({ orderId: remaining, orderName: nodesById.get(remaining)?.name || remaining, outcome: "skipped", error: "Stopped: fix the Delhivery settings error above and retry." });
        }
        break;
      }
    }
  }
  return results;
}
