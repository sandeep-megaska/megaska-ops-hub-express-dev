# Commercial billing service boundaries

The **rating engine** owns commercial calculations and writes immutable `MerchantRatedUsage` feature-period rows. The **billing summary** module only reads those rows and aggregates them into provider-independent estimates. A future **billing adapter** will submit provider-side charges.

Summary totals are estimates, not invoices, payments, or provider charges. Billing periods and usage selection use half-open intervals: `periodStart <= usageTimestamp < periodEnd`.

The current schema does not snapshot a plan base price on `MerchantBillingPeriod`; summaries therefore use the pricing plan attached to the subscription. Rated feature amounts and allowances always use their immutable rated snapshots.

## Shopify provider adapter

`adapters/shopify/shopify-billing-adapter.ts` receives only plan values or immutable `MerchantRatedUsage.amount` decimal strings. It never reads raw usage events. One usage record is intended per rated row with the deterministic `shopify:usage:{ratedUsageId}` key; submission persistence enforces this with a database unique constraint. Shopify's usage cap is supplied by provider configuration/input in the same currency as the plan—there is no FX conversion or hard-coded cap. Confirmation and lifecycle synchronization are intentionally deferred to the provider-submission service follow-up; this adapter only translates authenticated Admin GraphQL operations and returns the confirmation URL.

## Lifecycle orchestration

`lifecycle.ts` coordinates provider-normalized cycle confirmation, commercial period opening,
rating, provider usage submission, closing, and rollover. It does not parse Shopify GraphQL or
recalculate rated money. Periods remain half-open: `periodStart <= usageTimestamp < periodEnd`.
Provider-confirmed dates are required; month lengths are never inferred.

The state machine is `OPEN -> RATING -> RATED -> CLOSED`. Provider submission states remain
separate. A period cannot close while a non-zero usage submission is pending, processing, retryable,
or finally failed; final failures report `PROVIDER_SUBMISSION_FAILED_FINAL`. Re-running an operation
is safe: exact period opening, rating, deterministic `usage:<ratedUsageId>` submissions, close, and
rollover return or advance existing state. `processDueBillingPeriods` is bounded and retries partial
progress without rerating or creating another provider charge. Early rating and deferred submission
are accepted only when `BILLING_UAT_CONTROLS_ENABLED=true`; callers must still be internal/admin.
