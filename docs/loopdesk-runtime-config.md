# LoopDesk runtime config (CONFIG-2B)

Storefront components read a stable `window.LoopDeskConfig` object. Legacy `window.LOOPDESK_CART_DRAWER_CONFIG` remains supported and is normalized into the namespaced runtime config by the drawer asset.

## Namespaces

```js
window.LoopDeskConfig = {
  branding: {
    merchantName: "LoopDesk",
    storeName: "LoopDesk",
    logoUrl: null,
    primaryColor: "#111827",
    secondaryColor: "#374151",
    accentColor: "#2563eb",
    textColor: "#111827",
    surfaceColor: "#ffffff",
    borderRadius: "16px",
    fontFamily: "inherit",
    showPoweredBy: true,
    poweredByText: "Powered by LoopDesk"
  },
  labels: {
    expressCheckoutText: "Express Checkout",
    viewCartText: "View Cart",
    continueShoppingText: "Continue Shopping",
    loadingText: "Loading...",
    secureCheckoutText: "Secure checkout",
    otpContinueText: "Continue"
  },
  cart: {
    drawerMode: "auto", // "theme" | "loopdesk" | "auto"
    openAfterAddToCart: false,
    expressCheckoutButtonEnabled: true,
    viewCartButtonEnabled: true,
    nativeDrawerDisabledRequiredMessage: "To use LoopDesk Enhanced Drawer, set your theme cart type to Page in Shopify theme settings."
  },
  checkout: {
    showSecureBadge: true,
    showTrustCopy: true
  },
  otpCountryPolicy: {
    defaultCountryCode: "IN",
    allowedCountries: [
      { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" }
    ]
  }
};
```

## Drawer mode

- `theme`: LoopDesk does not take over cart triggers, so the theme cart remains the owner.
- `loopdesk`: LoopDesk Enhanced Drawer owns cart trigger interactions when storefront capability checks pass.
- `auto`: preserves current safe behavior and uses LoopDesk when capability checks pass.

To use LoopDesk Enhanced Drawer, merchants must disable the native theme drawer by setting the Shopify theme cart type/cart style to **Page**. The requirement message is also available at `window.LoopDeskConfig.cart.nativeDrawerDisabledRequiredMessage`.

## Runtime endpoint and persistence

The app exposes `/api/runtime/config` (and app-proxy path `/apps/megaska/api/runtime/config`) for the normalized config of the current shop. The endpoint reads `ShopModuleConfig` with module key `loopdesk_runtime_config`; no secrets are returned.

### Public OTP country policy

`window.LoopDeskConfig.otpCountryPolicy` delivers the merchant's saved country policy as public presentation metadata. `defaultCountryCode` is always the `iso2` value of an entry in `allowedCountries`; each allowed entry contains only `iso2`, `name`, `dialCode`, and `flag`.

Country metadata is resolved from the canonical server catalog. Unknown saved codes are omitted without rewriting the saved settings, duplicate codes are removed, and configured order is preserved. If no known countries remain, the runtime uses the India-only policy shown above. A missing or unavailable OTP settings record also safely yields that India-only default without making the runtime endpoint fail.

The public contract exposes no OTP provider selection, provider status, credentials, fallback configuration, shop ID, or database IDs. The storefront OTP modal does **not** consume this field in this phase: its UI, `+91` normalization, ten-digit validation, requests, and verification remain India-only until a later phase.

Today, a test merchant config can be supplied by setting `window.LoopDeskConfig` before `loopdesk-cart-drawer.js` loads, or by persisting JSON into `ShopModuleConfig.config` for `moduleKey = "loopdesk_runtime_config"`. A future merchant admin UI/installation wizard will manage these values.

## CONFIG-2B.1 Merchant Settings Foundation

Merchant Settings now provide the source model for runtime config. Settings are persisted in `ShopModuleConfig.config` with `moduleKey = "loopdesk_runtime_config"`, normalized by the LoopDesk merchant settings service, and projected to public runtime config containing only `branding`, `labels`, `cart`, `checkout`, `enabled`, and `cartOwnershipMode`.

General support fields, future integration statuses, and analytics placeholders are admin/foundation settings and are not exposed to storefront runtime config. See `docs/loopdesk-merchant-settings.md` for the full namespace map and public/private split.
