# Meta Ads Integration Roadmap

## Goal

Increase D2C sales for megaska.com by improving the quality of the conversion
signal Meta optimizes against, unlocking dynamic catalog ads, and closing an
insight → recommendation loop against first-party order data. Built for the
megaska store first, with clean seams so the same modules can serve other
merchants ("own store now, SaaS later") without rewrites.

## Why signal quality is phase 1 (not creative)

The browser Pixel loses 30–50% of conversions to iOS/ITP/ad-blockers. Meta's
optimizer is only as good as the events it receives, so a server-side
Conversions API (CAPI) feed typically recovers measured conversions and lifts
ROAS **without changing a single ad**. Creative generation is higher-visibility
but lower-impact, and is sequenced later.

## Module plan and the existing services each reuses

| Module | Purpose | Reuses |
| --- | --- | --- |
| `services/meta/capi.ts` **(built)** | Server-side Conversions API: SHA-256 hashed PII, dedup `event_id`, never-throw send | `services/shopify/shopify-phone-normalization` (E.164), Node `crypto`, the `openai-client` env-flag/graceful-degrade pattern |
| `services/meta/oauth.ts` | Meta OAuth, long-lived/system-user tokens, ad-account + pixel selection | `services/shopify/token-crypto` (encrypt at rest), `services/shopify/admin-token` pattern |
| `services/meta/catalog-feed.ts` | Product feed for Advantage+ Shopping / dynamic retargeting | `services/commercial-catalog`, `services/shopify/product-handle-resolver`, `services/storefront-pricing` |
| `services/meta/marketing-api.ts` | Campaign/adset/ad reads + insights (read-only first) | `services/meta/oauth` |
| `services/meta/optimizer.ts` | Reconcile Meta insights vs. first-party orders → LLM recommendations | `services/analytics/ai-insights` (mirror), `services/analytics/checkout-funnel`, `services/orders` |
| `services/meta/creative.ts` | Background-swap + LLM ad copy; templated rendering | `services/ai/openai-client`, existing `@sparticuz/chromium` + `puppeteer-core` for deterministic template render |

## Phase 1 — Conversions API (in progress)

`services/meta/capi.ts` is landed and tested. It provides:

- **`sendCapiEvents` / `trackPurchase`** — never throw; a Meta outage or missing
  config degrades to a no-op so checkout/webhooks are never blocked.
- **PII hashing** per Meta's normalization rules: `em` (lowercased email),
  `ph` (E.164 digits-only via the shared Shopify normalizer, `+` stripped),
  `fn`/`ln`/`ct`/`st`/`country` (lowercased, whitespace-stripped), `zp`, and a
  hashed `external_id`. Browser identifiers (`client_ip_address`,
  `client_user_agent`, `fbc`, `fbp`) are sent raw, as Meta requires.
- **Deduplication + idempotency** via `deterministicEventId(eventName, sourceId)`
  — send the SAME id to the browser Pixel so the two copies collapse, and so
  webhook retries never double-count.
- **7-day event-time clamp** and never-future timestamps.

### Configuration (megaska single-store)

| Env var | Purpose |
| --- | --- |
| `META_PIXEL_ID` | Dataset/Pixel id events are posted to |
| `META_CAPI_ACCESS_TOKEN` | System-user token with `ads_management` on the ad account |
| `META_GRAPH_API_VERSION` | Optional; defaults to `v21.0` |
| `META_CAPI_TEST_EVENT_CODE` | Optional; routes to Events Manager → Test Events for verification |

CAPI stays a no-op until both `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` are
set — matching `isAiConfigured()`'s degrade-gracefully convention.

### Order → Purchase mapping

`services/meta/shopify-order-purchase.ts` maps a Shopify `orders/create` payload
to a CAPI Purchase and sends it: value/currency from `total_price`, `contents`
from line items, hashed customer identifiers, the trusted verified phone when
available, and a deterministic `event_id` from the numeric order id. Kept out of
the route so the extraction is unit-tested (`shopify-order-purchase.test.mts`).

### Remaining phase-1 wiring

1. ~~Call the Purchase send from the `orders/create` webhook handler.~~ **Done** —
   `app/api/webhooks/orders/create/route.ts` fires `sendOrderPurchaseToCapi` via
   `after()` for every order (post-response, isolated, no-op when unconfigured),
   reusing the already-HMAC-verified payload.
2. ~~Storefront Pixel must send the Purchase `event_id` derived the same way.~~
   **Done** — `extensions/megaska-meta-pixel/` is a Web Pixel extension that fires
   the Purchase with the shared `event_id`. The contract lives in
   `services/meta/event-id.ts` and is mirrored by the extension's
   `src/event-id.js`; `services/meta/event-id.test.mts` runs the extension file
   against the server and asserts byte-identical ids. **Before enabling, work
   through the compatibility checklist in the extension README** (remove any other
   Meta pixel — especially the Facebook & Instagram channel — that fires a
   Purchase with an id we don't control).
3. Emit `AddToCart` / `InitiateCheckout` from the existing funnel events
   (`services/analytics/funnel-events`), reusing the same `event_id` the theme
   Pixel sends.
4. Add `META_*` to `docs/environment-variables.md` and the SaaS env audit.
5. Verify matched conversions in Events Manager → Test Events using
   `META_CAPI_TEST_EVENT_CODE`.

## Later phases

- **Phase 2 — Catalog feed**: generate a clean product feed (GTIN, category,
  live price/availability) to enable Advantage+ Shopping and dynamic retargeting.
- **Phase 3 — Insight loop**: read Marketing API performance, reconcile against
  first-party order data (more accurate than Meta's attribution), surface margin-
  aware recommendations, mirroring `services/analytics/ai-insights`.
- **Phase 4 — Creative pipeline**: keep the real product photo, change only the
  background/scene (segmentation + inpainting), generate copy/headlines with the
  LLM, and render templated variants deterministically via the existing
  Puppeteer/Chromium setup.

## SaaS-later seam

Every send takes an explicit `MetaCapiConfig`. Today `resolveMetaCapiConfig()`
reads `process.env` for the single megaska store; a future per-shop resolver
reads encrypted per-shop tokens from the DB (as `services/shopify/admin-token`
does) and returns the same shape — no caller changes.

## Operating notes

- **App Review**: multi-tenant `ads_management` / `catalog_management` needs
  Business Verification + App Review (2–4 weeks). For megaska's own store a
  System User token skips most of this — the fast path taken here.
- **Attribution truth** lives in first-party order data, not Meta's numbers;
  the optimizer reconciles the two rather than trusting Meta's reported ROAS.
- **AI creative** does not reliably reproduce a real SKU; the supported pipeline
  edits background/scene and generates copy, preserving the real product image.
