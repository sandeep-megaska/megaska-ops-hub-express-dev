# Canonical customer identity architecture

## Scope and invariants

IDENTITY-1A.2 introduces an inactive identity boundary. No existing OTP, checkout, order, review, wallet, session, or synchronization path imports it yet. It performs no migration and changes no historical ownership. Later adoption must preserve the central invariant: one resolution either commits completely within its tenant or makes no identity change.

## Canonical flow

1. A source adapter labels the request (`OTP`, `SHOPIFY_ORDER`, `CHECKOUT`, or `CUSTOMER_SYNC`).
2. The resolver validates `shopId` and normalizes all supplied identifiers before database access.
3. The repository opens a serializable identity transaction and takes a tenant advisory lock.
4. It queries every eligible identifier. Phone participates only when verified; email participates only when the caller establishes verification.
5. Zero candidates creates a profile, one candidate may be safely enriched or linked, and multiple candidates return `IDENTITY_CONFLICT`.
6. The transaction commits and emits `customer_identity_resolution` with identifiers omitted.

The explicit outcomes are `MATCHED`, `CREATED`, `ENRICHED`, `LINKED`, and `IDENTITY_CONFLICT`. A conflict returns no selected profile because choosing one would itself be a business decision and a silent merge.

## Responsibility boundary

`CustomerIdentityRepository` owns database access, canonical tenant-scoped queries, persistence, serializable transactions, retry of unique/serialization races, and PostgreSQL transaction advisory locks. It makes no choice about which identifiers are trustworthy or whether a profile may be enriched.

`CanonicalCustomerResolver` owns verification eligibility, candidate interpretation, conflict policy, safe fill-only enrichment, outcomes, and structured event construction. It never deletes or merges profiles and never overwrites a populated identity value. The adapter methods are migration-ready facades only; they are intentionally not wired to production callers in this phase.

After adoption, direct `CustomerProfile` create/update/delete/upsert calls are prohibited outside the repository. The architecture test already inventories such writes, but reports diagnostics rather than failing while legacy callers remain.

## Normalization policy

`customer-identity-normalization.ts` is the future single import point. It trims and collapses whitespace, lowercases email, canonicalizes Shopify customer GIDs and numeric IDs to a numeric string, validates ISO alpha-2 country codes, and emits E.164 phones. International `+` input is preserved canonically; supported national input uses an explicit country calling code (defaulting to India for compatibility). Unsupported national country rules fail rather than guessing.

Raw phone, email, OTP values, tokens, and addresses must never enter identity logs. The event contains only resolver, source, matching mechanism, outcome, profile ID, and shop ID.

## Transaction and conflict model

The tenant advisory lock deliberately serializes overlapping identifier sets even when two requests initially share only an identifier not protected by a database uniqueness constraint. Serializable isolation detects non-cooperating races, while bounded retries handle Prisma unique and serialization errors. Every candidate query and mutation occurs on the same transaction client, preventing partial links or verification updates.

Existing schema limitations remain explicit: phone and email are not unique, email has no persisted verification timestamp, and `shopId` remains nullable. Consequently the resolver treats duplicate query results as conflicts and trusts email only when a source supplies `emailVerified`. No uniqueness constraints or historical records are changed here.

## Future adoption sequence

1. Observe warning-mode direct-write inventory and add integration metrics.
2. Adopt customer synchronization adapters and verify conflict reporting.
3. Adopt Shopify order ingestion without rewriting existing order ownership.
4. Adopt checkout and OTP as one coordinated release so neither can create a competing identity.
5. Turn the architecture rule into enforcement after all writers migrate.
6. In separately approved phases, quarantine/repair historical duplicates, reconcile dependent ownership, persist verification metadata, make `shopId` required, and introduce uniqueness constraints.

Historical merges, ownership repair, and wallet/session/order/review rewrites must never be folded into an adapter rollout.

## Canonical identity adoption (IDENTITY-1A.3)

**Adoption complete. No active identity bypasses remain.**

OTP verification, Shopify order import, Express Checkout, customer synchronization, and profile completion now adopt the canonical resolver/repository boundary. Dashboard, wallet, store credit, reviews, cancellation, exchange, issue reporting, refunds, timeline, tracking, notifications, and analytics consume the canonical profile ID produced upstream and do not resolve identity themselves.

An `IDENTITY_CONFLICT` never merges profiles or changes ownership. The resolver leaves customer data unchanged and writes a `CUSTOMER_IDENTITY_CONFLICT` audit event with the shop, source, conflicting profile IDs, timestamp, and identifier-presence booleans. Raw phone numbers, email addresses, OTPs, addresses, and tokens are excluded from identity-resolution logs and conflict audit payloads.
