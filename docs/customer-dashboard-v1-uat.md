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

## DASH-3A app-owned shell UAT scenarios

- Open `/apps/megaska/account` through Shopify App Proxy and verify the shell renders without Shopify customer-account login.
- With no LoopDesk OTP session, verify the sign-in-required state appears and the login action preserves the return path.
- With a valid OTP session, verify exactly one canonical `/apps/megaska/api/customer-dashboard/v1` request is made and no `/api/dashboard/summary` request is made.
- Verify profile, summary cards, recent orders, saved address, Store Credit wallet, and tracking render from `dashboard.v1` fields.
- Open and close an order detail panel with the button, backdrop, close button, and Escape key; verify focus returns to the triggering order card.
- Verify read-only action rows show statuses or “Coming in next phase” and no request submission form is available.
- Verify wallet is hidden when disabled and visible with transaction preview when enabled.
- Verify unsafe tracking URLs are not rendered as links.
- Verify the legacy theme dashboard remains unchanged and available as fallback.

## DASH-3B Theme App Extension UAT additions

- Launcher logged out → **Login**.
- Login opens LoopDesk OTP, not Shopify email/password login.
- OTP success → launcher updates to **My Account**.
- **My Account** opens `/apps/megaska/account` or configured same-store App Proxy path.
- Logout returns launcher to **Login**.
- Dashboard app block loads for verified OTP customers and shows login-required state for unverified shoppers.
- Duplicate dashboard blocks do not create competing dashboard roots.
- Legacy Megaska dashboard remains functional until merchant-approved removal.
- Theme App Extension changes require `shopify app deploy`; Vercel deployment alone is insufficient unless server/runtime code also changes.

## DASH-3C settings and branding UAT

Verify admin settings persist per shop, neutral defaults appear for shops without saved config, branding CSS variables render in the app-owned shell, hidden sections remain hidden, disabled dashboards do not expose customer data, launcher/mount presentation overrides do not enable server-hidden modules, support/continue-shopping/logout links are safe, “Show more” respects the configured initial order limit, and mobile layout remains usable. Deploy server changes to Vercel and Theme App Extension asset/block changes with `shopify app deploy`.

## DASH-4A customer request action framework UAT

Security: verify Customer A cannot act on Customer B orders, Shop A sessions cannot act on Shop B orders, and expired OTP sessions cannot submit. Idempotency: double-clicking cancellation creates one request, retrying the same key/payload replays the same result, and changing payload with the same key is rejected. Eligibility: stale available controls are rejected after shipment, conflicting exchange/issue/cancellation requests block submission, and module-disabled actions remain unavailable. UX: success refreshes dashboard state, customer-safe errors render clearly, duplicate requests do not appear, and the future generic dialog must pass mobile keyboard/focus checks.

## DASH-4B cancellation UAT checklist

- Happy path: open an eligible order, open cancellation, select a reason, submit, verify one cancellation request appears in merchant admin, and verify dashboard refresh shows “Cancellation requested”.
- Race: open dialog while eligible, fulfill/ship the order in admin, submit, verify `ACTION_NOT_AVAILABLE` and no new cancellation record.
- Duplicate: double-click or retry the same payload/key, verify one request and the same result.
- Conflict: create an active exchange or issue, verify cancellation is locked with a safe lock reason.
- Session: expire OTP session before submit, verify 401/login-required handling and no request.
- Refund/status: approve/reject in admin, refresh dashboard, verify API-provided cancellation/refund explanation renders without client-derived refund logic.

## DASH-4C exchange UAT checklist

- No-fee happy path: open a delivered eligible order, select item/replacement/reason, submit, verify one request, dashboard refresh, exchange progress, and admin visibility.
- Fee-required happy path: submit, verify `AWAITING_PAYMENT`/payment-required handoff when applicable, complete Razorpay, verify server-side, refresh dashboard, and Fee Paid step.
- Variant race: open form, make replacement unavailable, submit, expect safe validation and no request.
- Window race: open near deadline, submit after expiry, expect `ACTION_NOT_AVAILABLE` and no request.
- Duplicate/conflict: double-click or retry same key creates one request/payment; active cancellation or issue blocks exchange with a clear lock reason.
- Deployment: backend/dashboard changes require Vercel deployment; extension asset changes require `shopify app deploy`; live Razorpay UAT may require live-store credentials.
