# Commercial billing service boundaries

The **rating engine** owns commercial calculations and writes immutable `MerchantRatedUsage` feature-period rows. The **billing summary** module only reads those rows and aggregates them into provider-independent estimates. A future **billing adapter** will submit provider-side charges.

Summary totals are estimates, not invoices, payments, or provider charges. Billing periods and usage selection use half-open intervals: `periodStart <= usageTimestamp < periodEnd`.

The current schema does not snapshot a plan base price on `MerchantBillingPeriod`; summaries therefore use the pricing plan attached to the subscription. Rated feature amounts and allowances always use their immutable rated snapshots.

## Shopify provider adapter

`adapters/shopify/shopify-billing-adapter.ts` receives only plan values or immutable `MerchantRatedUsage.amount` decimal strings. It never reads raw usage events. One usage record is intended per rated row with the deterministic `shopify:usage:{ratedUsageId}` key; submission persistence enforces this with a database unique constraint. Shopify's usage cap is supplied by provider configuration/input in the same currency as the plan—there is no FX conversion or hard-coded cap. Confirmation and lifecycle synchronization are intentionally deferred to the provider-submission service follow-up; this adapter only translates authenticated Admin GraphQL operations and returns the confirmation URL.
