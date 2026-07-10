# CONFIG-4.4A — Shopify-Native Promotion Storefront Execution UAT

This UAT confirms whether Shopify applies the synchronized LoopDesk automatic app discount natively in `/cart.js` after the qualifying and reward variants are present in the Ajax cart.

## Confirmed synchronized rule

- Trigger variant: `gid://shopify/ProductVariant/51396701061418`
- Reward product: `gid://shopify/Product/9958145327402`
- Reward variant: `gid://shopify/ProductVariant/50870717907242`
- Reward quantity: `1`
- Reward enforcement: `fixed_price`
- Fixed final price: `200`
- Publication state:
  - `synchronized: true`
  - automatic discount `ACTIVE`
  - Shopify Function identity matched
  - compiled hash equals stored hash

## Temporary storefront diagnostics

Set the explicit browser flag before opening the drawer:

```js
window.LOOPDESK_PROMOTION_UAT_DEBUG = true;
```

With the flag enabled, the drawer logs a sanitized cart snapshot after offer add and cart refresh operations. The log intentionally includes only:

- cart item count
- `original_total_price`
- `total_discount`
- `total_price`
- line `key`, `variant_id`, `quantity`, `original_line_price`, `final_line_price`
- discount allocation titles and amounts
- publication synchronized state
- configured trigger and reward variant GIDs

Do not capture or paste customer identity, addresses, tokens, cookies, or other sensitive data in UAT evidence.

## Manual flow

A. Clear the cart.

B. Add the trigger variant:

```text
gid://shopify/ProductVariant/51396701061418
```

C. Open the LoopDesk cart drawer.

D. Confirm the offer CTA is enabled. The CTA must only be enabled when publication synchronization is true, the rule is eligible, the reward quantity cap is not reached, and no add operation is running.

E. Click **Add offer**.

F. Capture `/cart.js` after the drawer refreshes.

G. Confirm the reward line:

- `variant_id` matches `50870717907242`
- `original_line_price` is the Shopify original line value
- `final_line_price` reflects the Shopify promotion
- `discounts` / `line_level_discount_allocations` contains a native allocation when Shopify exposes it

H. Confirm `total_discount` and `total_price` in `/cart.js` reflect the promotion.

I. Remove the reward line and verify the promotion disappears from the Shopify cart response.

J. Add the reward again and verify consistent Shopify execution in `/cart.js`.

## Expected execution states

The temporary offer-card diagnostics expose:

- `data-loopdesk-offer-execution-state`
- `data-loopdesk-shopify-discount-observed`
- `data-loopdesk-reward-variant`

Valid execution-state values are:

- `unavailable`
- `eligible_not_added`
- `added_pending_shopify`
- `applied_by_shopify`
- `added_without_discount`
- `quantity_cap_reached`

`applied_by_shopify` requires Shopify evidence from `/cart.js`: either the reward line final price is lower than the original line price, or the reward line includes a positive Shopify discount allocation.

## Pricing authority guardrails

- The storefront must add the configured reward variant through Shopify Ajax Cart.
- The storefront must fetch `/cart.js` after mutations.
- UAT must derive applied monetary evidence from Shopify cart fields only.
- Do not calculate the expected ₹200 price locally.
- Do not treat the configured fixed final price as applied unless Shopify returns that line price.

## Temporary retry behavior

If the reward line is present but Shopify has not yet exposed discounted cart pricing, the drawer shows:

```text
Offer added, but the promotional price is still updating. Refreshing…
```

The drawer then retries one bounded cart refresh. If Shopify still does not expose discount evidence, the drawer shows:

```text
We couldn’t confirm the promotional price. Please try again.
```
