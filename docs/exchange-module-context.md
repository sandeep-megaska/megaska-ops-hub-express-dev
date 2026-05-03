# Megaska Exchange Module Context

## 1. SYSTEM INVARIANTS (CRITICAL)

- **Auth is global**: session validation uses `AuthSession` token hash lookup without `shopId` in `/api/auth/session` and legacy exchange auth helper.
- **Data is shop-scoped**: exchange/customer-admin APIs enforce `shopId` via `requireShopFromRequest` + `orderActionRequest.shopId` filters.
- **Never modify (safety-critical surfaces):**
  - OTP flows: `/api/otp/request`, `/api/otp/verify`, and OTP provider service.
  - `/api/auth/session` behavior and response contract.
  - Checkout APIs (`/api/checkout/prepare`, `/api/checkout/prefill`).
  - `megaska-auth.js` (external auth contract dependency; treat as immutable).
- **Shopify Admin token priority (effective runtime logic):**
  1. `runtime_client_credentials`
  2. `shop_stored_token`
  3. `env_fallback`

---

## 2. ARCHITECTURE SUMMARY

### Auth system (global)
- Customer auth session token is read from `Authorization: Bearer <token>` (or `?token=` fallback).
- `AuthSession` is token-hash based and globally resolved; freshness tracked via `lastSeenAt`.
- Shop-sensitive exchange/account flows use strict wrapper `getAuthenticatedExchangeCustomer()` to bind session customer to request shop context.

### Data system (shop-scoped)
- Shop context is resolved from `x-shopify-shop-domain` (or `?shop=` fallback) and must map to active `Shop`.
- Exchange records are scoped with `OrderActionRequest.shopId` and validated per API call.

### Identity vs commerce separation
- **Identity/session:** `AuthSession`, OTP, `/api/auth/session`.
- **Commerce/exchange lifecycle:** `OrderActionRequest` + child entities for items, payments, shipments.
- Exchange APIs must not weaken identity/session contracts.

### Key models
- `OrderActionRequest`: parent request (status, customer/order snapshots, request type).
- `OrderActionItem`: requested size/item-level eligibility snapshot.
- `RequestPayment`: reverse pickup fee payment link/payment state.
- `ShipmentTracking`: reverse pickup and forward replacement shipment state.

---

## 3. CURRENT EXCHANGE MODULE STATUS

### Customer UI status
- No dedicated customer exchange page in this repo tree.
- Customer-side behavior is API-driven (`/api/account/exchange-requests/*`).
- Admin detail UI explicitly notes customer dashboard must invoke payment-link API using `megaska_session_token`.

### Admin UI status
- Implemented:
  - List page: `/admin/exchanges`
  - Detail page: `/admin/exchanges/[id]`
  - Lifecycle controls: status updates, admin notes, reverse/forward shipment updates.

### APIs implemented
- Shop-scoped customer APIs under `/api/account/exchange-requests/*`.
- Legacy non-shop-scoped customer APIs under `/api/requests/exchange/*` now return HTTP 410 Gone and should not be used by active clients.
- Admin APIs under `/api/admin/exchange-requests/*`.
- Razorpay webhook endpoint: `/api/webhooks/razorpay`.

### What is working
- Exchange creation with eligibility checks.
- Duplicate-active-request blocking.
- Admin status transitions with transition guards.
- Payment-link generation (Razorpay) and reuse logic.
- Webhook-driven payment status updates.
- Shipment upsert for reverse + forward directions.
- Email notifications for create/status/payment-required/payment-received.

### What is pending / partial
- Customer-facing UI implementation is not present here.
- Delhivery automation is capability-gated (manual shipment entry currently primary).
- GST invoice coupling for exchange completion is not implemented.

---

## 4. EXCHANGE BUSINESS FLOW (ACTUAL)

1. **Customer request**
   - Customer creates exchange request (item + size + reason).
   - System validates eligibility and records snapshot.

2. **Ops review / approval**
   - Admin reviews and either rejects or approves.
   - If approved with reverse pickup: status becomes `AWAITING_PAYMENT` and reverse pickup payment is prepared.
   - If approved with self-ship: status can move directly to `APPROVED`.

3. **Reverse pickup / self ship**
   - Reverse pickup path requires payment completion before progressing to pickup states.
   - Self-ship path skips reverse pickup fee requirement.

4. **Payment (after approval only)**
   - Customer generates payment link only when request is `AWAITING_PAYMENT`.
   - Razorpay webhook marks payment `PAID`, transitions request toward `PAYMENT_RECEIVED`, and seeds reverse pickup shipment as `PENDING`.

5. **Shipment handling**
   - Reverse shipment tracked under `direction = REVERSE_PICKUP`.
   - Replacement shipment tracked under `direction = FORWARD_REPLACEMENT`.

6. **Completion**
   - Typical progression: `ITEM_RECEIVED` → `REPLACEMENT_PROCESSING` → `REPLACEMENT_SHIPPED` → `CLOSED`.

