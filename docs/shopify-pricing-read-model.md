# CONFIG-4.1 Shopify Pricing Read Model capability report

## Evidence inspected

The repository already has Storefront Cart helpers for checkout recovery and buyer identity, but the visible cart journey is app-owned. No existing drawer path exposes a stable Storefront Cart ID that can be used for every background pricing refresh. The initial source is therefore Shopify Ajax Cart `/cart.js`, which maps directly to the browser cart state that LoopDesk mutates in the background.

## Source capability matrix

| Capability | `/cart.js` | Storefront Cart GraphQL |
| --- | --- | --- |
| Original subtotal | Yes (`original_total_price`) | Yes (`cost.subtotalAmount`/line costs when queried) |
| Discounted subtotal | Yes (`items_subtotal_price`) | Yes |
| Final total | Yes (`total_price`) | Yes (`cost.totalAmount`) |
| Per-line original total | Yes (`original_line_price`) | Yes |
| Per-line discounted total | Yes (`final_line_price`) | Yes |
| Line discount allocations | Yes (`items[].discounts`) | Yes when queried |
| Cart discount allocations | Not reliably exposed as normalized allocations | Yes when queried |
| Discount code and applicability | Code/title may appear, applicability is not explicit | Yes (`discountCodes.applicable`) |
| LoopDesk app discount attribution | Not explicit; do not fabricate | Not explicit unless Shopify returns app attribution in allocations |

## Captured payload scenarios

Fixtures cover the observed Ajax Cart shapes required by this phase:

1. no discount
2. LoopDesk Discount Function line discount only
3. Shopify discount code only
4. LoopDesk Function + Shopify code
5. coupon removed
6. multi-line cart

The normalizer preserves Shopify integer minor units and does not recompute offer discounts, coupon percentages, combinations, or final payable totals.

## Initial source decision

Use `/cart.js` first. It is available in the app-owned drawer background flow without requiring the native cart page or a Storefront Cart ID. Storefront Cart remains represented as a source abstraction for a future switch once the drawer has reliable cart identity and token handling.

## Migration recommendations

### CONFIG-4.2 Drawer consumption

Have the drawer refresh Shopify cart state after LoopDesk cart mutations, call `selectShopifyPricingSource().readPricing(...)`, and render monetary fields only from `ShopifyPricingReadModel`. Keep the Promotion View Model for offer cards and pre-mutation messaging.

### CONFIG-4.3 Express Checkout consumption

Have Express Checkout receive or refresh the same read model before payment method presentation. Use `finalTotal` exactly as Shopify provides it when available; do not subtract discounts locally. Treat shipping and tax as unavailable until the selected source exposes them for the checkout context.

## CONFIG-4.2 real-store `/cart.js` validation checklist

Actual production/staging store captures must be taken before enabling the drawer pricing path for a merchant because Shopify is the only pricing authority. Use the browser Network panel or:

```js
await fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => r.json())
```

Capture and archive the JSON payloads for these six states:

| Scenario | Evidence to confirm | Expected drawer behavior |
| --- | --- | --- |
| No discount | `items[].discounts` absent/empty, `total_discount = 0`, `total_price = original_total_price` | Render Shopify original/final totals with no discount row. |
| LoopDesk Discount Function only | Shopify must reduce `items[].final_line_price`, `total_discount`, and `total_price`; line allocation may appear in `items[].discounts` when Shopify exposes it | Render Shopify final line totals and either detailed allocation rows or aggregate `Discounts`. |
| Shopify code only | Code/title may appear in `cart_level_discount_applications`; line detail may appear in `items[].discounts` | Render exposed code labels only; otherwise aggregate `Discounts`. |
| LoopDesk Function + Shopify code | `total_discount` and `total_price` must already include both discounts | Render Shopify's combined result; never stack locally. |
| Coupon removed | `cart_level_discount_applications` clears and `total_discount`/`total_price` move back to Shopify's current authoritative values | Remove code labels and update totals after refresh. |
| Multiple cart lines | Each `items[]` row includes authoritative `original_line_price` and `final_line_price` | Render per-line Shopify original/final totals and allocations by matching line key/variant. |

Observed Ajax Cart capability for this implementation:

- `items[].discounts`: contains detailed allocation labels/amounts only when Shopify exposes them. Do not fabricate attribution when absent.
- `items[].final_line_price`: authoritative discounted line total after Shopify applies all eligible native/function/code discounts.
- `total_discount`: authoritative aggregate discount when detailed allocation rows are missing.
- `total_price`: authoritative final cart total for the drawer.

If the LoopDesk Function scenario does not reduce `final_line_price`, `total_discount`, and `total_price`, stop rollout for that merchant and fix the Discount Function publication/execution path. The drawer must not compensate with Promotion View Model math.

## CONFIG-4.2 UAT instructions

1. Publish the theme extension assets including `loopdesk-shopify-pricing.js`, `loopdesk-promotion-pricing.js`, and `loopdesk-cart-drawer.js`.
2. In a storefront browser session, enable `window.LOOPDESK_CART_DRAWER_DEBUG = true` and open the LoopDesk drawer.
3. For each validation scenario above, perform the cart mutation once and verify the Network panel shows a single `/cart.js` read for the refresh.
4. Compare drawer line totals, subtotal, discount rows, and final total to the captured `/cart.js` fields.
5. Verify any Promotion View Model output remains limited to offer cards, badges, eligibility/CTA copy, or clearly labelled estimates before Shopify refresh.
6. Remove a coupon and confirm the next `/cart.js` response removes/updates code labels and totals in the drawer without navigating to `/cart`.
