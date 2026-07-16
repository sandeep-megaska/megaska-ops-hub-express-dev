# Commerce billing plan lifecycle

LoopDesk reads plans and prices from the commercial catalog; the browser only submits a plan code. Plans are ordered by `tierRank` (and deterministically displayed by `displayOrder`), never by their names or price.

1. Select plan → Shopify confirmation → activate plan.
2. Higher-ranked plans are upgrades: a replacement subscription is requested and the commercial plan remains unchanged until confirmation.
3. Lower-ranked and same-tier changes take effect at the next period end. The current period must close before the target plan is applied.
4. Cancellation is scheduled for period end. It can be reactivated before that time; no next period opens after cancellation.

There is **no internal proration**: no partial charges, credits, allowance recomputation, or changes to immutable rated usage / closed billing periods. Shopify may apply its own provider-side behavior to a replacement.

Each request has a deterministic idempotency key and only one unresolved intent is permitted per subscription. `MerchantPlanChange` is retained for audit; applied intents and historical pricing/rated-usage snapshots are never rewritten or deleted. Scheduled changes are processed in effective-date/id order, after billing-period finalization.
