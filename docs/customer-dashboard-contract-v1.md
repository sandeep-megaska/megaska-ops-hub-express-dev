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
