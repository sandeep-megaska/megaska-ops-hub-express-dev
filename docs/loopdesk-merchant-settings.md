# LoopDesk Merchant Settings Foundation

CONFIG-2B.1 stores long-term merchant settings in `ShopModuleConfig.config` using `moduleKey = "loopdesk_runtime_config"`. No dedicated Prisma table or migration is required because the current settings are structured JSON and do not need relational querying.

## Namespaces

- `general`: `merchantName`, `storeName`, `supportEmail`, `supportPhone`, `supportWhatsApp`.
- `branding`: `logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `textColor`, `surfaceColor`, `borderRadius`, `fontFamily`, `showPoweredBy`, `poweredByText`.
- `labels`: `expressCheckoutText`, `viewCartText`, `continueShoppingText`, `loadingText`, `secureCheckoutText`, `otpContinueText`.
- `cart`: `drawerMode`, `openAfterAddToCart`, `expressCheckoutButtonEnabled`, `viewCartButtonEnabled`, `nativeDrawerDisabledRequiredMessage`, `customCartTriggerSelector`.
- `checkout`: `showSecureBadge`, `showTrustCopy`.
- `integrations`: read-only placeholders for Razorpay and Delhivery status/display names.
- `analytics`: read-only placeholder flags.

## Public vs. private/admin-only

Public storefront runtime config currently includes only `branding`, `labels`, `cart`, `checkout`, `enabled`, and `cartOwnershipMode`. Admin-only/foundation data includes `general.supportEmail`, `general.supportPhone`, `general.supportWhatsApp`, `integrations`, and `analytics`.

Secrets must never be stored in or returned by this runtime foundation. Razorpay secrets, Delhivery tokens, private API keys, and database credentials are excluded from the public runtime config.

## Editable fields now

The minimal admin page at `/admin/merchant-settings` can edit merchant/contact display fields, branding colors/logo/powered-by copy, cart mode/button flags, selected storefront labels, and checkout badge/trust-copy flags.

Read-only placeholders are displayed for Razorpay status, Delhivery status, and analytics enabled.

## Runtime config relationship

`services/loopdesk/merchant-settings.ts` normalizes stored merchant settings, validates safe values, merges allowed updates, persists to `ShopModuleConfig`, and derives public runtime config. `/api/runtime/config` continues to return the CONFIG-2B compatible shape for `window.LoopDeskConfig`.

`loopdesk-cart-drawer.js` continues to normalize `window.LoopDeskConfig` and preserve `window.LOOPDESK_CART_DRAWER_CONFIG` for backward compatibility.

## Native theme drawer requirement

To use LoopDesk Enhanced Drawer, merchants must disable the native theme drawer by setting the Shopify theme cart type/cart style to **Page**. Branding config affects appearance/text only and must not change cart or checkout functionality.

Setting cart type to **Page** has a side effect worth knowing: some themes' own add-to-cart JS, upon detecting that cart type is Page, redirects the browser to `/cart` after a successful add — even when our fetch/XHR patch already opened the LoopDesk drawer for that same add. `patchLocationNavigation()` in `loopdesk-cart-drawer.js` redirects `location.assign`/`location.replace` navigation to `/checkout` into Express Checkout, and to `/cart` into keeping the drawer open, whenever LoopDesk owns the drawer. This only covers `.assign()`/`.replace()` calls — a theme using a direct `location.href = ...`/`window.location = ...` assignment isn't interceptable this way; no script can override that setter, by browser design.

For that remaining case, `loopdesk-cart-drawer.js` takes a different approach rather than trying (and failing) to prevent it: right before a cart-add form submits, if LoopDesk would own the resulting drawer, it records the current page URL in `sessionStorage` (without touching the submission itself — the theme's own AJAX call and any native UI side effects, like header cart-count badges, still fire exactly as they always have). If that recorded intent is still fresh (under 8 seconds old) and the *next* page load lands on `/cart`, the script immediately bounces back to the recorded URL via `location.replace()` and reopens the LoopDesk drawer there. This works regardless of *how* a given theme redirects — it doesn't depend on catching the specific navigation call — and it never disables any of a theme's native add-to-cart behavior, so nothing else that currently works can regress. The trade-off is a brief visible flash of the native cart page during the bounce-back, rather than the navigation never happening at all.

To keep that flash as short as possible, `loopdesk-cart-drawer-embed.liquid` runs an inline fast-path copy of the bounce-back check synchronously, before any deferred asset (`loopdesk-cart-drawer.js` itself, its `loopdesk-promotion-pricing.js` dependency) even starts fetching. `loopdesk-cart-drawer.js` repeats the same check once it loads, as a fallback in case the inline copy doesn't run for some reason. Both copies must use the exact same `sessionStorage` keys (`loopdeskCartAddReturnTo`, `loopdeskCartAddReopenDrawer`) and 8-second max age — `scripts/loopdesk-cart-drawer-regression.test.mjs` asserts they stay in sync.

## Universal cart icon interception

`loopdesk-cart-drawer.js` intercepts clicks on the storefront's cart/bag icon using a broad, theme-agnostic heuristic: it recognizes any link to `/cart`, common ARIA/id/class naming conventions (`cart-icon`, `mini-cart`, `header__icon--cart`, `cart-toggle`, `cart-trigger`, `basket`, etc.), and cart-related SVG icon glyphs (`<use href="#icon-cart">`, `img[alt="Cart"]`). It also listens for the custom events many themes fire when opening their own drawer (`cart:open`, `cart-drawer:open`, `ajaxCart:open`, and similar), and neutralizes/hides the native drawer if it still renders.

For themes whose cart icon markup doesn't match any known convention, set **Custom cart icon selector (advanced)** under Cart behavior in `/admin/merchant-settings` to a CSS selector for that theme's cart icon (comma-separate multiple selectors). Any element matched by this selector is treated as an authoritative cart trigger, bypassing the text/keyword heuristic entirely. This setting is optional and only needed when automatic detection misses a specific theme's markup.
