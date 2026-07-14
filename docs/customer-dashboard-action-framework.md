# DASH-4A Customer Dashboard Action Framework

DASH-4A adds a server-owned request action command path for customer dashboard actions. The browser submits only an action type, opaque order ID, idempotency key, and payload. The server resolves the OTP dashboard context, validates ownership, reloads modules/request state, recomputes policy, validates payload, applies duplicate/interlock checks, executes the registered adapter, audits, and returns a normalized DTO.

## Authentication and ownership

`resolveCustomerDashboardActionContext` wraps the existing customer dashboard OTP session resolver; no second auth model is introduced. `loadOwnedOrderForAction` scopes lookup by shop, customer profile, and canonical order identifiers and returns a safe local order snapshot.

## Registry and validation

The registry allowlists `CANCELLATION`, `EXCHANGE`, and `ISSUE` metadata. Payload validators are strict, trim strings, reject HTML, cap field lengths, reject duplicate line items, and accept issue attachments only as tokens.

## Eligibility, interlocks, and idempotency

`executeCustomerDashboardAction` reloads modules and current request aggregation, rebuilds dashboard action policy, and rejects stale UI submissions. Cancellation uses existing cancellation eligibility and request-interlock helpers. Because the current schema has no durable idempotency column/table, DASH-4A includes scoped hashing and replay plumbing with a documented storage gap; durable persistence should be added before relying on serverless multi-instance replay guarantees.

## Audit and endpoints

Audit events are emitted for attempted, rejected, created, failed, and idempotent replay states. Logs include shop/customer/order/action/request/result and a hash of the idempotency key, never raw session tokens or payloads.

Endpoints:

- `POST /api/customer-dashboard/v1/actions`
- `GET /api/customer-dashboard/v1/orders/[orderId]/actions/[actionType]`

## Current wired actions

Cancellation is wired to the existing `OrderActionRequest` lifecycle without refund, approval, deadline, wallet, or merchant workflow redesign. Exchange and issue contracts/validators are registered as framework metadata but intentionally return unavailable until their DASH-4B/C UI and data flows are implemented safely.

## Attachment-token approach

Issue attachments are represented as upload tokens only. Raw uploads, base64 data, and arbitrary URLs are not accepted in the action POST.

## Transaction rules and limitations

The preferred transaction boundary is conflict recheck → idempotency check → request creation → audit association. The existing schema lacks durable idempotency storage, so no Prisma migration was added in DASH-4A. Next phase should add durable idempotency association or reuse an approved domain metadata field if one is introduced.

## DASH-4B cancellation adapter

Cancellation is wired through the generic action framework. The form-config route returns server-owned cancellation reason options only when the current policy is `AVAILABLE`; locked responses include a customer-safe lock reason and no submit fields. The generic action POST route validates JSON, body size, OTP context, opaque order ownership, action policy, idempotency, and safe error mapping before invoking the cancellation handler.

Cancellation payload shape:

```ts
{ reasonCode: CancellationReasonCode; reasonText?: string | null }
```

The handler persists through the existing cancellation `OrderActionRequest` lifecycle and returns a normalized success result with `nextAction.type = "REFRESH_DASHBOARD"`.

## DASH-4C exchange action

`EXCHANGE` is now wired to `services/customer-dashboard/actions/handlers/exchange.ts`. The framework keeps the payload strict, derives shop/customer/order/fee/status server-side, resolves idempotency before domain creation, and returns normalized `REFRESH_DASHBOARD` or `PAYMENT_REQUIRED` next actions. Exchange-specific audit events use the `customer_dashboard.exchange.*` namespace and omit free-text notes and payment credentials.
