# Megaska Meta Pixel (Web Pixel extension)

Fires the storefront **Purchase** to Meta with the **same `event_id`** the server
Conversions API uses, so Meta deduplicates the browser and server copies instead
of double-counting.

- Server side: `services/meta/capi.ts` + `services/meta/shopify-order-purchase.ts`
  (fired from `app/api/webhooks/orders/create/route.ts`).
- Shared `event_id` contract: `services/meta/event-id.ts` ⇄ `src/event-id.js`
  (this extension). Parity is enforced by `services/meta/event-id.test.mts`,
  which runs THIS extension's `event-id.js` against the server and asserts the
  derived ids are identical.

The `event_id` is `sha256("Purchase:" + numericOrderId)` truncated to 32 hex
chars. Both sides normalize any order-id shape (`gid://…/Order/123`, `#123`,
`123`) to the bare numeric id first, so they always agree.

## Why a Web Pixel (not a theme block or theme.liquid)

Theme app extension blocks and `theme.liquid` do **not** run on the checkout /
order-status page, so they cannot reliably fire the Purchase there. A Web Pixel
runs on the order-status page and lets us set the dedup `event_id`. This pixel
runs in the **strict** sandbox and sends Meta's tracking request directly
(`facebook.com/tr`, passing our id as `eid`), so it needs no page DOM and no
`fbevents.js`. Advanced matching (email/phone) is done server-side by CAPI.

## Setup

1. `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` are set on the server deployment.
2. Deploy this extension with the app (`shopify app deploy`).
3. Create/enable the web pixel with its `pixelId` setting equal to the **same**
   `META_PIXEL_ID` the server posts to (via the app's onboarding or a
   `webPixelCreate` mutation). Dedup only works when both target one pixel.
4. Place a test order and confirm in **Events Manager → Test events** and
   **→ Diagnostics** that the Purchase shows *"Deduplicated with server event"*
   (browser and server share one `event_id`).

## Compatibility checklist — verify these BEFORE enabling (live theme is not in this repo)

The megaska.com storefront theme lives in Shopify admin, not this repository. The
one thing that breaks event_id matching is **another Meta pixel already firing a
Purchase with an id we do not control**. Check each source and remove/disable any
duplicate Purchase before enabling this pixel:

| Where to look (Shopify admin) | What to check |
| --- | --- |
| Online Store → Themes → Edit code → `layout/theme.liquid` (`<head>`) | Any `fbq(`, `connect.facebook.net/.../fbevents.js`, or `facebook.com/tr` snippet firing a Purchase. |
| Referenced head snippets/sections (e.g. `snippets/*pixel*`, `*facebook*`, `*meta*`, GTM `snippets/google-tag-manager.liquid`) | A pixel or GTM container that also fires Purchase. |
| Settings → **Customer events** (Custom pixels) | An existing Meta/Facebook custom pixel — remove or merge; do not run two. |
| **Apps / Sales channels** → Facebook & Instagram channel | This channel auto-injects a Pixel AND its own CAPI with its own event ids we cannot match → biggest double-count risk. Turn off its signal sharing, or don't deploy this pixel. Pick one integration. |
| Other pixel-manager apps (Elevar, Trackify, Pixel Perfect, GTM, etc.) | Any of these firing Purchase independently. |
| Settings → Checkout → **Order status page → Additional scripts**; `checkout.liquid` (Plus only) | Legacy pixel snippets on the thank-you page. |

Also verify the **order-id shape**: confirm the pixel's `checkout.order.id` on the
thank-you page reduces to the same numeric id as the `orders/create` webhook's
`id`. The Diagnostics dedup confirmation in step 4 is the definitive check.

## Files

- `src/index.js` — the pixel: subscribes to `checkout_completed`, computes the
  shared `event_id`, sends the Purchase beacon. Never throws.
- `src/event-id.js` — browser mirror of `services/meta/event-id.ts` (keep in sync;
  the parity test guards it).
- `shopify.extension.toml` — web pixel config + `pixelId` setting.
