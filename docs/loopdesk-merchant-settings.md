# LoopDesk Merchant Settings Foundation

CONFIG-2B.1 stores long-term merchant settings in `ShopModuleConfig.config` using `moduleKey = "loopdesk_runtime_config"`. No dedicated Prisma table or migration is required because the current settings are structured JSON and do not need relational querying.

## Namespaces

- `general`: `merchantName`, `storeName`, `supportEmail`, `supportPhone`, `supportWhatsApp`.
- `branding`: `logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `textColor`, `surfaceColor`, `borderRadius`, `fontFamily`, `showPoweredBy`, `poweredByText`.
- `labels`: `expressCheckoutText`, `viewCartText`, `continueShoppingText`, `loadingText`, `secureCheckoutText`, `otpContinueText`.
- `cart`: `drawerMode`, `openAfterAddToCart`, `expressCheckoutButtonEnabled`, `viewCartButtonEnabled`, `nativeDrawerDisabledRequiredMessage`, `customCartTriggerSelector`.
- `account`: `dashboardRedirectEnabled`, `dashboardPath`, `customTriggerSelector`.
- `checkout`: `showSecureBadge`, `showTrustCopy`.
- `integrations`: read-only placeholders for Razorpay and Delhivery status/display names.
- `analytics`: read-only placeholder flags.

## Public vs. private/admin-only

Public storefront runtime config currently includes only `branding`, `labels`, `cart`, `account`, `checkout`, `enabled`, and `cartOwnershipMode`. Admin-only/foundation data includes `general.supportEmail`, `general.supportPhone`, `general.supportWhatsApp`, `integrations`, and `analytics`.

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

## Universal account icon interception

`megaska-otp.js` intercepts clicks on the storefront header's account/login icon the same way: a broad selector list (`account-icon`, `account-toggle`, `my-account`, `header__icon--account`, etc.), plus an icon-only fallback that matches on SVG icon glyphs (`<use href="#icon-account">`) or `aria-label`/class text containing "account"/"login"/"signin"/"profile" when no CSS convention matches. Checkout, cart, search, logout, quantity, and menu-toggle controls are explicitly excluded so they're never mistaken for the account icon. Matched clicks are gated by the same OTP/session check used elsewhere before redirecting to the app dashboard (`/apps/megaska/account` by default).

If the theme has no native account icon, LoopDesk injects a fallback one. Finding where to insert it no longer depends solely on a hardcoded list of theme header container classes (`header__icons`, `header-actions`, etc.) — themes built on custom-element header architectures (e.g. Shopify's newer `<header-actions>`/`<cart-icon>` web-component-based themes) don't expose any of those classes, which used to mean the fallback icon silently never appeared. When no known container matches, LoopDesk now derives the insertion point structurally from the theme's own cart or search icon (always reliably detectable), inserting the fallback right beside it.

Under **Account dashboard** in `/admin/merchant-settings`:
- **Redirect account icon to app dashboard** — turns the whole feature on/off; when off, the theme's native account link/page behaves normally.
- **Dashboard path** — the relative app-proxy path customers land on instead of `/account` (must start with a single `/`).
- **Custom account icon selector (advanced)** — same escape hatch as cart: a CSS selector for themes whose account icon markup doesn't match any known convention, bypassing the heuristic entirely.

Both cart and account interception load from the same **Megaska OTP Embed** app embed block, which Shopify enables **per theme**. If either feature isn't working on a specific theme, first confirm the app embed is toggled on for that exact theme in the theme editor (Online Store → Customize → App embeds) before assuming it's a markup-detection gap.

## Buy Now / dynamic checkout button

Unlike the cart and account icons, Shopify's native "Buy it now" / Shop Pay / PayPal / Google Pay dynamic checkout button cannot be click-intercepted at all: Shopify renders its actual clickable surface inside a cross-origin iframe, so a parent-page click listener never receives that click, no matter the selector or event phase used.

`loopdesk-buy-now-bridge.js` works around this the same way `loopdesk-cart-drawer.js` handles native checkout buttons on the cart page: once Razorpay express checkout is ready (`window.LoopDeskConfig.express_checkout`), it hides the native dynamic checkout button (`.shopify-payment-button`, `[data-shopify="payment-button"]`, the `shopify-payment-button`/`shopify-accelerated-checkout` custom elements, and known theme-specific Buy Now buttons) and inserts an app-owned `.loopdesk-buy-now-cta` button in its place. That button is a normal same-document element, so its click reliably runs the same add-to-cart → OTP (if no session) → Razorpay express checkout flow as the cart drawer's Express Checkout button. A `MutationObserver` plus `shopify:section:load`/`shopify:block:select`/`loopdesk:runtime-config-ready` listeners re-apply this after variant changes, AJAX section re-renders, and late-arriving runtime config.

This intentionally replaces Shop Pay/PayPal/Google Pay's own one-click experience on that button with the app's unified OTP-gated checkout — that trade-off is why it's tied to Razorpay express checkout readiness rather than a separate toggle.
