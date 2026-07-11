# CONFIG-2F.2R — Repository Architecture Audit & Promotion Rebuild Planning

Status: audit-only planning deliverable. No promotion runtime, schema, route, UI, or extension implementation is approved by this document.

## 1. Exact reusable-service register

| Need | Reuse location | Exported / stable symbol or boundary | Decision |
|---|---|---|---|
| Shop resolution from requests | `services/shopify/shop-resolver.ts` | `normalizeShopDomain`, `getShopDomainFromRequest`, `getShopByDomain`, `getDefaultShopFromConfig`, `resolveShopConfig` | Reuse unchanged for Admin/server runtime lookup. |
| Storefront app-proxy shop resolution | `services/shopify/app-proxy.ts` | `resolveStorefrontShopFromAppProxyRequest`, `requireStorefrontShopFromAppProxy`, `requireEnabledModule` | Reuse unchanged for app-proxy routes. |
| Admin token resolution | `services/shopify/admin-token.ts` | `resolveShopifyAdminAccessToken`, `ResolvedShopifyAdminAccessToken` | Reuse unchanged for compiler/catalogue/Admin GraphQL calls. |
| Admin GraphQL execution | `services/shopify/admin.ts` | internal `adminGraphql<T>` plus exported wrappers such as `debugShopifyAdminAuth`; no generic public export exists today | Do not duplicate token logic; later either add a narrow exported catalogue client or promotion-owned wrapper that calls an approved exported Admin client. |
| Runtime config endpoint | `app/api/runtime/config/route.ts` | `GET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"` | Extend only by adding a promotion projection to existing contract after approval. No second runtime endpoint. |
| Runtime public service | `services/loopdesk/runtime-config.ts` | re-exports `getLoopDeskRuntimeConfig`, `LoopDeskPublicRuntimeConfig` | Reuse boundary; add promotion projection only after approval. |
| Tenant module config | `services/loopdesk/merchant-settings.ts` | `LOOPDESK_RUNTIME_CONFIG_MODULE_KEY`, `CART_INTELLIGENCE_CONFIG_MODULE_KEY`, `getLoopDeskRuntimeConfig`, `getCartIntelligenceSettings` | Reuse for module-level flags only, not rule storage. |
| App Bridge shell/status | `app/AdminEmbeddedProvider.tsx` | `AdminEmbeddedProvider`, `useEmbeddedAdminStatus` | Reuse for Admin pages and Resource Picker availability. |
| Resource Picker diagnostic | `app/AdminEmbeddedDiagnostic.tsx` | default diagnostic component | Reuse as regression signal; do not create a second bridge stack. |
| Cart drawer | `extensions/megaska-otp/assets/loopdesk-cart-drawer.js` | `window.LoopDeskCartController`, internal `fetchCart`, `refreshAndMaybeOpen`, `changeLine`, `render`, `openLoopDeskExpressCheckout` | Reuse and protect; future promotion integration should be a small boundary or separate asset. |
| Checkout bridge | `extensions/megaska-otp/assets/loopdesk-checkout-bridge.js` | `window.LoopDeskCheckoutBridge` boundary | Protect; promotions must not alter checkout trigger suppression without regression approval. |
| Express Checkout intent | `app/api/express/checkout/intents/route.ts` | `POST`, `OPTIONS` | Reuse; promotion-added cart lines must appear only as refreshed Shopify cart contents. |
| Coupon mutation | `app/api/express/checkout/intents/[id]/discount/route.ts` | `POST`, `DELETE`, internal `calculateKnownDiscount` | Protect; promotion discounts must not replace coupon flow. |
| Store Credit checkout service | `services/express-checkout/store-credit.ts` | `getAvailableStoreCreditForCheckout`, `applyStoreCreditToCheckout`, `releaseStoreCreditReservation`, `consumeStoreCreditReservationForOrder` | Protect; promotion eligibility must stay outside Store Credit accounting. |
| Draft order / order creation | `app/api/express/checkout/intents/[id]/order/route.ts` | `POST`, `OPTIONS` | Protect; Shopify-confirmed totals and existing Store Credit behavior remain authoritative. |
| Money and cart normalization | `services/storefront-pricing/normalize.ts`, `services/storefront-pricing/types.ts`, drawer `formatMoney` | `normalizeStorefrontCartPricingSnapshot` if needed; drawer local formatter | Reuse for snapshots; promotion UI should use cart/shop currency and avoid local final-total math. |

## 2. Exact protected-file register

Protected by default, read/reuse only unless an implementation prompt explicitly approves a narrow change:

- Shopify foundation: `services/shopify/shop.ts`, `services/shopify/shop-resolver.ts`, `services/shopify/admin.ts`, `services/shopify/admin-token.ts`, `services/shopify/storefront.ts`, OAuth routes under `app/api/auth/**`.
- Runtime foundation: `app/api/runtime/config/route.ts`, `services/loopdesk/runtime-config.ts`, `services/loopdesk/merchant-settings.ts`.
- Cart foundation: `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`, `extensions/megaska-otp/assets/loopdesk-cart-drawer.css`, `extensions/megaska-otp/assets/loopdesk-checkout-bridge.js`, `extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid`.
- Checkout/payments: `app/api/express/checkout/**`, `services/express-checkout/**`, `services/razorpay/**`, Store Credit wallet services, COD advance services.
- Stable business modules: GST, issues, exchanges, cancellations, refunds, reverse pickup, shipment tracking, customer identity, customer dashboard.

