# Reviews domain foundation

This phase adds only tenant-scoped persistence and internal services. **No email, cron, upload, storefront, admin UI, public API, or customer submission behavior is active.**

`ReviewSettings` is one conservative configuration row per `Shop`. `ReviewRequest` is the durable, server-derived purchased-line opportunity (not proof that an email was sent); its customer, order, product and snapshots form the verified-purchase trust boundary. `ProductReview` can only be verified by copying that persisted request relation. Media records are storage metadata only; replies are one current merchant reply; aggregates are recalculated from non-deleted `PUBLISHED` reviews.

All reads and writes include `shopId`; Shopify identifiers are scoped by tenant. `MegaskaOrder.deliveredAt` and `deliverySource` are the future eligibility clock. Reconciliation accepts explicit-offset timestamps, keeps the earliest credible delivery, and permits a trusted source to improve a weak `MIGRATED` value. `statusUpdatedAt` is synchronization time, not delivery occurrence time.

```
Order delivered → ReviewRequest PENDING_ELIGIBILITY
  ↓ later eligibility → ELIGIBLE / SCHEDULED
  ↓ later notification → SENT
  ↓ later submission → ProductReview PENDING_MODERATION
  ↓ later moderation → PUBLISHED / REJECTED / HIDDEN
```
