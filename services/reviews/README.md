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

`ProductReview` moderation reuses the existing `PENDING_MODERATION`, `PUBLISHED`, and `REJECTED` statuses. Merchants may publish pending/rejected reviews, reject pending/published reviews, and unpublish published/rejected reviews back to pending. Every moderation action is scoped by both review ID and `shopId`; cross-tenant review IDs are indistinguishable from missing reviews. Published-state entries and exits recalculate the tenant/product aggregate inside the same transaction. `moderatedAt`, `moderatedBy`, and the optional plain-text `rejectionReason` provide an internal audit trail. Rejection reasons are bounded to 500 characters, never public, and storefront rendering remains deferred.

## Storefront published review display (REVIEW-1A.8)

Only `PUBLISHED`, non-deleted reviews are public. Storefront queries always scope the review and aggregate lookup by both `shopId` resolved from the verified Shopify app-proxy hop and the canonical numeric Shopify product ID; a browser never supplies a tenant ID. The query uses `ProductReviewAggregate` for average/count/distribution, returns a safe zero summary when absent, and lists only a deliberately public projection. Pagination is bounded to 1–25 reviews and deterministic sorts are newest, highest rating, and lowest rating.

`POST /apps/megaska/api/reviews/storefront/product` forwards to the protected internal route and requires the existing signed internal app-proxy proof, bounded JSON, no-store security headers, and rate limiting. Product IDs accept only numeric IDs or Product GIDs. Pending and rejected reviews, customer/order/token/session data, moderation data, and media are never returned.

The **LoopDesk Product Reviews** theme app block is product-context-only and loads dedicated scoped JavaScript/CSS. It renders summary, distribution, sort, cards, pagination, loading/error, and empty states using DOM text nodes. Merchant controls in Review settings configure storefront availability, summary/distribution/badge/date/variant visibility, page size, and default sort. Aggregate/Review JSON-LD is intentionally deferred to avoid duplicate theme schema.

## Photo and video review media (REVIEW-1A.12)

Review media is tenant-scoped metadata, never file bytes in PostgreSQL. The central policy permits JPEG, PNG, WebP, MP4, and WebM only: up to five total items/five photos/one video, with default 8 MB photos, 40 MB videos, and a configurable 30-second video limit. GIF, SVG, HEIC, MOV, documents, archives, audio, customer-supplied external URLs, and arbitrary files are rejected.

The credential-free storage adapter uses environment-provided direct-upload and CDN URL templates. It isolates randomized keys beneath `reviews/{shopId}/{reviewId}/…`; storage keys, provider names, original filenames, moderation notes, and tenant IDs never enter the storefront projection. READY media becomes public only with its parent PUBLISHED review. The public projection exposes only `{ type, url, thumbnailUrl, width, height, durationSeconds, sortOrder }`; non-ready/rejected/deleted media is excluded and never changes rating aggregates or pagination.

Edit-token uploads are app-proxy, origin, bounded-body, and rate-limit protected. The token, tenant, edit window, settings, MIME/extension agreement, declared size, and count are validated before an UPLOADING record and five-minute direct target are created. Finalization only marks a record READY when configured public delivery is available. Individual merchant reject/restore controls use a distinct media status. Database state is authoritative for cleanup; physical deletion is delegated to the configured provider worker and failures must be retryable.

Signature/object metadata verification, EXIF stripping/renditions, video duration extraction/transcoding/posters, verified-submission temporary sessions, AI moderation, adaptive streaming, captions, replacement, reporting, social features, external imports, customer deletion, and bulk moderation remain explicitly deferred until a provider integration exists; large video binaries are never proxied through Next.js.

## REVIEW-1A.13 automation lifecycle

Automation is opt-in and tenant-scoped. New settings keep the existing `automaticRequestsEnabled` switch and add a fulfilled/delivered trigger, local-hour setting, primary channel, per-channel toggles, sender/templates and incentive disclosure. Existing queued requests retain their stored time; settings apply to subsequently scheduled requests. The implementation stores UTC and the scheduler must use the shop IANA timezone when one is introduced; the current order data has reliable **delivered** timestamps only, so fulfilled ingestion is intentionally deferred rather than guessing delivery.