## 3. Exact approved extension-point register

Extend only after approval:

1. `services/loopdesk/merchant-settings.ts` / `services/loopdesk/runtime-config.ts`: add storefront-safe `promotions` projection only.
2. `app/api/runtime/config/route.ts`: continue returning `Cache-Control: no-store`; do not change shop resolver.
3. `app/admin/*` navigation/shell: add Promotions entry when Admin phase is approved.
4. `extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid`: load a separate promotion asset only if runtime contract requires it.
5. `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`: add a small integration hook only; do not rewrite cart interception, render, quantity, or checkout handoff.
6. `shopify.app.megaska-ops-hub-express-dev.toml`: scopes/webhook registration only if collection/product synchronization requires it.
7. `app/api/webhooks/**`: add product/collection handlers only after sync design approval.

## 4. Existing Resource Picker architecture map

`app/AdminEmbeddedProvider.tsx` declares Resource Picker resource and variant types, reads `window.shopify?.resourcePicker`, exposes provider state through `useEmbeddedAdminStatus`, and tracks availability, host, API key, and App Bridge script state. `app/AdminEmbeddedDiagnostic.tsx` directly tests `window.shopify?.resourcePicker({ type: "product", multiple: false })` for embedded Admin regression coverage.

There is no existing promotion-specific product/collection selection normalizer. Future selection normalization should live in the promotion bounded context and preserve Shopify GIDs plus merchant-facing labels/images as non-authoritative display data.

## 5. Existing Shopify Admin client map

- `services/shopify/admin-token.ts` resolves Admin tokens from runtime client credentials, direct stored tokens, or encrypted stored tokens through `resolveShopifyAdminAccessToken`.
- `services/shopify/admin.ts` owns the GraphQL HTTP call in internal `adminGraphql<T>`, using `SHOPIFY_API_VERSION = "2026-01"`.
- `shopify.app.megaska-ops-hub-express-dev.toml` configures webhook API version `2026-04` and app scopes including `read_products`, `write_products`, `read_discounts`, and `write_discounts`.

Planning implication: promotion compiler work needs an approved Admin catalogue abstraction before resolving collection memberships or product-type memberships. Do not copy/paste a second Admin GraphQL client.

## 6. Existing cart-drawer function map

Important internal functions in `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`:

- Config/runtime: `normalizeConfig`, `applyRuntimeConfig`.
- Theme/cart interception: `isCartMutationRequest`, `isCartAddRequest`, `refreshAfterCartMutation`, `applyCartTriggerTakeover`.
- Rendering: `formatMoney`, `renderLines`, `render`.
- Cart IO: `fetchCart`, `refreshAndMaybeOpen`, `changeLine`.
- Express Checkout: `openLoopDeskExpressCheckout`.
- Public controller: `window.LoopDeskCartController` with `open`, `close`, `refresh`, `applyConfig`, `isOpen`, `isLoopDeskDrawerActive`.

Promotion card work must consume these boundaries rather than creating independent cart state.

## 7. Existing Express Checkout and coupon map

- Drawer handoff starts in `openLoopDeskExpressCheckout` and passes the latest cart snapshot to `window.LoopDeskCheckout.open` when available.
- `app/api/express/checkout/intents/route.ts` creates/updates checkout intents and captures discount code hints from request body, cart attributes, `discount_codes`, or cart-level discount applications.
- `app/api/express/checkout/intents/[id]/discount/route.ts` applies/removes Express Checkout coupon state with `POST` and `DELETE`.
- `services/express-checkout/discounts.ts` and `services/express-checkout/coupon-resolver.ts` contain generic coupon calculation/definition resolution helpers.
- `app/api/express/checkout/intents/[id]/order/route.ts` folds intent discounts and Store Credit into Shopify draft-order creation.

Planning implication: promotions must not calculate final payable totals or promise coupon stacking. Shopify discount functions and coupon/application outcomes remain authoritative.

## 8. Existing Store Credit interaction map

`services/express-checkout/store-credit.ts` owns checkout-time Store Credit reservation, release, and consumption. It currently uses INR/paise conventions and `WalletReservation` rows tied to `checkoutReference`. Order creation reads the active reservation, applies it into the draft order discount amount, records note attributes, releases on Shopify errors, and consumes after successful order creation.

Planning implication: promotions must not couple to wallets, Razorpay, COD, GST, or Delhivery. Promotion lines should appear in the Shopify cart before Express Checkout opens.

## 9. Exact Function API and extension conventions

