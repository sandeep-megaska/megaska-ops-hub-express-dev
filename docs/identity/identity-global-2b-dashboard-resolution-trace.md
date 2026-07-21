# IDENTITY-GLOBAL-2B — Dashboard identity resolution trace

**Audit date:** 2026-07-21  
**Scope:** Dashboard identity resolution only. OTP request/verification, validation, checkout, promotions, reviews, and wallet behavior were not changed.

## Finding

The dashboard does not resolve a customer by phone. It resolves the opaque token presented by the browser to an `AuthSession`, follows that session's `customer` relation, and uses that `CustomerProfile` for every downstream read.

The previous `customerProfileId` survived in **the previous `AuthSession.customerProfileId` and the browser's previous `megaska_session_token` bearer value**. The request helper selects credentials in this order:

1. `Authorization: Bearer …`;
2. `?token=…`;
3. `megaska_customer_session` cookie.

Consequently, a dashboard request carrying an old local-storage bearer and a new cookie resolves the old bearer. Before commit `fdbc73a`, successful OTP verification created another session but did not revoke the session presented during verification. Both sessions were valid, so the dashboard authentication query faithfully returned the old session and its old profile. An already-running dashboard request could also render the old response after the identity switch.

The current code revokes the presented session, creates the replacement session for the verified profile, replaces browser storage before publishing the auth event, and aborts the in-flight dashboard request. This audit adds dashboard-only trace events so production logs can prove which credential and profile are used at each read boundary.

## Session and payload inspection

`megaska_customer_session` contains only a random 32-byte token encoded as hex. It is not a JWT and contains no `shopId`, phone, profile ID, Shopify ID, session ID, or user claim. The same opaque token may also be held under local storage key `megaska_session_token` and sent as a bearer credential.

The server hashes that token with SHA-256 and queries `AuthSession.sessionTokenHash`. The effective server-side session payload is the database row:

```text
AuthSession.id
AuthSession.customerProfileId
AuthSession.expiresAt
AuthSession.revokedAt
AuthSession.customer -> CustomerProfile
```

No separate dashboard JWT, `auth.customer`, `cachedCustomer`, `getCurrentCustomer()`, or `resolveCustomer()` implementation participates in the summary route. `getAuthenticatedCustomer()` exists for other API routes but is not called here. `resolveCustomerDashboardContext()` is used by review access, not the dashboard summary loader. There is no React customer context provider in this dashboard: the app-owned browser asset fetches JSON and keeps it in its module-local `state.data`.

## Exact trace

| Step | Resolver / filter | Identity source | Trace event |
|---|---|---|---|
| OTP verified | Canonical OTP resolver selected the verified profile | Verified E.164 phone | Existing `[OTP VERIFY IDENTITY SWITCH]` |
| Session updated | Replacement transaction revokes the presented token and creates a session whose `customerProfileId` is the verified profile | `AuthSession.customerProfileId` | Existing `[OTP VERIFY IDENTITY SWITCH]` includes previous and replacement IDs |
| Dashboard API request | Browser sends bearer plus cookies; bearer wins | Local storage / query / cookie precedence | `dashboard_api_request` |
| Server authentication | SHA-256 token hash lookup, active and unexpired | Matching `AuthSession` | `server_authentication` |
| `customerProfileId` resolved | Prisma `include: { customer: true }` | `AuthSession.customer` relation | `customer_profile_resolved` |
| Orders query | Shopify customer ID, email, and phone are passed to Shopify; local tracking is additionally profile/shop scoped | Resolved session customer | `orders_query` |
| Address query | Shopify default address, falling back to fields on the resolved profile | Resolved session customer | `address_query` |
| Wallet query | `(shopId, customerProfileId, currency)` | Resolved session customer | `wallet_query` |

Every dashboard trace event has the common fields `shopId`, `phoneE164`, `customerProfileId`, `shopifyCustomerId`, `sessionId`, and `authenticatedUserId`. Before authentication, unavailable identity fields are explicitly `null`. The request event logs credential **presence and selected source**, never the bearer/cookie/query secret itself.

## Indian versus Kuwait comparison

Correlate the two `[OTP VERIFY IDENTITY SWITCH]` events with the immediately following `[DASHBOARD IDENTITY TRACE]` events. The required sequence is:

| Login | OTP phone | Session profile | Dashboard authentication | Orders/address/wallet filters |
|---|---|---|---|---|
| Indian | Indian E.164 | A | same session ID and profile A | A |
| Kuwait | Kuwait E.164 | B | replacement session ID and profile B | B |

For the Kuwait login, the OTP event must report the Indian session/profile in `previousSessionId` / `previousCustomerProfileId`, while `sessionId`, `sessionCustomerProfileId`, and every following dashboard trace must report the Kuwait session/profile B. If the first dashboard request says `sessionTokenSource: "authorization_bearer"` and resolves A, browser local storage still supplied A. If it says `cookie` and resolves A, the replacement cookie was not applied. If server authentication reports B but the page displays A, the surviving value is browser `state.data` or an old in-flight response rather than server identity resolution.

Repository access does not include production request logs or the two real phone/profile pairs, so this static audit cannot invent their runtime UUID values. The added events provide a single deploy-safe comparison without logging session secrets.

## Why this trace-first approach

Identity is a security boundary shared by orders, addresses, and financial data. Weakening repository filters or guessing from visible orders could expose one customer's data to another. A correlated trace establishes whether the stale identity is introduced by credential selection, database session ownership, profile relation resolution, or client rendering while leaving OTP, checkout, reviews, promotions, and wallet rules untouched.
