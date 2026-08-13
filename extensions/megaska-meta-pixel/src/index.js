import { register } from "@shopify/web-pixels-extension";
import { purchaseEventIdFromOrderId, normalizeOrderSourceId } from "./event-id.js";

// Megaska storefront Meta Pixel (Purchase only).
//
// Purpose: fire the browser-side Meta Purchase with the SAME event_id the server
// Conversions API uses (services/meta/capi.ts + shopify-order-purchase.ts), so
// Meta deduplicates the two copies instead of double-counting. The event_id is
// derived by the shared contract in ./event-id.js (mirror of
// services/meta/event-id.ts); parity is enforced by
// services/meta/event-id.test.mts.
//
// Why a direct beacon instead of fbevents.js: this pixel runs in the "strict"
// Web Pixel sandbox (a Web Worker with no page DOM), where fbevents.js cannot
// inject its tracking. We send Meta's underlying tracking request directly to
// https://www.facebook.com/tr/, passing our event_id as `eid` — the field Meta
// reads as the browser event id for server/browser dedup. Advanced matching
// (email/phone) is handled server-side by CAPI, so it is intentionally not sent
// from the browser here.
//
// Trade-off: without fbevents.js the storefront does not set/read the `_fbp`
// cookie, so browser-cookie match signal is reduced. Deduped conversion counting
// (the goal of this task) is unaffected. If richer browser matching is wanted
// later, load fbevents.js in a "lax" sandbox and call
// fbq('track','Purchase',data,{eventID}) with the SAME event_id instead.

const META_TR_ENDPOINT = "https://www.facebook.com/tr/";

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function moneyAmount(money) {
  if (!money) return undefined;
  const amount = typeof money === "object" ? money.amount : money;
  const n = Number(amount);
  return Number.isFinite(n) ? n : undefined;
}

/** Map checkout_completed line items to Meta content ids / contents. Uses the
 *  product id to match the server (shopify-order-purchase.ts). */
function extractContents(checkout) {
  const lineItems = Array.isArray(checkout?.lineItems) ? checkout.lineItems : [];
  const contentIds = [];
  const contents = [];
  let numItems = 0;
  for (const li of lineItems) {
    const productId = normalizeOrderSourceId(li?.variant?.product?.id) || normalizeOrderSourceId(li?.variant?.id);
    const quantity = Number.isFinite(li?.quantity) ? li.quantity : 1;
    numItems += quantity;
    if (productId) {
      contentIds.push(productId);
      contents.push({ id: productId, quantity, item_price: moneyAmount(li?.variant?.price) });
    }
  }
  return { contentIds, contents, numItems };
}

function buildTrackingUrl({ pixelId, eventId, checkout, context }) {
  const params = new URLSearchParams();
  params.set("id", pixelId);
  params.set("ev", "Purchase");
  params.set("eid", eventId); // <-- dedup key shared with the server CAPI event
  params.set("dl", firstDefined(context?.document?.location?.href, "") || "");
  params.set("rl", firstDefined(context?.document?.referrer, "") || "");
  params.set("if", "false");
  params.set("ts", String(Date.now()));
  params.set("v", "2.9.166");
  params.set("noscript", "1");

  const value = moneyAmount(checkout?.totalPrice) ?? moneyAmount(checkout?.subtotalPrice);
  const currency = firstDefined(checkout?.currencyCode, checkout?.totalPrice?.currencyCode, "INR");
  if (value !== undefined) params.set("cd[value]", String(value));
  params.set("cd[currency]", String(currency));

  const { contentIds, contents, numItems } = extractContents(checkout);
  if (contentIds.length) {
    params.set("cd[content_ids]", JSON.stringify(contentIds));
    params.set("cd[content_type]", "product");
    params.set("cd[contents]", JSON.stringify(contents));
    params.set("cd[num_items]", String(numItems));
  }
  const orderId = normalizeOrderSourceId(checkout?.order?.id);
  if (orderId) params.set("cd[order_id]", orderId);

  return `${META_TR_ENDPOINT}?${params.toString()}`;
}

register(({ analytics, settings, init }) => {
  const pixelId = String((settings && settings.pixelId) || "").trim();
  if (!pixelId) {
    // Unconfigured: no-op, exactly like the server CAPI when META_PIXEL_ID is unset.
    return;
  }

  analytics.subscribe("checkout_completed", async (event) => {
    try {
      const checkout = event?.data?.checkout;
      const eventId = await purchaseEventIdFromOrderId(checkout?.order?.id);
      if (!eventId) {
        // No numeric order id on the thank-you page: cannot dedup with the server
        // event, so skip the browser copy (the server CAPI Purchase still records
        // the conversion). Rare; logged for the compatibility check.
        console.warn("[Megaska Meta Pixel] skipped Purchase - no numeric order id in checkout_completed");
        return;
      }

      const url = buildTrackingUrl({
        pixelId,
        eventId,
        checkout,
        context: firstDefined(event?.context, init?.context),
      });

      await fetch(url, { method: "GET", mode: "no-cors", keepalive: true });
    } catch (error) {
      // Never throw out of a pixel subscriber.
      console.error("[Megaska Meta Pixel] Purchase beacon failed", error && error.message ? error.message : error);
    }
  });
});
