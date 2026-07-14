# Customer Dashboard Cancellation Flow (DASH-4B)

The app-owned customer dashboard exposes cancellation as an adapter over the existing `OrderActionRequest` cancellation lifecycle. It does not create a second model, change merchant approval/rejection, or alter refund settlement.

## Reason codes

Server-owned allowlist: `ORDERED_BY_MISTAKE`, `WRONG_SIZE_OR_VARIANT`, `CHANGE_OF_MIND`, `DELIVERY_TOO_LATE`, `DUPLICATE_ORDER`, `PAYMENT_OR_PRICE_ISSUE`, and `OTHER`. `OTHER` requires trimmed additional details; free text is capped at 500 characters and rejects HTML/control characters.

## Form config

`GET /api/customer-dashboard/v1/orders/[orderId]/actions/CANCELLATION` authenticates the OTP session, validates opaque order ownership by shop/customer/order ID, reloads modules, recomputes action policy, returns private `no-store`, and only returns fields when cancellation is currently available.

## Submission

`POST /api/customer-dashboard/v1/actions` accepts only `actionType`, opaque `orderId`, `idempotencyKey`, and the cancellation payload. Authoritative shop, customer, order number, amount snapshot, shipment state, request status, and refund behavior are derived server-side.

## Eligibility, race protection, and conflicts

Submission reloads current owned order state and request snapshots. Cancellation is rejected after shipment/delivery, when disabled, when an active cancellation exists, or when exchange/issue interlocks are active. Cross-customer, cross-shop, and nonexistent orders map to safe not-found behavior.

## Idempotency

The DASH-4A idempotency layer scopes by shop, customer, action type, order, and key. Same key/payload replays the result; changed payload returns `IDEMPOTENCY_CONFLICT`. The client keeps the key for unchanged retries and rotates it when payload changes after failure.

## Status refresh and refunds

On success the normalized result instructs `REFRESH_DASHBOARD`. The frontend refetches `dashboard.v1` and renders canonical request labels/messages/refund explanations supplied by the API. The dashboard never creates refund requests and does not process refunds.

## Merchant compatibility and limitations

Created records remain `OrderActionRequest` records with `requestType=CANCELLATION`, so existing merchant admin queues, approval/rejection, audit history, and refund handling continue to own the lifecycle. Current limitation: durable idempotency depends on the DASH-4A repository layer available in the deployment; no schema migration is introduced by DASH-4B.
