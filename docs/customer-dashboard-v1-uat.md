# Customer Dashboard V1 UAT Matrix — DASH-2F

Status: focused stabilization audit for `/api/customer-dashboard/v1` and legacy `/api/dashboard/summary`. Result legend: Pass = covered by unit/route/parity checks or source audit; Watch = behavior intentionally conservative; N/A = no feature expansion in DASH-2F.

| Area | Scenarios | Result |
| --- | --- | --- |
| Authentication | Valid OTP session; missing, expired, revoked session; session for another shop; missing customer; invalid shop context | Pass. Context resolution hashes tokens, rejects invalid sessions, validates customer/shop, and updates lastSeen only after validation. |
| Customer identity | Stored Shopify ID; email match; phone match; Shopify customer not found/unavailable; local fallback | Pass. Local LoopDesk profile remains authoritative when Shopify identity is unavailable. |
| Orders | No/one/multiple orders, multiple line items, missing images/fulfillment, unknown statuses, historical Partial COD metadata | Pass/Watch. Missing historical Partial COD metadata remains conservative `UNKNOWN`. |
| Requests | Cancellation/exchange/issue available, active, completed; conflicts; expired windows; combined open count | Pass. Open count includes active cancellation, exchange and issue without closed history. |
| Tracking | Internal AWB/URL, Shopify fallback, internal meaningful data without AWB, none, delivered timestamps, timeline ordering | Pass. Unsafe tracking URLs normalize to null and mock flags do not leak. |
| Wallet | Disabled, zero/balance, active reservation, over-reservation, recent transactions, service failure, malformed aggregate | Pass. Disabled wallet skips loaders; enabled wallet failure returns `DASHBOARD_UNAVAILABLE`. |
| Money and dates | V1 paise, legacy wallet paise, legacy order total major units, ISO timestamps, no raw objects | Pass. Runtime validator rejects malformed DTOs and non-JSON values. |
| Security/route | Private no-store cache, Vary, nosniff, CORS on success/error | Pass. Both routes set private cache and security headers. |
| Performance | Batched request/tracking loaders, no per-order DB query loops | Pass. Tests assert batched scoped queries for requests and tracking. |

## UAT outcome
DASH-2F validates the V1 DTO before the canonical API response, preserves legacy theme compatibility, hardens tracking URLs, documents the legacy money-unit exception, and adds a database-free parity smoke script.

## Known limitations
Action submission flows and app-owned dashboard UI are not production-certified by this phase. Historical Partial COD records without reliable metadata stay conservative rather than inferred.
