# Reviews domain foundation

This phase adds only tenant-scoped persistence and internal services. **No email, cron, upload, storefront, admin UI, public API, or customer submission behavior is active.**

`ReviewSettings` is one conservative configuration row per `Shop`. `ReviewRequest` is the durable, server-derived purchased-line opportunity (not proof that an email was sent); its customer, order, product and snapshots form the verified-purchase trust boundary. `ProductReview` can only be verified by copying that persisted request relation. Media records are storage metadata only; replies are one current merchant reply; aggregates are recalculated from non-deleted `PUBLISHED` reviews.

## Internal eligibility

Eligibility is internal only: it creates no token, schedule, email, API, or customer-facing behavior. The only eligibility clock is canonical `MegaskaOrder.deliveredAt`; synchronization timestamps, request creation, and order placement are never used. An undelivered order remains `PENDING_ELIGIBILITY` with `ORDER_NOT_DELIVERED`.

After delivery, the resolver uses the saved review delay (or seven days), then review exchange/issue overrides when present, otherwise the authoritative two-day exchange/issue policy. `eligibleAt` is delivery plus the maximum of those three windows. `automaticRequestsEnabled` deliberately controls later automatic delivery only, not eligibility.

```
ReviewRequest created
        ↓
Order not delivered → PENDING_ELIGIBILITY
        ↓ delivered
Resolve review delay + exchange + issue windows
        ↓
Inspect cancellation / refund / exchange / issue OrderActionRequest records
        ↓
Protection window active → PENDING_ELIGIBILITY
No blocker + window complete → ELIGIBLE
Blocking request or order state → BLOCKED
```

Blocker precedence is: protected advanced state, reviews disabled, ownership/product integrity, existing review, cancelled/refunded order, missing delivery, action requests, then the protection window. `OrderActionRequest` is reused and tenant-scoped; only its type/status is used for concise non-sensitive diagnostics. Canceled orders, refunded orders, and already-reviewed lines are permanent for V1. Other blockers, including settings, delivery, windows, and action requests, are re-evaluable.

`SENT`, `REMINDER_SENT`, `COMPLETED`, `EXPIRED`, and `CANCELED` are never regressed. An unsent `SCHEDULED` request may become blocked for a newly discovered permanent blocker; a scheduled request with delivery evidence remains unchanged. Updates compare meaningful eligibility fields before writing, making retries idempotent. Order-level evaluation supports all purchased lines, and candidate discovery is bounded and ordered by `updatedAt`, then `id`, for a future scheduler; it does not schedule or send anything.

All reads and writes include `shopId`; Shopify identifiers are scoped by tenant. `MegaskaOrder.deliveredAt` and `deliverySource` are the future eligibility clock. Reconciliation accepts explicit-offset timestamps, keeps the earliest credible delivery, and permits a trusted source to improve a weak `MIGRATED` value. `statusUpdatedAt` is synchronization time, not delivery occurrence time.

```
Order delivered → ReviewRequest PENDING_ELIGIBILITY
  ↓ later eligibility → ELIGIBLE / SCHEDULED
  ↓ later notification → SENT
  ↓ later submission → ProductReview PENDING_MODERATION
  ↓ later moderation → PUBLISHED / REJECTED / HIDDEN
```

## Delivered-order candidate synchronization

Candidate synchronization is an internal service only. It fetches one authoritative Shopify order by the persisted Shopify order ID, outside database transactions, and requires canonical `MegaskaOrder.deliveredAt`. It never accepts a caller token, sends email, creates review tokens, exposes a route, or activates customer-facing behavior.

```
Canonical delivered order
        ↓
Fetch Shopify order by ID
        ↓
Normalize line items and apply policy
        ↓
Create/enrich one ReviewRequest per purchased line
        ↓
Run existing order eligibility engine
        ↓
PENDING_ELIGIBILITY / ELIGIBLE / BLOCKED
```

Quantity does not multiply requests: the uniqueness boundary is Shopify order + Shopify line item. Fully removed/refunded lines, gift cards, shipping/tip-like custom lines, and lines without a Shopify product are skipped; a real zero-price promotional product remains reviewable. Re-sync is idempotent and races re-read the unique request. Existing source omissions are retained rather than deleted.

Snapshots preserve historical non-empty title, handle, image, and variant values. Only explicit missing/placeholder values are enriched; immutable Shopify order, line-item, and product IDs are never updated. Unsent delivery snapshots may follow canonical delivery, while advanced workflow states retain their historical delivery snapshot. Candidate synchronization only creates/enriches; the separate eligibility engine remains responsible for status decisions.

## Internal review-request delivery (REVIEW-1A.5)
Delivery is deliberately disabled unless `REVIEW_REQUEST_DELIVERY_ENABLED=true`; it also requires a safe `REVIEW_SUBMISSION_BASE_URL`. No public submission UI or API exists yet. Eligible requests are re-evaluated, then atomically claimed as `SCHEDULED` before a final revalidation and send through the tenant-aware shared Resend service. Customer email is read only from `CustomerProfile`; accepted sends reuse existing email usage metering with a stable request idempotency key.

Tokens use 256-bit cryptographic randomness; only SHA-256 hashes and expiry are stored. Provider failures and disabled transport return requests to `ELIGIBLE` for bounded retry (`REVIEW_REQUEST_MAX_SEND_ATTEMPTS`, default 3); missing recipients block as `CUSTOMER_UNREACHABLE`. Stale 15-minute claims recover without resending when a provider message ID exists, and sent expired tokens transition to `EXPIRED`. Reminders and customer submission are deferred.
