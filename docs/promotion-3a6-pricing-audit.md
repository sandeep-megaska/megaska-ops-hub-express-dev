# PROMOTION-3A.6 pricing source audit

## Sources before this change

| Surface | Previous source | Risk |
| --- | --- | --- |
| Cart line price | Shopify AJAX `item.final_line_price` | Authoritative and retained. |
| Drawer footer | Shopify AJAX `cart.total_price`, labelled “Subtotal” | Correct value, ambiguous meaning. |
| Savings Summary | Locally recomputed reward-line delta plus coupon state and compare-at delta | Could double count Shopify `total_discount` and retain stale coupon state. |
| Coupon status | Refreshed `/cart.js`, `discount_codes` / `cart_level_discount_applications`; displayed all `total_discount` as coupon savings | Coupon attribution could include automatic discounts. |
| Tier progress | `cart.original_total_price` | Merchandise basis matches the Function `eligible_merchandise_subtotal` contract and is retained. Reward lines are included, matching the Function cart subtotal input. |
| Express Checkout | Fresh `/cart.js`; `original_total_price`, `total_discount`, and `total_price` copied independently into the locked snapshot | Values were Shopify-originated but had no shared reconciliation/fingerprint model. |
| Shopify checkout | Shopify checkout/cart pricing | Final authority. |
| Automatic discount combinations | Shopify `DiscountAutomaticApp.combinesWith`; synchronization reads and verifies the existing value | Preserved during V2 class updates; creation uses compiled configuration. |

## Canonical policy

`loopdesk-promotion-pricing.js` builds the one storefront pricing view model used by the drawer, Savings Summary, and Express Checkout snapshot. `original_total_price` is merchandise and tier-qualifying subtotal; `total_discount` is total savings; `total_price` is payable. Shopify values are never replaced by projections.

Allocations are categorized as product promotion, order promotion, coupon, shipping, manual, or unknown. A category split is displayed only when allocations reconcile exactly to Shopify's total discount and none are unknown. Otherwise the UI shows only Shopify's combined total and records warnings.

Combination status is three-state: `CAN_COMBINE`, `CANNOT_COMBINE`, or `NOT_VERIFIED`. Product/order, order/coupon, and shipping pairs use the corresponding Shopify combination flag; two order discounts are always blocked by the V1 policy. Shopify remains responsible for accepting or rejecting an entered coupon, after which `/cart.js` is refreshed.

## Observed mismatch root cause

The ₹900 figure cannot be produced by the tier progress code: that code reads the undiscounted ₹1,200 merchandise basis and does not calculate the drawer payable. Before this change, the drawer footer read Shopify `total_price` directly. Therefore ₹900 means Shopify returned ₹900 (another allocation/code was active) or a stale/mixed cart response was rendered; it was not the result of the displayed 10% tier calculation. The former Savings Summary could then misleadingly recompute and relabel layers. The canonical model now exposes mismatch/incomplete/unclassified warnings and always retains Shopify's payable.
