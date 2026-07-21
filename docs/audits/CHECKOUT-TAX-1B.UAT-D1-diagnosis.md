# CHECKOUT-TAX-1B.UAT-D1 — Draft Order line-price mismatch diagnosis

## Scope and evidence status

This is a diagnostic report only. No checkout, payment, promotion, Store Credit,
or GST code was changed.

The checkout identifier supplied for the incident is
`554352a7-2d20-4fe3-9a9c-29fbcafcacac`. The repository checkout contains no
matching record, log export, database credentials, Shopify Admin token, or
deployment-log credentials. Consequently, the production checkout row, its
Shopify IDs, and live Shopify product/Markets configuration could not be fetched
from this environment. This limitation is important: the supplied monetary
evidence identifies the **first observable** divergence, but it does not justify
claiming whether the Admin variant price, stale Ajax response, or contextual
Markets pricing caused Shopify to select ₹654.

No customer PII is reproduced below.

## 1. Exact records inspected

| Record | Identifier | Inspection result |
| --- | --- | --- |
| Express checkout intent | `554352a7-2d20-4fe3-9a9c-29fbcafcacac` | Not present in the repository; runtime database unavailable |
| LoopDesk cart snapshot | Belongs to the intent above | Supplied incident values only; raw row unavailable |
| Pricing snapshot | Belongs to the intent above | Runtime row unavailable |
| Draft Order | Not supplied | Cannot resolve without the intent/order-link row or Shopify logs |
| Completed Shopify order | Not supplied | Supplied incident totals only; ID, line ID, and variant ID unavailable |

The database schema would hold the cart and local totals on
`ExpressCheckoutIntent`, the authoritative Draft Order totals on
`ShopifyCheckoutPricingSnapshot`, the fixed discount on
`ExpressCheckoutDiscount`, and Draft/Order IDs on `ExpressCheckoutOrderLink`.

## 2. Monetary trace

`—` means the value is neither present in the supplied evidence nor retrievable
in this checkout. It must not be read as zero. Values marked “reported” come from
the incident statement rather than a fetched runtime record.

| Source | Variant ID | Quantity | Unit price | Line subtotal | Discount | Shipping | Tax | Total | Currency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Shopify Ajax cart | unavailable | unavailable | — | ₹600 reported | −₹120 reported | ₹0 reported | — | ₹480 reported | INR |
| LoopDesk cart snapshot | unavailable | unavailable | — | ₹600 reported | −₹120 reported | ₹0 reported | — | ₹480 reported | INR |
| Express Checkout frontend view model | unavailable | unavailable | — | ₹600 reported | −₹120 reported | ₹0 reported | not displayed | ₹480 reported | INR |
| Draft Order mutation input | unavailable | unavailable | **no monetary override in the code path** | Shopify-resolved | one fixed ₹120 reported | ₹0 reported | Shopify-resolved | Shopify-resolved | INR reported |
| Draft Order mutation response | unavailable | unavailable | — | not captured by the completion mutation | not captured | not captured | not captured | not captured | — |
| Persisted authoritative pricing snapshot | n/a | n/a | n/a | runtime row unavailable | runtime row unavailable | runtime row unavailable | runtime row unavailable | runtime row unavailable | runtime row unavailable |
| COD order-completion input | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a; only Draft Order ID and `paymentPending: true` | n/a |
| Completed Shopify order | unavailable | unavailable | — | ₹654 reported | −₹120 reported | ₹0 reported | ₹81.46 IGST 18%, included | ₹534 reported | INR |

The first **observable** ₹600 → ₹654 transition is between the LoopDesk/frontend
values and the Shopify-priced Draft/Order line. The exact first runtime stage
cannot be proven because the order-finalization `draftOrderCreate` selection only
requests Draft Order `id` and `name`; it does not capture returned line prices or
totals. The completion response likewise requests only order identity/status.

## 3. Draft Order line construction

There are three active Express-related construction paths:

1. The authoritative-pricing refresh extracts only a normalized Shopify
   `variantId` and positive integer `quantity` from the cart snapshot and sends
   `lineItems: [{ variantId, quantity }]`.