## Analytics and merchant reporting (REVIEW-1A.14)

`/admin/reviews/analytics` provides an intentionally conservative tenant-scoped dashboard. The API derives the shop server-side and never returns customer contact details, review bodies, tokens, storage keys, provider errors, or secrets. Its overview, ratings, funnel, and CSV routes are under `/api/admin/reviews/analytics/{overview,ratings,funnel,export}`.

Event metrics are submitted (`submittedAt`), published (`publishedAt`), rejected (`rejectedAt`), scheduled, sent, delivered, clicked, and submitted requests inside the selected range. Snapshot metrics are currently published reviews, currently pending moderation, current published average rating, and current merchant-reply coverage; snapshots are explicitly not compared with historical snapshots. Publication/rejection rates use published plus rejected outcomes as their denominator. A request is counted once by logical request, so provider retries and reminders do not inflate initial sends. Delivery tracking is provider-dependent and is labelled partial when unavailable. “Submitted after reminder” is observational, never causal.

Ranges default to 30 days and support 7, 30, 90, and 365-day presets or a custom inclusive UTC-calendar range. Custom ranges are ordered and limited to 24 months. The comparison is the immediately preceding equivalent duration; percentage change is `null` when the prior value is zero. Shop timezone storage does not yet exist in this repository, so V1 explicitly uses UTC rather than claiming merchant-local boundaries.

Ratings display all five levels, including zeroes; positive means 4–5, neutral 3, critical 1–2. Media counts exclude deleted items and public media also requires an approved READY item. Reply coverage is current published reviews with one reply divided by current published reviews. The 48-hour moderation SLA and the three-review minimum for product rating rankings are central analytics thresholds. Direct indexed source queries are used; no warehouse, aggregate snapshots, or new indexes were added.

The current CSV export is **Review summary by day/range** with stable headings and RFC-style quote escaping. Product performance, request performance, notification failures, and moderation performance exports are deferred until their list views exist. Also deferred: AI sentiment/topics/summaries, attribution or uplift claims, cohorts/LTV, experimentation, prediction, scheduled reports, custom dashboards, cross-shop BI, customer-level exports, and full review-content exports.

The canonical graph is `SCHEDULED → READY → SENDING → SENT → DELIVERED/OPENED/CLICKED → SUBMITTED`, with `CANCELLED`/legacy `CANCELED`, `SUPPRESSED`, `EXPIRED`, and `FAILED` terminal exits. Domain helpers reject arbitrary transitions. The existing `(shopId, shopifyOrderId, shopifyLineItemId)` unique key is the one-purchase boundary. Delivery attempts add a tenant-scoped stable idempotency key (`review-request:<id>:initial|reminder:<n>`), provider message ID, safe errors and a 15-minute lease so workers can claim in one transaction and send outside it.

Email reuses the tenant-aware Resend customer-email service. SMS and WhatsApp are deliberately fail-closed until merchant-owned provider adapters and verified channel consent are configured; neither falls back to platform credentials. Templates use an allowlist only (`store_name`, `customer_name`, `product_title`, `variant_title`, `order_name`, `review_url`, `incentive_text`), never expressions, and escape email output. Provider payloads and raw tokens are never stored. Review tokens remain SHA-256 hash-only and submission invalidates them.

Retryable transport failures are retried at 15 minutes, 2 hours, 12 hours, and 24 hours; invalid recipients, templates, consent and missing providers are permanent. Reminder work is limited by the existing count/settings, uses a distinct key, and must recheck submission, expiry, suppression and consent before send. Existing authenticated `POST /api/internal/reviews/process-due` remains the bounded worker entry point (`REVIEW_PROCESSOR_SECRET`); provider webhooks, open/click pixels, fulfillment hooks, channel consent storage, automatic timezone scheduling, and full request-admin controls are deferred until the corresponding provider/event infrastructure is present.

Retention keeps lifecycle/attempt metadata for audit but excludes raw provider payloads and tokens. Admin responses must mask destinations and omit token hashes. Deferred: AI copy, optimization/A-B tests, attribution, fallback sequencing, incentives/coupons, segmentation, per-product rules, exports/backfills, international policy engine and customer review deletion.
