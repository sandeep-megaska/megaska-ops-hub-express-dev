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
Delivery is deliberately disabled unless `REVIEW_REQUEST_DELIVERY_ENABLED=true`; it also requires a safe `REVIEW_SUBMISSION_BASE_URL`. The later REVIEW-1A.6 submission endpoint consumes only valid sent tokens; delivery itself remains disabled by default. Eligible requests are re-evaluated, then atomically claimed as `SCHEDULED` before a final revalidation and send through the tenant-aware shared Resend service. Customer email is read only from `CustomerProfile`; accepted sends reuse existing email usage metering with a stable request idempotency key.

Tokens use 256-bit cryptographic randomness; only SHA-256 hashes and expiry are stored. Provider failures and disabled transport return requests to `ELIGIBLE` for bounded retry (`REVIEW_REQUEST_MAX_SEND_ATTEMPTS`, default 3); missing recipients block as `CUSTOMER_UNREACHABLE`. Stale 15-minute claims recover without resending when a provider message ID exists, and sent expired tokens transition to `EXPIRED`. Reminders remain deferred.

## Verified email-token submission (REVIEW-1A.6)

A sent review email authorizes one review opportunity with its existing opaque 256-bit token; OTP is **not** required. The storefront page at `/apps/megaska/review?token=…` is protected by the Shopify app-proxy boundary, resolves the active shop, then validates that token hash belongs to that shop. The frontend immediately removes the token from the visible URL and keeps it in memory only—never browser storage, cookies, DOM attributes, or analytics.

```
Email token opened → app proxy resolves shop → token hash lookup
  → sent + active + unexpired validation → safe product context
  → customer submits rating/plain text → revalidate in transaction
  → verified ProductReview → PENDING_MODERATION or PUBLISHED
  → complete ReviewRequest and clear token hash/expiry
```

Only `token`, rating, title, body, and display name are accepted from the browser. Shopify, customer, order, request, verified-purchase, and publication fields are always copied from the persisted request. A valid active customer session is an optional cross-check: matching sessions proceed; a mismatched session gets a generic authorization error without identifying the token owner.

Customer text is plain text only: it is normalized, bounded, control-character cleaned, and rejects HTML/contact-information display names. Display names default to a privacy-preserving first name plus last initial, or `Verified buyer`. Settings choose moderation versus immediate publication; published reviews recalculate the tenant/product aggregate. Successful submission creates one review, completes the request, and invalidates its token in one transaction; duplicate or concurrent retries return already-submitted rather than creating another review.

Lookup and submission use app-proxy-only POST JSON, bounded request bodies, origin checks, no-store/referrer/nosniff headers, and small in-memory development rate limits. The app-proxy catch-all signs its short-lived internal API hop with the server-only Shopify secret, so a browser cannot bypass Shopify verification by forging the old marker header. Production deployments should replace that process-local limiter with shared durable infrastructure. Media, review display, merchant moderation, and dashboard management remain deferred.

## Merchant moderation (REVIEW-1A.7)

The active moderation states are `PENDING_MODERATION`, `PUBLISHED`, and `REJECTED`. Merchant actions use the explicit transitions: pending → published/rejected; published → rejected/pending; rejected → published/pending. Every moderation lookup is scoped by both the authenticated shop and review ID, so a review from another tenant is indistinguishable from a missing review.

Publishing sets the publication and moderation audit timestamps, clears the internal rejection reason, and recalculates that shop/product aggregate in the same transaction. Rejection and unpublishing clear `publishedAt`; either transition out of publication recalculates the aggregate in that transaction. Repeated or invalid actions return typed conflict codes without altering aggregates.

Rejection reasons are optional, bounded plain-text internal merchant notes; they reject control characters and HTML and are never a storefront field. Storefront rendering remains deferred: only `PUBLISHED` reviews are eligible for that later phase.
