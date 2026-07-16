# Commercial billing service boundaries

The **rating engine** owns commercial calculations and writes immutable `MerchantRatedUsage` feature-period rows. The **billing summary** module only reads those rows and aggregates them into provider-independent estimates. A future **billing adapter** will submit provider-side charges.

Summary totals are estimates, not invoices, payments, or provider charges. Billing periods and usage selection use half-open intervals: `periodStart <= usageTimestamp < periodEnd`.

The current schema does not snapshot a plan base price on `MerchantBillingPeriod`; summaries therefore use the pricing plan attached to the subscription. Rated feature amounts and allowances always use their immutable rated snapshots.