2. The primary Express order route deduplicates the same variant/quantity pairs
   and sends them unchanged in `draftOrderCreate`.
3. The shared and Partial-COD finalizers also construct normal Shopify variant
   lines from their cart snapshots.

For the primary COD path, the effective product portion of the input is:

```json
{
  "lineItems": [
    {
      "variantId": "<unavailable ProductVariant GID>",
      "quantity": "<unavailable positive integer>"
    }
  ],
  "shippingLine": null,
  "appliedDiscount": {
    "title": "Express checkout discount",
    "value": 120,
    "valueType": "FIXED_AMOUNT"
  }
}
```

For free shipping, `shippingLine` is omitted rather than sent as a priced custom
line. Address, contact, note, tags, attributes, and optional customer ID are also
sent but are omitted here to avoid PII and because they do not set the product
line price.

Across the searched checkout construction paths there is no use of
`originalUnitPrice`, `originalUnitPriceWithCurrency`, `priceOverride`, custom
product title/price line construction, `taxable`, or `requiresShipping` in a Draft
Order input. Normal Shopify variant lines are used. Therefore **no local product
price override exists in the inspected code**.

## 4. Local tax/gross-up search

Repository searches covered `1.09`, `9%`, `0.09`, `1.18`, `18%`, `0.18`, `GST`,
`IGST`, `CGST`, `SGST`, `taxRate`, `taxInclusive`, `taxExclusive`, `grossUp`,
`priceWithTax`, and `unitPriceWithTax`.

No 9% multiplication or other tax arithmetic feeds any Express Draft Order line.
GST arithmetic exists in the separate invoice, tax-engine, exchange-invoice, and
test areas, but the Draft Order builders do not import or call those modules.
The observed equality `₹600 × 1.09 = ₹654` is therefore correlation, not evidence
of a LoopDesk gross-up.

## 5. Shopify product, variant, and Markets comparison

| Shopify source | Price | Verification status |
| --- | ---: | --- |
| Storefront/Ajax cart | ₹600 | Reported, raw Ajax payload unavailable |
| Admin API variant `price` | — | Not fetchable without variant ID and Admin access |
| Draft Order returned line price | — | The mutation selection did not request it; Draft ID/log unavailable |
| Completed Order line price | ₹654 | Reported, raw Admin order response unavailable |

The code supplies a variant reference and lets Shopify resolve its price. Thus a
local override is ruled out, but these three Shopify-side possibilities remain
open until the exact variant is queried in its historical/current context:

* the Admin variant base price is/was ₹654;
* the Ajax cart was stale at ₹600;
* Storefront Markets/catalog/price-list context resolved ₹600 while an Admin
  Draft Order without equivalent market/presentment context resolved ₹654.

No Markets, catalog, price-list, company-location, or presentment context is
copied from the Ajax cart into the final `DraftOrderInput`. That makes contextual
price loss the leading code-level hypothesis, but **not a proven root cause**.

## 6. Tax configuration

The completed-order evidence establishes only:

* Shopify returned `taxes included`;
* the line/order was taxable for the delivery destination;
* Shopify returned one IGST line at 18%; and
* `₹534 × 18 / 118 = ₹81.46` after currency rounding.

The product `taxable` flag, store “include tax in prices” setting, destination tax
registration/collection state, Draft Order `taxesIncluded`, and Draft Order tax
lines cannot be verified without the live Shopify records. The current pricing
refresh asks Shopify for those fields and maps them without India-specific
arithmetic; the older/final completion query does not request them.

## 7. Pricing snapshot and Express read model

The incident's exact snapshot row cannot be inspected. Both requested branches
therefore remain possible:

* If it contains `subtotalMinor=60000` and `totalPayableMinor=48000`, the snapshot
  agrees with the old frontend/local intent and diverges from Shopify pricing.
* If it contains `subtotalMinor=65400` and `totalPayableMinor=53400`, the snapshot
  agrees with Shopify and the stale value is in the API/frontend consumption.

The current read model is a direct, customer-safe projection of snapshot minor
units; it does not recompute tax or add 9%. The frontend incident values are
reported as ₹600/₹480, but its raw API response is unavailable.

## 8. Discount verification

