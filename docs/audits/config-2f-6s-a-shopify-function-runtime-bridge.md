# CONFIG-2F.6S-A — Shopify Function Runtime Bridge

## Architecture implemented

This phase adds a server-only LoopDesk promotion runtime bridge that maps READY promotion compilations into the strict Shopify Discount Function JSON contract, assembles a deterministic shop-level configuration, writes it to one automatic app discount metafield, reads Shopify back, and persists success only after full canonical verification.

## Files changed

- `services/promotions/runtime/function-contract.ts` defines the canonical TypeScript contract, constants, sorting, validation, and hash assembly.
- `services/promotions/runtime/mapper.ts` explicitly maps compiler payloads to the accepted Function rule fields only.
- `services/promotions/runtime/shopify-discount.server.ts` contains Shopify GraphQL operations for automatic app discount lookup, creation, metafield write, and read-back.
- `services/promotions/runtime/synchronization.server.ts` orchestrates sync, idempotency, write/read-back verification, and failure persistence.
- `app/api/admin/promotions/runtime-sync/route.ts` adds a minimal protected-server-suitable POST entry point for later admin UI wiring.
- `prisma/schema.prisma` and `prisma/migrations/20260711120000_promotion_runtime_sync/migration.sql` add persistent runtime sync state.
- `shared/fixtures/loopdesk-function-configuration.json` is the shared TypeScript/Rust compatibility fixture.
- `extensions/loopdesk-discount-function/src/lib.rs` parses the shared fixture in Rust tests.

## Persistence changes

A `PromotionRuntimeSyncState` table stores shop ownership, automatic discount GID, last deployed configuration version/hash, rule count, last success time, sync state, attempt time, sanitized failure fields, and last verified configuration snapshot. States are `NEVER_SYNCED`, `SYNCING`, `SYNCED`, and `FAILED`.

## Exact Function JSON contract

The top-level payload is exactly `schemaVersion`, `configurationVersion`, `configurationHash`, and `rules`. Each rule is exactly `schemaVersion`, `ruleId`, `compilationVersion`, `status`, `priority`, `trigger`, `offer`, and `reward`.

## Fields intentionally excluded

The mapper never forwards schedule, combinesWith, presentation, heading, badge text, customer messages, CTA text, offer title, offer handle, image URL, source snapshots, compiler diagnostics, database metadata, timestamps, or merchant-facing configuration.

## Automatic discount ownership model

LoopDesk uses one automatic app discount per shop titled `LoopDesk Universal Promotions`. The service validates a persisted discount ID, recovers by title when safe, or creates a new automatic app discount with `discountClasses: ["PRODUCT"]` and Function handle `loopdesk-discount-function`.

## Metafield contract

The configuration is written as Shopify JSON metafield `namespace: $app:loopdesk-promotions`, `key: function-config`, `type: json`, and `value: JSON.stringify(configuration)`.

## Versioning and hashing

`configurationVersion` is the shop-level deployed revision and is separate from rule `compilationVersion`. The implementation uses last successful persisted version plus one for changed/recovery writes. The hash is SHA-256 over canonical serialization of `{ schemaVersion: 1, configurationVersion, rules }`, excluding `configurationHash` itself.

## Canonical sorting rules

Rules sort by `priority` then `ruleId`. Source groups sort by `sourceType`, `sourceReferenceId`, and `sourceGid`. Product GIDs are deduplicated and sorted. Decimal strings are preserved from the compiler payload.

## Idempotency policy

If the deployable canonical rules fingerprint matches the last successful sync and Shopify read-back still matches, the service returns `UNCHANGED`, does not allocate a new version, and does not write. If Shopify read-back differs or is missing, the service performs recovery synchronization.

## Failure and recovery behavior

Failures are persisted with sanitized error code/message while preserving the last known-good deployed version/hash. Shopify write failures and read-back mismatches never update last deployed fields.

## Read-back verification

After metafield write, Shopify is queried again. The returned JSON is parsed, re-canonicalized, and compared against the exact intended configuration. Mismatches fail synchronization.

## Shopify API assumptions

The implementation uses Admin GraphQL `discountAutomaticAppCreate`, `metafieldsSet`, `DiscountAutomaticApp`, `discountNodes`, `functionHandle`, and `discountClasses`. No live Shopify validation was performed in this phase.

## Empty ruleset behavior

An empty ruleset creates a valid fail-closed configuration and keeps the canonical automatic discount available unless Shopify API constraints discovered in deployment require deactivation.

## Known limitations

The minimal route is intended for later admin UI integration and should be wired into the existing embedded-admin authorization surface before merchant exposure. Concurrency safety relies on database uniqueness and persisted state; deployment should verify transaction isolation under production PostgreSQL load.

## Manual steps for next phase

Run the migration, deploy the Shopify Function extension, confirm the Function handle is installed for the target shop, perform a real Shopify sync in a development store, then run storefront/cart business validation.
