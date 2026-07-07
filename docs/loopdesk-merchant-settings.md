# LoopDesk Merchant Settings Foundation

CONFIG-2B.1 stores long-term merchant settings in `ShopModuleConfig.config` using `moduleKey = "loopdesk_runtime_config"`. No dedicated Prisma table or migration is required because the current settings are structured JSON and do not need relational querying.

## Namespaces

- `general`: `merchantName`, `storeName`, `supportEmail`, `supportPhone`, `supportWhatsApp`.
- `branding`: `logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `textColor`, `surfaceColor`, `borderRadius`, `fontFamily`, `showPoweredBy`, `poweredByText`.
- `labels`: `expressCheckoutText`, `viewCartText`, `continueShoppingText`, `loadingText`, `secureCheckoutText`, `otpContinueText`.
- `cart`: `drawerMode`, `openAfterAddToCart`, `expressCheckoutButtonEnabled`, `viewCartButtonEnabled`, `nativeDrawerDisabledRequiredMessage`.
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
