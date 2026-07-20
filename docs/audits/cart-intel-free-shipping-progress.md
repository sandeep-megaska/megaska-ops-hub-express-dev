# Cart Intelligence free-shipping audit

## Shipping scope

Neither active Shopify app configuration requests `read_shipping`. The delivery-profile reader therefore treats access denial as `UNSUPPORTED`; no scope is added automatically. A merchant must approve `read_shipping` separately before Shopify delivery method definitions can be synchronized.

## Authority and failure behavior

Shopify remains the shipping authority. This module reads delivery profiles but never writes rates, creates discounts, intercepts checkout, or changes Express Checkout delivery calculations. The storefront bar is hidden for ambiguous profiles, unsupported conditions, carrier-calculated rates, currency mismatch, malformed responses, and unresolved destination/zone applicability.

The drawer asset loads independently of runtime synchronization. If the runtime request or Shopify Admin API fails, the drawer continues to open and the progress component is omitted unless the merchant explicitly selected an eligible fallback mode.

## Runtime contract

`cart_intelligence_config.freeShippingProgress` contains only normalized public settings and resolution metadata: source mode, optional fallback threshold in minor units, display text, detected Shopify threshold/currency/profile, status, source, diagnostic, and synchronization time. Existing stored `freeShippingThreshold` values are retained as the backward-compatible fallback display threshold; the default source mode is `SHOPIFY_ONLY`.
