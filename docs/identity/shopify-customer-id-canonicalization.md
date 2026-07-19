# IDENTITY-1A.4B — Shopify customer ID canonicalization

## Production defect and corrected path

The duplicate was created by `syncCanonicalShopifyOrder`: Shopify's order Admin GraphQL response supplied `order.customer.id` as a customer GID, and the old order-import resolver compared that raw value with `CustomerProfile.shopifyCustomerId`. The order and its review-request ownership were consequently attached to a newly created profile. Order ingestion now delegates identity selection to `CanonicalCustomerResolver`, which canonicalizes the identifier before its tenant-scoped lookup and returns a conflict instead of selecting between an existing normalized collision.

Canonical storage remains `CustomerProfile.shopifyCustomerId`; a non-null value written by active code is a decimal digit string. Raw Shopify GIDs are neither authoritative nor used for comparison. Transitional reads consider the exact numeric and customer-GID forms so a single legacy GID row can be reused and normalized. If both forms exist in one shop, normal runtime reports a conflict and does **not** merge them.

## Call-site inventory

Repository-wide searches covered direct profile creates/upserts, resolver names, `connectOrCreate`, Shopify IDs, manual GID stripping, numeric conversions, and raw comparisons. Generated Prisma output was excluded.

| Path | Input and trust | Lookup/create/transaction | Previous risk / disposition |
| --- | --- | --- | --- |
| `services/orders/shopify-order-sync.ts` | Admin GraphQL customer GID; no phone/email proof | Canonical resolver; tenant advisory lock + serializable transaction | **Proven path:** raw GID could miss numeric row and create. Replaced by canonical resolution. |
| `lib/customer-sync.ts` (bulk and single) | Admin GraphQL customer GID; returned phone/email are deliberately untrusted | Canonical resolver by normalized Shopify ID | Existing normalization retained, now shares the one normalizer. |
| `services/customers/resolve-shopify-customer.ts` | Compatibility wrapper for customer sync | Canonical resolver | Old standalone lookup/create behavior has been removed. |
| `services/auth/otp.ts` | Verified OTP phone; Shopify ID absent | Canonical resolver with verified-phone trust | No raw Shopify comparison; phone fallback may link an unowned Shopify ID safely. |
| checkout/profile completion/dashboard routes | Existing authenticated profile, or customer-sync service | Do not create a profile from a raw Shopify ID | Read/display and outbound metadata only; no duplicate creation path. |
| wallet, review generation, GST, admin/dev order import | Existing `customerProfileId`, except dev import uses canonical order sync | No independent CustomerProfile creation | Ownership consumers only. No Reviews identity adapter added. |
| reconciliation/integrity scripts | Operator-scoped raw numeric/GID discovery | Shared normalizer; explicit plan/approval/apply workflow | Existing collisions remain operator-controlled and are never silently merged. |
| test factories | Synthetic records | Test-local stores | Production architecture check continues to prohibit direct creates outside the identity repository. |

The only production `customerProfile.create` is encapsulated by `CustomerIdentityRepository`. Creation runs after all trusted signals are gathered in deterministic Shopify-ID, verified-phone, verified-email order. The repository takes a per-tenant PostgreSQL transaction advisory lock at `SERIALIZABLE`, retries serialization/unique conflicts, and the existing `(shopId, shopifyCustomerId)` database key provides conflict detection. Thus equivalent numeric/GID requests serialize and reload the same row rather than racing through an unprotected `findFirst`/`create` pair.

## Logging and invalid values

Resolution emits `customer_profile_shopify_resolution` with the caller, identifier form, resolution source, creation/fallback/conflict booleans, and no phone, email, OTP, payload, address, token, or raw customer ID. The shared diagnostic parser classifies `VALID_NUMERIC`, `VALID_CUSTOMER_GID`, `EMPTY`, `WRONG_RESOURCE_TYPE`, `MALFORMED_GID`, and `NON_NUMERIC`. `COLLISION` is a database-set diagnostic produced by the scan below, not a property of one input string.

## Staged database rollout

1. **Stage A (this application change):** canonical parser, canonical writes, centralized transactional resolution, transitional reads, and fixed order ingestion.
2. **Stage B:** explicitly invoke IDENTITY-1A.4A for shop `3ea59c93-efbd-41d6-aede-7787b2e1eaee`, moving ownership from `d058f0e6-2544-4852-ae48-c4c8263162c9` to `c2281142-a9dc-468a-99da-848a725e62dc`. Normal runtime must not perform this merge.
3. **Stage C:** only after the approved reconciliation, apply `20260719000000_normalize_shopify_customer_identity`. It rejects malformed values and normalized collisions before making its idempotent numeric rewrite.
4. **Stage D:** run the duplicate scan and require zero rows. Separately report counts for numeric, valid customer GID, empty, wrong-resource/malformed GID, and nonnumeric values before writing.
5. **Stage E:** verify/add the tenant-scoped non-null uniqueness invariant. The current Prisma compound unique key already enforces exact stored values; do not remove or recreate it until Stage D is clean.

No migration chooses a winner or deletes a profile. A collision aborts normalization and requires operator review.

## Production verification

1. Synchronize a fresh order for the known customer and confirm `MegaskaOrder.customerProfileId = c2281142-a9dc-468a-99da-848a725e62dc` and no profile was created.
2. Confirm its generated `ReviewRequest.customerProfileId`, wallet owner, and dashboard order owner are the same canonical profile.
3. Run the normalized duplicate query from the IDENTITY-1A.4B deployment ticket. One known pair is allowed before Stage B; require zero rows after Stages B–C.
4. Run `npm run identity:verify` and archive the output with the normalization category counts and migration result.