The primary order builder clamps the combined local discount to subtotal plus
shipping, converts it once to major currency, and sends one Draft Order-level
`appliedDiscount` with `valueType: FIXED_AMOUNT`. For the reported incident that
is one ₹120 fixed discount. The completed Shopify result also reports exactly
₹120 off, so there is no evidence of a duplicate or percentage discount. This
portion passes and requires no change.

## 9. COD boundary

COD performs readiness checks, selects `paymentPending: true`, and completes the
created Draft Order by ID. It does not pass a unit price, subtotal, tax,
discount, or order total to `draftOrderComplete`. Pricing is determined when
Shopify creates the variant-based Draft Order. COD therefore does not explain
the ₹54 line-price increase and requires no change.

## 10. Findings and root-cause status

1. **Draft line type:** correct Shopify variant line.
2. **Price override:** none in the inspected Draft Order paths.
3. **Local 9% gross-up:** none connected to Draft Order construction.
4. **Discount:** one fixed ₹120 discount; Shopify's reported result matches.
5. **COD:** selection/completion only; it does not calculate the disputed money.
6. **First observable divergence:** Shopify's variant pricing boundary, after the
   ₹600 cart/frontend snapshot and before the ₹654 completed order.
7. **Conclusive root cause:** not obtainable from the supplied artifact set. The
   code proves Shopify—not local tax arithmetic—selected the variant line price,
   but the missing runtime records prevent distinguishing Admin base price,
   stale Ajax data, and Markets/price-list context loss.
8. **Observability defect:** the final Draft Order mutation response omits line
   prices, totals, discounts, tax lines, `taxesIncluded`, and currency. This makes
   the exact Draft-versus-completion boundary untraceable after the fact.

## 11. Smallest targeted fix and files

No pricing fix should be applied yet. The required next diagnostic action is to
fetch, for the identified variant and Draft/Order IDs:

1. Ajax cart line `final_price`/`original_price` and currency;
2. Admin variant base price and contextual price for the checkout country/market;
3. Draft Order line `variant.id`, original/discounted unit prices, totals,
   `taxesIncluded`, and tax lines; and
4. completed Order equivalents.

Only then choose the smallest branch-specific fix:

* **Admin base price ₹654 + contextual Storefront price ₹600:** preserve the
  Storefront market/presentment context when obtaining Shopify-authoritative
  checkout pricing and complete that same priced Draft Order. Likely files:
  `services/storefront-pricing/shopify-checkout-pricing-refresh.ts` and
  `app/api/express/checkout/intents/[id]/order/route.ts`.
* **Admin and contextual price ₹654 + stale Ajax ₹600:** repair/invalidate the
  storefront cart source; do not override the Draft Order price. Likely files:
  `services/storefront-pricing/ajax-cart-source.ts` and the theme bridge that
  supplies the snapshot.
* **Draft response ₹600 but completed Order ₹654:** inspect/update only the Draft
  completion/conversion path in
  `app/api/express/checkout/intents/[id]/order/route.ts` after reproducing the
  Shopify-side conversion.

An isolated observability improvement (request and safely persist the missing
Draft pricing fields) would make future diagnosis deterministic, but it is not
itself a correction for this incident and is intentionally not implemented here.

## 12. Required tests for the eventual fix

* A fixture reproducing Ajax/contextual unit price ₹600 while Admin base price is
  ₹654, asserting the chosen Shopify context produces ₹600 in the Draft response.
* A full monetary invariant test asserting displayed total = current authoritative
  snapshot = Draft Order total = completed Order total.
* A Draft line contract test asserting `{ variantId, quantity }` and rejecting
  `originalUnitPrice*`, custom lines, and price overrides for normal products.
* An inclusive-tax fixture asserting Shopify's IGST title/rate/amount are
  projected unchanged and no local tax arithmetic is invoked.
* A discount contract test asserting exactly one ₹120 `FIXED_AMOUNT` discount.
* A COD boundary test asserting completion sends only Draft Order ID and
  `paymentPending: true`, with no monetary fields.
* A Markets/price-list fixture and a stale-Ajax fixture so those failure modes are
  independently distinguishable.

