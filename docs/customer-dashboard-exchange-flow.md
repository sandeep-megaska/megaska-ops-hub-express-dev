# Customer dashboard exchange flow (DASH-4C)

The app-owned dashboard now exposes `EXCHANGE` through the generic action-config and action-submission framework. Eligibility remains delivery based, uses the existing two-day request window and request interlocks, and stores exchange requests in the canonical `OrderActionRequest` / `OrderActionItem` / `RequestPayment` records used by merchant administration.

## Payload and reasons

The accepted payload is `lineItems[]` with `lineItemId`, `quantity`, `requestedVariantId`, `reasonCode`, and optional `note`. Server-owned reason codes are `SIZE_TOO_SMALL`, `SIZE_TOO_LARGE`, `WRONG_VARIANT`, `FIT_NOT_SUITABLE`, `DAMAGED_OR_DEFECTIVE`, and `OTHER`. `OTHER` requires a trimmed, non-HTML note of at most 500 characters.

## Form config

`GET /api/customer-dashboard/v1/orders/[orderId]/actions/EXCHANGE` authenticates the OTP session, validates order ownership, recomputes dashboard action availability, returns private/no-store headers, returns eligible line items, server-approved replacement options, deadline, fields, and the server-owned reverse-pickup fee.

## Submission and races

Submission revalidates ownership, delivered timestamp, request window, active request interlocks, line-item ownership, quantity bounds, replacement option validity, and fee configuration. If the window expires after the form opens, the handler returns `ACTION_NOT_AVAILABLE`. If a replacement option becomes unavailable, it returns `INVALID_INPUT` with field guidance and creates no request.

## Fee and payment

The reverse-pickup fee comes from the existing exchange constants / environment override, is non-negative paise, and is persisted as a canonical `REVERSE_PICKUP_FEE` payment placeholder when required. The dashboard receives `PAYMENT_REQUIRED` with the existing exchange payment-link endpoint; Razorpay creation and verification remain in the existing exchange-payment flow.

## Progress and admin compatibility

Dashboard progress continues to come from the canonical dashboard DTO. Merchant admin sees the same `OrderActionRequest` with selected items, requested sizes/variants in eligibility snapshots, reason/note, fee state, customer, order, and timestamps. Exchange statuses, pickup shipment records, replacement shipment records, and lifecycle transitions were not redesigned.

## Known limitations

Replacement options use trusted order/catalog metadata currently available to the dashboard service and must be upgraded to a richer batch Shopify variant loader when the product catalog adapter is expanded. Live Razorpay UAT may require authorized development credentials.
