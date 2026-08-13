import { deterministicEventId, sendCapiEvents, type MetaCapiConfig, type MetaCapiResult, type MetaUserData } from "./capi.ts";
import { normalizeOrderSourceId } from "./event-id.ts";

// Map a Shopify `orders/create` webhook payload into a Meta CAPI Purchase event.
//
// Kept out of the route so the field extraction is unit-testable and decoupled
// from the route's own payload type. Defensive by construction: every field is
// optional, missing pieces are simply omitted (Meta improves match rate with
// more identifiers but requires none beyond the event basics).
//
// Dedup: the Purchase event_id is derived deterministically from the numeric
// order id (see `capiOrderSourceId`). The storefront Pixel MUST send the same
// event_id for the order-status Purchase so Meta collapses the two copies;
// otherwise conversions double-count. The numeric order id is chosen because it
// is the id the browser Pixel most readily has on the thank-you page.

export type ShopifyOrderAddressForCapi = {
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country_code?: string | null;
  phone?: string | null;
};

export type ShopifyOrderForCapi = {
  id?: number | string;
  admin_graphql_api_id?: string;
  total_price?: string | number;
  current_total_price?: string | number;
  currency?: string;
  email?: string;
  contact_email?: string;
  phone?: string;
  customer?: {
    id?: number | string;
    email?: string;
    phone?: string;
    first_name?: string | null;
    last_name?: string | null;
    default_address?: { country_code?: string };
  };
  shipping_address?: ShopifyOrderAddressForCapi;
  billing_address?: ShopifyOrderAddressForCapi;
  line_items?: Array<{
    product_id?: number | string;
    variant_id?: number | string;
    quantity?: number;
    price?: string | number;
  }>;
  note_attributes?: Array<{ name?: string; value?: string }>;
};

export type OrderPurchaseCapiOptions = {
  /** Trusted, server-corrected verified phone (canonical E.164). Preferred over
   *  the order's raw contact phone when available. */
  verifiedPhone?: string | null;
  eventSourceUrl?: string | null;
  eventTimeMs?: number;
  config?: MetaCapiConfig | null;
};

export type PurchaseInput = {
  orderId: string;
  valueRupees: number;
  currency: string;
  user: MetaUserData;
  contents: Array<{ id: string; quantity?: number; item_price?: number }>;
  eventSourceUrl?: string | null;
  eventTimeMs?: number;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function attributeMap(order: ShopifyOrderForCapi): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of order.note_attributes || []) {
    const key = trimmed(entry?.name);
    const value = trimmed(entry?.value);
    if (key && value) map[key] = value;
  }
  return map;
}

/** Numeric order id used as the Pixel/CAPI dedup source. Uses the shared
 *  `normalizeOrderSourceId` so the storefront Pixel derives the identical value
 *  from its own `checkout.order.id`. Prefers the numeric id, then the GID. */
export function capiOrderSourceId(order: ShopifyOrderForCapi): string {
  return normalizeOrderSourceId(order.id) || normalizeOrderSourceId(order.admin_graphql_api_id);
}

function buildUserData(order: ShopifyOrderForCapi, opts: OrderPurchaseCapiOptions): MetaUserData {
  const ship = order.shipping_address || {};
  const bill = order.billing_address || {};
  const attrs = attributeMap(order);

  const firstName = trimmed(ship.first_name) || trimmed(bill.first_name) || trimmed(order.customer?.first_name);
  const lastName = trimmed(ship.last_name) || trimmed(bill.last_name) || trimmed(order.customer?.last_name);
  const phone =
    trimmed(opts.verifiedPhone) ||
    trimmed(order.phone) ||
    trimmed(ship.phone) ||
    trimmed(bill.phone) ||
    trimmed(order.customer?.phone);
  const phoneCountry =
    trimmed(ship.country_code) ||
    trimmed(bill.country_code) ||
    trimmed(order.customer?.default_address?.country_code) ||
    "IN";
  const externalId = trimmed(attrs.megaska_shopify_customer_id) || trimmed(order.customer?.id);

  return {
    email: trimmed(order.email) || trimmed(order.contact_email) || trimmed(order.customer?.email) || undefined,
    phone: phone || undefined,
    phoneCountry,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    city: trimmed(ship.city) || trimmed(bill.city) || undefined,
    state: trimmed(ship.province_code) || trimmed(ship.province) || trimmed(bill.province_code) || trimmed(bill.province) || undefined,
    zip: trimmed(ship.zip) || trimmed(bill.zip) || undefined,
    country: trimmed(ship.country_code) || trimmed(bill.country_code) || undefined,
    externalId: externalId || undefined,
    // Browser identifiers if the storefront captured them into note attributes.
    fbp: trimmed(attrs.megaska_fbp) || undefined,
    fbc: trimmed(attrs.megaska_fbc) || undefined,
  };
}

/**
 * Pure mapping: Shopify order -> Purchase input, or null when the order has no
 * usable id or monetary total (nothing meaningful to optimize on).
 */
export function mapOrderToPurchaseInput(
  order: ShopifyOrderForCapi,
  opts: OrderPurchaseCapiOptions = {},
): PurchaseInput | null {
  const orderId = capiOrderSourceId(order);
  if (!orderId) return null;

  const value = toNumber(order.total_price) ?? toNumber(order.current_total_price);
  if (value === null) return null;

  const contents = (order.line_items || [])
    .map((li) => {
      const id = trimmed(li.product_id) || trimmed(li.variant_id);
      if (!id) return null;
      const itemPrice = toNumber(li.price);
      return {
        id,
        quantity: typeof li.quantity === "number" ? li.quantity : 1,
        ...(itemPrice === null ? {} : { item_price: itemPrice }),
      };
    })
    .filter((c): c is { id: string; quantity: number; item_price?: number } => c !== null);

  return {
    orderId,
    valueRupees: value,
    currency: trimmed(order.currency) || "INR",
    user: buildUserData(order, opts),
    contents,
    eventSourceUrl: opts.eventSourceUrl ?? undefined,
    eventTimeMs: opts.eventTimeMs,
  };
}

export type OrderPurchaseSendResult = MetaCapiResult & { mapped: boolean };

/**
 * Map a Shopify order and send its Purchase event to Meta CAPI. Never throws;
 * a no-op (`disabled`) when CAPI is unconfigured, `mapped:false` when the order
 * could not be mapped. Safe to call from a webhook `after()` for every order.
 */
export async function sendOrderPurchaseToCapi(
  order: ShopifyOrderForCapi,
  opts: OrderPurchaseCapiOptions = {},
): Promise<OrderPurchaseSendResult> {
  const input = mapOrderToPurchaseInput(order, opts);
  if (!input) return { ok: true, disabled: false, mapped: false };

  const result = await sendCapiEvents(
    [
      {
        eventName: "Purchase",
        eventId: deterministicEventId("Purchase", input.orderId),
        eventTimeMs: input.eventTimeMs,
        eventSourceUrl: input.eventSourceUrl ?? undefined,
        actionSource: "website",
        user: input.user,
        customData: {
          currency: input.currency,
          value: input.valueRupees,
          orderId: input.orderId,
          contentType: "product",
          contentIds: input.contents.map((c) => c.id),
          contents: input.contents,
          numItems: input.contents.reduce((n, c) => n + (c.quantity ?? 1), 0),
        },
      },
    ],
    { config: opts.config },
  );
  return { ...result, mapped: true };
}
