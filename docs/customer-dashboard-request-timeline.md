# Customer Dashboard Request Timeline

DASH-4E introduces a single customer-facing request timeline on each `dashboard.v1` order. The timeline is the authoritative read-only history for post-order customer workflows such as cancellation requests, exchange requests, issue reports, and their linked refund settlement outcomes.

## Architecture

The dashboard still loads request state through the existing customer dashboard request aggregation. `services/customer-dashboard/request-timeline.ts` only normalizes already-loaded request, refund, payment, shipment, and Store Credit snapshots into presentation DTOs. It does not make workflow decisions, write records, approve requests, perform settlement, issue Store Credit, or call merchant APIs.

```text
Customer Dashboard
└── Orders
    └── Order
        └── timeline[]
            ├── Cancellation requests
            ├── Exchange requests
            ├── Issue requests
            └── Linked refund settlement events
```

Future request domains should add their already-loaded customer-safe snapshots to the timeline builder instead of creating separate customer history sections or standalone APIs.

## Store Credit terminology

Store Credit is the only customer-facing product term. COD refunds settle as Store Credit, and prepaid refunds return to the original payment method. Legacy model names such as `WalletAccount` and `WalletTransaction` remain internal persistence names for database compatibility only; those internal names are not exposed in customer copy, public DTO labels, event labels, or documentation.

The timeline is read-only and never performs settlement. Store Credit timeline events require authoritative linkage to a Store Credit transaction for the specific refund request. No Store Credit event is fabricated from payment method or refund status alone.

## Refund settlement evidence

Linked refunds are loaded in the batched request aggregation for cancellation, exchange, and issue request IDs. Store Credit settlement events are emitted only when the linked refund is COD and its `walletTransactionId` resolves to a transaction in the same shop and customer profile with:

* `direction = CREDIT`
* `transactionType = COD_REFUND_CREDIT`
* `sourceType = REFUND_REQUEST`
* `sourceId = <RefundRequest.id>`
* a positive integer amount
* a currency
* a creation timestamp

For inconsistent COD states, such as a paid COD refund without a valid linked Store Credit transaction, the timeline does not show a Store Credit event. It may show only safe generic refund progress when an authoritative timestamp exists. Prepaid refunds never read Store Credit transaction tables and use refund status plus completion timestamps to show customer-safe original-payment-method copy.

## DTO

Each order in `dashboard.v1` exposes:

```ts
timeline: Array<{
  id: string;
  requestType: "CANCELLATION" | "EXCHANGE" | "ISSUE";
  requestId: string;
  createdAt: string;
  updatedAt: string;
  currentStatus: string;
  statusLabel: string;
  title: string;
  subtitle: string;
  events: Array<{
    id: string;
    type:
      | "REQUEST_SUBMITTED"
      | "REQUEST_STATUS_CHANGED"
      | "PAYMENT_RECEIVED"
      | "PICKUP_SCHEDULED"
      | "RETURN_RECEIVED"
      | "STORE_CREDIT_ISSUED"
      | "REFUND_PROCESSING"
      | "REFUND_COMPLETED";
    label: string;
    occurredAt: string;
    amount?: { amountPaise: number; currency: string } | null;
  }>;
}>;
```

Money stays in paise, dates stay as ISO strings, and the DTO contains no Prisma objects, raw database rows, merchant notes, staff details, audit logs, shop IDs, customer IDs, Shopify IDs, internal account IDs, payment-provider secrets, or approval comments.

## Status mapping

Internal request status codes are normalized to customer-safe labels:

| Internal status | Customer label |
| --- | --- |
| `OPEN` | Submitted |
| `UNDER_REVIEW` | Under Review |
| `APPROVED` | Approved |
| `REJECTED` | Rejected |
| `PROCESSING` | Processing |
| Exchange fulfillment statuses such as `PICKUP_SCHEDULED` and `REPLACEMENT_SHIPPED` | Processing |
| `COMPLETED` | Completed |
| `CLOSED` | Closed |
| `CANCELLED` | Cancelled |

Unknown future statuses are humanized as a fallback, but new request domains should add explicit mappings before launch.

## Sorting and deduplication

* Requests are sorted newest first by `createdAt`.
* Events within a request are sorted oldest first using actual persisted timestamps.
* Ties use semantic event order and event ID for deterministic output.
* Store Credit settlement evidence is deduplicated by refund and transaction identity, so a linked transaction plus supporting refund event cannot produce duplicate customer events.

## Security

The timeline builder uses an allow-list DTO. It copies only customer-safe fields required for display and derives labels and summaries from request type, status, and validated refund settlement snapshots. Sensitive merchant-only values must remain outside timeline inputs and must never be added to the DTO.

## Frontend behavior

The vanilla customer dashboard renders `Request Timeline` inside order details from the canonical `dashboard.v1` response. Amount-bearing Store Credit events render readable text such as “Store Credit issued” and “added to Store Credit” using the existing money formatter. After successful cancellation, exchange, or issue actions, existing action handlers refresh `dashboard.v1`; the timeline updates from that canonical payload with no optimistic timeline state and no separate browser fetch for Store Credit.

## Non-goals

This phase does not change merchant workflows, approvals, exchange logic, cancellation logic, issue handling, schemas, notifications, dashboard auth, OTP, attachments, payments, Store Credit settlement policy, Express Checkout, or Promotions. No migration is required for timeline presentation.