---

## 5. API MAP (IMPORTANT)

### Customer exchange APIs (`/api/account/*`)
- `POST /api/account/exchange-requests` — create exchange request.
- `GET /api/account/exchange-requests` — list own exchange requests.
- `GET /api/account/exchange-requests/:id` — fetch one request.
- `POST /api/account/exchange-requests/:id/payment-link` — create/reuse reverse-pickup payment link (only in `AWAITING_PAYMENT`).

### Legacy customer APIs (`/api/requests/*`)
- Deprecated: `/api/requests/exchange/*` endpoints now return HTTP 410 Gone with migration guidance to `/api/account/exchange-requests/*`.

### Admin exchange APIs (`/api/admin/*`)
- `GET /api/admin/exchange-requests` — list/filter requests.
- `GET /api/admin/exchange-requests/:id` — details.
- `PATCH /api/admin/exchange-requests/:id` — admin note.
- `PATCH /api/admin/exchange-requests/:id/status` — lifecycle transition + approval mode + return method.
- `PATCH /api/admin/exchange-requests/:id/shipment` — upsert shipment for reverse/forward directions.

### Payment-link and payment status APIs
- `POST /api/account/exchange-requests/:id/payment-link`
- `POST /api/requests/exchange/:id/payment-link` (deprecated; returns HTTP 410)
- `POST /api/webhooks/razorpay` — updates `RequestPayment` and request lifecycle.

### Shipment endpoints
- `PATCH /api/admin/exchange-requests/:id/shipment` (supports `REVERSE_PICKUP` and `FORWARD_REPLACEMENT`).

---

## 6. CURRENT LIMITATIONS

- Razorpay end-to-end depends on environment credentials + webhook wiring; not guaranteed active in all environments.
- Delhivery integration is not operationally integrated (capability check only).
- GST invoice generation for exchange replacement/closure is pending.
- Email automation exists for key events but is partial (not full lifecycle automation/ops workflows).

---

## 7. NEXT IMPLEMENTATION PLAN

1. Productionize Razorpay payment-link rollout (merchant config + retry/expiry UX).
2. Harden webhook handling (idempotency/audit trail/replay safety).
3. Add customer dashboard payment CTA/button wired to account payment-link API.
4. Implement resend email workflows (manual + automated retries).
5. Integrate Delhivery APIs for pickup creation, label/AWB, tracking sync.

---

## 8. DEBUGGING RULES

- Always validate customer token in browser:
  - `localStorage.getItem("megaska_session_token")`
- Validate session token on backend with:
  - `GET /api/auth/session` (Bearer token)
- Validate shop context on every shop-scoped request:
  - `x-shopify-shop-domain` header must match installed active shop.
- Admin API calls require:
  - `x-admin-key` header + valid shop domain header.
- Payment debugging:
  - Confirm `RequestPayment.status`, `paymentLinkId`, `paymentLinkUrl`, and webhook signature secret alignment.

---

## 9. DO NOT BREAK LIST

- **Auth core** (`AuthSession`, token hashing, session validation).
- **OTP flows** (provider selection + verification endpoints).
- **Checkout flows** (`/api/checkout/prepare`, `/api/checkout/prefill`).
- **Session endpoint contract** (`/api/auth/session`).

---

## 10. TESTING NOTES

### How to test exchange flow

1. Authenticate customer and capture token in browser storage (`megaska_session_token`).
2. Create request:
   - `POST /api/account/exchange-requests` with order/item/size payload.
3. In admin UI/API, approve request:
   - `PATCH /api/admin/exchange-requests/:id/status` with approval mode + return method.
4. If reverse pickup path:
   - Generate payment link via `POST /api/account/exchange-requests/:id/payment-link`.
   - Simulate/receive Razorpay webhook to mark payment paid.
5. Progress shipments:
   - `PATCH /api/admin/exchange-requests/:id/shipment` for reverse and forward directions.
6. Complete lifecycle:
   - Move through `ITEM_RECEIVED` → `REPLACEMENT_PROCESSING` → `REPLACEMENT_SHIPPED` → `CLOSED`.

### Seeded test request (recommended fixture pattern)

- Use API creation call to seed a deterministic request with:
  - known order number,
  - one line item,
  - `requestedSize`,
  - valid shop header and Bearer session token.
- Capture returned `request.id` as canonical test fixture for admin/payment/shipment lifecycle tests.

### Expected lifecycle

- Reverse pickup path:
  - `OPEN` → `AWAITING_PAYMENT` → `PAYMENT_RECEIVED` → `PICKUP_PENDING`/`PICKUP_SCHEDULED` → `PICKUP_COMPLETED` → `ITEM_RECEIVED` → `REPLACEMENT_PROCESSING` → `REPLACEMENT_SHIPPED` → `CLOSED`.
- Self-ship path:
  - `OPEN` → `APPROVED` → `PICKUP_PENDING` (self-ship processing) → downstream fulfillment statuses.
