# Customer Dashboard Contract V1

`dashboard.v1` is the canonical transport contract for the future unified customer dashboard service. The legacy `/api/dashboard/summary` route remains untouched in DASH-2A and continues to serve the current Megaska theme dashboard response shape.

## Conventions

- Money fields are integer paise values and use `*Paise` names.
- Date and time fields are ISO-8601 strings in DTOs. Server internals may use `Date`, but serialized contract values must not.
- DTOs are transport-safe JSON shapes. Prisma model instances and raw Shopify GraphQL payloads must be mapped before entering the contract.

## Authority boundaries

- Server-side services remain the authority for action availability, deadlines, request state, wallet accounting, and shipment tracking summaries.
- OTP customer sessions remain the authentication authority. `AuthSession` is resolved from the trusted session token hash, and the customer profile supplies shop tenancy where the current schema supports it.
- Shopify is connected commerce data, not the public dashboard contract. Shopify orders, fulfillments, customer records, and addresses will be normalized into dashboard DTOs in later extraction phases.

## Compatibility

DASH-2A introduces only the contract, error model, authenticated context helper, and orchestrator boundary. It does not wire the new service into `/api/dashboard/summary`, create a new customer-dashboard API route, or migrate legacy route logic.

## Next extraction phases

1. Add a `/api/customer-dashboard/v1` route that uses the new context and error DTOs without replacing the legacy route.
2. Extract customer/shop summary and module capability loading.
3. Extract commerce order normalization from Shopify and Loopdesk records.
4. Extract request/action eligibility, shipment tracking, and wallet loading behind the orchestrator dependencies.

## DASH-2B identity and commerce extraction

The dashboard context resolves an authenticated customer profile from the trusted server-side session; browser-supplied customer IDs are not accepted for dashboard identity. The extracted customer identity service scopes profile loading to the current shop where the schema supports it and returns `CUSTOMER_NOT_FOUND` when the authenticated profile is absent or belongs to another shop.

Shopify customer identity reconciliation preserves an existing stored Shopify customer ID unless Shopify Admin lookup finds a different valid customer. Reconciliation prefers an email match, falls back to phone when email does not match, and persists only the reconciled Shopify customer ID.

Commerce loading now normalizes Shopify Admin dashboard adapter data into an internal snapshot (`DashboardCommerceSnapshot`) rather than exposing raw GraphQL responses. The snapshot carries availability, source, commerce email, default address, total order count, recent orders, line items, fulfillment status, and tracking information with money represented as integer paise where exact conversion is available.

Shopify Admin unavailability, lookup errors, or unresolved commerce customers return an unavailable commerce snapshot. These failures must not destroy authenticated local dashboard access.

## DASH-2C request aggregation and action authority

Customer-dashboard request data is now aggregated by a reusable service that normalizes Shopify order numbers before querying cancellation, exchange and issue records. Request-domain lookups are batched by request type and explicitly scoped to `shopId`, `customerProfileId` and normalized `orderNumber` wherever the current schema supports those fields. Refund rows are loaded in a single batch scoped by shop, customer and parent order-action request.

The service produces an internal snapshot for the latest request of each type per order, derives active request interlocks with the existing domain helpers, and keeps deadlines server-owned. The corrected combined `openRequestCount` is the number of active/blocking cancellation, exchange and issue request records, not merely the number of affected orders and not only cancellation requests.

Customer-facing order actions are produced by a pure policy mapper. It is the normalized authority for cancellation, exchange, issue-reporting and read-only refund-status availability; it preserves the current delivery timestamp precedence, request windows, cancellation shipment lock, exchange progress semantics and cancellation refund outcome wording without exposing raw database records.

## DASH-2D Tracking and Wallet Service Semantics

### Tracking source precedence

Customer dashboard tracking is selected in this order: LoopDesk shipment tracking with a usable AWB or tracking URL, Shopify fulfillment fallback tracking, meaningful LoopDesk shipment state without an AWB, and finally a safe `NONE` tracking response. The `NONE` response is customer-safe and indicates that tracking will appear after shipment.

### Internal tracking and Shopify fallback

Internal tracking is loaded by shop, customer profile, and normalized Shopify order number in a single batched lookup. Shipment events preserve the existing recent-event ordering used by the legacy dashboard. Shopify fallback tracking is derived only from already-loaded commerce fulfillment data; it does not call Shopify. Empty fulfillment tracking entries are ignored, while carrier/company, AWB/tracking number, tracking URL, fulfillment status, fulfillment creation time, and delivered time are preserved when present.

### Trusted delivered timestamps

Delivered timestamps prefer the Shopify delivered timestamp when it is valid. If Shopify has no valid delivered timestamp, dashboard logic may inspect the selected tracking snapshot for delivered shipment state and delivered timeline events, using the latest valid delivered timestamp. If neither source is trustworthy, the delivered timestamp is `null`.

### Wallet module behavior

When the wallet module is disabled, wallet loading returns `null` and does not create or load a wallet account. When enabled, wallet loading uses the scoped wallet account and transaction services with explicit shop and customer profile context. Wallet-service or database failures surface as a typed `DASHBOARD_UNAVAILABLE` error rather than fabricating a zero balance.

### Reservation-aware available balance

Wallet available balance is reservation-aware: `availablePaise = max(balancePaise - reservedPaise, 0)`. Active reservations are aggregated with explicit shop and customer scoping, active status only, and unexpired reservations only. Negative or malformed reservation totals normalize to zero.

### Money and serialization

Wallet money values remain integer paise in service snapshots and DTOs. Wallet transaction order is preserved, and transaction timestamps are serialized as ISO strings in the public DTO.