- Existing configured extension directory: `extensions/loopdesk-discount-function/` currently contains only `Cargo.lock`; it has no `shopify.extension.toml`, function source, input query, or generated schema in this checkout.
- Existing validation extension: `extensions/megaska-phone-checkout-validation/src/cart_validations_generate_run.graphql` and JS source show Shopify Function style already exists for checkout validation.
- App config webhook API version is `2026-04`; `services/shopify/admin.ts` Admin GraphQL calls use `2026-01`.

Planning implication: CONFIG-2F.6R must first establish a complete isolated discount function extension, verify the generated Function schema for product type availability, and document the exact API version in the extension TOML before implementation.

## 10. Collection synchronization strategy

Use compiled membership, not browser-side collection lookup.

Source-of-truth model:

- Admin authored rule stores raw collection GIDs.
- Compiler resolves product IDs for those collections using approved Admin catalogue infrastructure.
- Storefront projection and Discount Function projection evaluate product identity.

Refresh triggers to design in later phases:

1. Promotion save/republish: synchronous compile.
2. Manual sync: Admin action to refresh selected collections.
3. Product update webhook: enqueue affected collection/product membership recompile.
4. Collection update webhook: enqueue affected rules.
5. Scheduled reconciliation: later hardening feature.

Current repository has `app/api/webhooks/orders/create/route.ts` and `app/api/webhooks/app/uninstalled/route.ts`, but no product or collection webhook handlers, so those must be new promotion-owned sync handlers after approval.

## 11. Product-type execution strategy

Store merchant-facing original values and normalized comparison values:

- Trim whitespace.
- Unicode normalize.
- Case-fold for exact comparison.
- No substring matching.

Preferred first implementation decision: verify Function input schema. If product type is reliably available in the selected Product Discount Function API, both storefront and function can evaluate normalized product type. If not, compile product-type references into product-ID membership exactly like collection triggers, while preserving the raw product-type values in the Admin source model.

## 12. Proposed bounded-context directory

Use one authoritative bounded context:

```text
services/promotions/
app/admin/promotions/
extensions/loopdesk-discount-function/
extensions/megaska-otp/assets/loopdesk-promotion-offers.js
extensions/megaska-otp/assets/loopdesk-promotion-offers.css
```

Forbidden overlapping ownership: simultaneous `services/loopdesk/promotion-*`, `services/promotion-rules/*`, and `services/promotions/*` with duplicated rule responsibilities.

## 13. Proposed new-file list

No files are approved for creation until the next implementation phase. When approved, create only promotion-owned files such as:

- `services/promotions/domain.ts`
- `services/promotions/normalization.ts`
- `services/promotions/validation.ts`
- `services/promotions/repository.server.ts`
- `services/promotions/compiler.server.ts`
- `services/promotions/runtime-projection.server.ts`
- `services/promotions/publication.server.ts`
- `services/promotions/diagnostics.server.ts`
- `app/admin/promotions/page.tsx`
- `app/admin/promotions/actions/*`
- `app/admin/promotions/components/*`
- `extensions/megaska-otp/assets/loopdesk-promotion-offers.js`
- `extensions/megaska-otp/assets/loopdesk-promotion-offers.css`
- complete Discount Function files under `extensions/loopdesk-discount-function/`

## 14. Proposed extend-only file list

- `services/loopdesk/merchant-settings.ts`
- `services/loopdesk/runtime-config.ts`
- `app/api/runtime/config/route.ts`
- `app/AdminNavLink.tsx` or current Admin navigation owner once verified in the Admin phase
- `extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid`
- `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`
- `shopify.app.megaska-ops-hub-express-dev.toml`
- `app/api/webhooks/**`

## 15. Regression test plan

Minimum checks before each future promotion merge:

- Static/build: `npm run typecheck`, `npm run lint`, `npm run build` when environment permits.
- Admin smoke: dashboard, merchant settings save, Store Credit Admin, GST Admin, issues, exchanges, cancellations, App Bridge initialization, Resource Picker availability.
- Cart smoke: cart icon takeover, add-to-cart opens drawer per settings, quantity increase/decrease, removal, totals refresh, empty cart, theme drawer suppression, View Cart, Express Checkout handoff.
- Express Checkout smoke: modal opens, Shopify cart parity, address selection, shipping validation, coupon apply/remove, Store Credit apply/remove, Razorpay, COD, order creation.
- Promotions when implemented: product, collection, product-type triggers; ANY/ALL readiness; quantity thresholds; offer variant selector; sold-out/unavailable variant handling; trigger removal after offer; cap enforcement; multiple rules and priority; same offer product across rules; Shopify discount application; compatible/incompatible coupon outcomes; expired/disabled rules; collection sync.

## 16. First Codex implementation prompt

Use this prompt only after CONFIG-2F.2R is approved:

```text
Implement CONFIG-2F.3R only: Promotion Domain Model and Persistence Architecture design. Do not modify cart drawer, runtime config, Express Checkout, Shopify Function, webhooks, or Admin Resource Picker UI. First inspect current Prisma conventions and audit fields, then propose the exact promotion-owned schema and service files under one bounded context. Create no runtime promotion behavior. Include tests for pure normalization/validation only if schema implementation is explicitly approved in this phase.
```
