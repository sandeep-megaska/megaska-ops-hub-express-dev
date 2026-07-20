# Checkout pricing authority audit

## Locked boundary

Shopify is the authority for product prices, discounts, coupons, shipping, tax,
Markets presentment currency, and the final payable amount. LoopDesk may project
those values and apply store credit through its Shopify integration, but must not
derive a jurisdiction, rate, tax name, or tax amount. Payment must be blocked when
its currency or amount differs from the refreshed Shopify Draft Order.

## Current pricing-source inventory

| Area | Current source | Required authority / follow-up |
| --- | --- | --- |
| Theme cart and progress | Shopify Ajax Cart (`items_subtotal_price`, `total_discount`, `total_price`) | Valid for cart display; shipping and tax are unavailable until Shopify calculates them. |
| Express intent | Client cart snapshot and client minor-unit fields | Transitional only. Refresh a Shopify Draft Order after address, shipping, promotion, coupon, payment-method, or store-credit changes. |
| Coupon endpoint | LoopDesk percentage/fixed arithmetic | Must be replaced by a Shopify discount-code/function result before payment. |
| Payment method endpoint | Local subtotal + shipping + fee - discount | Must not be payment authority. Use refreshed Draft Order total. |
| Razorpay | Stored intent total less reserved store credit | Gate order creation with `assertShopifyPaymentTotal` against the refreshed Draft Order. |
| COD | Stored intent total; Draft Order is created immediately before completion | Compare the returned Draft Order total and block completion on mismatch. |
| Shipping | Client amount copied into a custom Draft Order shipping line | Resolve a Shopify shipping rate/profile and then refresh the Draft Order. |
| Promotions | Shopify Discount Function plus theme presentation | Shopify allocation is authoritative; never reconstruct taxable value. |
| GST invoice import | Completed Shopify order, but mapper currently imports rates and invoice code can recompute splits | Import completed-order line/order tax amounts and titles directly; local computation remains suitable only for explicitly manual compliance documents. |

## Shared contract

`services/storefront-pricing/tax-summary.ts` is the country-neutral boundary. It
accepts Shopify Draft Order money and tax lines, preserves Shopify's tax titles,
supports inclusive, exclusive, exempt, and market-currency results, and exposes
payment-integrity diagnostics. It intentionally has no GST/VAT/state/country
branches and no tax formula.

## Mandatory rollout gates

1. Persist the refreshed Draft Order ID and `TaxSummary` on each intent.
2. Make address, shipping, discount, promotion, and store-credit changes invalidate
   the snapshot and refresh Shopify.
3. Require a current snapshot before Razorpay creation or COD completion.
4. Compare Razorpay/COD amount and currency using `assertShopifyPaymentTotal`.
5. After completion, compare the Shopify Order total to the authorized Draft Order;
   alert and stop automatic capture/finalization wherever the gateway permits.
6. Migrate GST invoice sync to completed-order monetary tax lines, including
   shipping tax and discount allocations, without reconstructing CGST/SGST/IGST.

## UAT matrix

Run each case through address and shipping refresh, Razorpay, COD, completed order,
and invoice reconciliation: inclusive and exclusive tax; intra/interstate India;
taxable and free shipping; product/order/function promotion; coupon; store credit;
mixed taxable/exempt cart; exempt customer/product; Shopify Markets (US, UK, EU,
UAE); draft refresh; address change; and shipping-method change. The acceptance
invariant is Draft Order total = displayed total = gateway/COD total = Order total.
