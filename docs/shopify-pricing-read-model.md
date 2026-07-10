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
