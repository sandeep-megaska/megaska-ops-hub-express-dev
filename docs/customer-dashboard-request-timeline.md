# Customer Dashboard Request Timeline

DASH-4E introduces a single customer-facing request timeline on each `dashboard.v1` order. The timeline is the authoritative read-only history for post-order customer workflows such as cancellation requests, exchange requests, and issue reports.

## Architecture

The dashboard still loads request state through the existing customer dashboard request aggregation. `services/customer-dashboard/request-timeline.ts` only normalizes already-loaded request snapshots into presentation DTOs. It does not make workflow decisions, write records, approve requests, or call merchant APIs.

```text
Customer Dashboard
└── Orders
    └── Order
        └── timeline[]
            ├── Cancellation requests
            ├── Exchange requests
            ├── Issue requests
            └── Future request types
```

Future request domains should add their already-loaded customer-safe snapshots to the timeline builder instead of creating separate customer history sections or standalone APIs.

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
    label: string;
    occurredAt: string;
  }>;
}>;
```

The DTO contains no Prisma objects, raw database rows, merchant notes, staff details, audit logs, shop IDs, customer IDs, Shopify IDs, or approval comments.

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

## Sorting

* Requests are sorted newest first by `createdAt`.
* Events within a request are sorted oldest first.
* Ties use request type and request ID for deterministic output.

## Security

The timeline builder uses an allow-list DTO. It copies only customer-safe fields required for display and derives labels and summaries from request type and status. Sensitive merchant-only values must remain outside timeline inputs and must never be added to the DTO.

## Frontend behavior

The vanilla customer dashboard renders `Request Timeline` inside order details from the canonical `dashboard.v1` response. After successful cancellation, exchange, or issue actions, existing action handlers refresh `dashboard.v1`; the timeline updates from that canonical payload with no optimistic timeline state.

## Non-goals

This phase does not change merchant workflows, approvals, exchange logic, cancellation logic, issue handling, schemas, notifications, dashboard auth, OTP, attachments, payments, Store Credit, Express Checkout, or Promotions.
