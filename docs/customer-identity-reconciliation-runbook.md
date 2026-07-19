# Customer identity reconciliation operator runbook

Historical reconciliation is an operator-only workflow. Nothing imports this CLI from OTP, sync, checkout, webhooks, startup, deployment, migrations, or request handlers. Each command performs exactly one mode; the default is read-only **DISCOVER**.

## Safety model

- Every command requires `--shop-id`; cross-tenant scans are rejected.
- Discovery joins profiles only through a normalized Shopify customer ID or a verified E.164 phone. Names, addresses, unverified phones, unverified email, order similarity, and timing are never identity proof.
- Plans persist immutable evidence, movements (including record IDs and counts), strategies, conflicts, source-state checksum, and operator identity in `CustomerIdentityReconciliationPlan`.
- Only `SAFE_AUTOMATIC` plans can be approved or applied. Trusted-identifier conflicts are blocked. Two wallets for one currency are manual review and cannot be approved because the current ledger model cannot safely resolve that collision automatically.
- Apply uses serializable isolation, a shop advisory lock, row locks, stale-state checking, atomic ownership changes, a retirement mapping (never profile deletion), verification, and a redacted audit record.

## One-group test-store sequence

1. Snapshot the database and identify one known duplicate group.
2. Discover: `npm run identity:reconcile -- --shop-id=SHOP --discover --customer-profile-id=PROFILE`
3. Persist a plan only after inspecting discovery: `npm run identity:reconcile -- --shop-id=SHOP --plan --profile-ids=PROFILE_A,PROFILE_B --actor=NAME`
4. Review classification, evidence, conflicts, enrichment, every table count, wallet/session strategies, and checksum. No data has changed.
5. Approve as a separate operation: `npm run identity:reconcile -- --shop-id=SHOP --approve --plan-id=PLAN --confirm=CHECKSUM --actor=NAME`
6. Apply as another explicit operation: `npm run identity:reconcile -- --shop-id=SHOP --apply --plan-id=PLAN --confirm=CHECKSUM --actor=NAME`
7. Require `VERIFIED`. `PLAN_STALE` requires a new plan; never bypass it. A repeated apply returns `ALREADY_APPLIED` without another audit entry.
8. Test OTP, Dashboard, order visibility, review eligibility, wallet/store credit, and Express Checkout before attempting a small batch. Snapshot and repeat verification before any full test-store run.

## IDENTITY-1A.4A approved targeted reconciliation

The approved direction is source `d058f0e6-2544-4852-ae48-c4c8263162c9` to target `c2281142-a9dc-468a-99da-848a725e62dc` in shop `3ea59c93-efbd-41d6-aede-7787b2e1eaee`. Do not omit the explicit target or reverse these IDs. Discovery expands an anchored profile to all numeric/GID-equivalent Shopify IDs and remains read-only.

```sh
npm run identity:reconcile -- --shop-id=3ea59c93-efbd-41d6-aede-7787b2e1eaee --discover --customer-profile-id=d058f0e6-2544-4852-ae48-c4c8263162c9
npm run identity:reconcile -- --shop-id=3ea59c93-efbd-41d6-aede-7787b2e1eaee --plan --profile-ids=d058f0e6-2544-4852-ae48-c4c8263162c9,c2281142-a9dc-468a-99da-848a725e62dc --target-profile-id=c2281142-a9dc-468a-99da-848a725e62dc --reason-code=SHOPIFY_CUSTOMER_ID_FORMAT_DUPLICATE --actor=OPERATOR
```

Review the persisted plan and its complete schema-discovered dependency inventory. It must show no source wallet, no review collision, target wallet preservation, the two known `MegaskaOrder` IDs (`e961b3d4-85a6-46ff-803e-df3f6a51dcfe`, `423b1883-0658-4938-99e8-735d4f5d9ffa`), and all real `ReviewRequest` IDs. Then run the separate approve and apply commands from the sequence above with the immutable checksum. Apply clears only the retired source's active Shopify identifier; the profile row and permanent merge mapping remain for audit and canonical resolution. Recovery is database snapshot restoration plus incident review; never reverse ownership piecemeal.

### Schema-accurate verification

```sql
SELECT "id", "shopId", "shopifyCustomerId", "phoneE164", "phoneVerifiedAt", "profileCompletedAt"
FROM "CustomerProfile" WHERE "id" IN ('c2281142-a9dc-468a-99da-848a725e62dc', 'd058f0e6-2544-4852-ae48-c4c8263162c9');
SELECT "id", "shopifyOrderId", "customerProfileId" FROM "MegaskaOrder" WHERE "id" IN ('e961b3d4-85a6-46ff-803e-df3f6a51dcfe', '423b1883-0658-4938-99e8-735d4f5d9ffa');
SELECT "id", "megaskaOrderId", "shopifyProductId", "shopifyLineItemId", "customerProfileId" FROM "ReviewRequest" WHERE "customerProfileId" IN ('c2281142-a9dc-468a-99da-848a725e62dc', 'd058f0e6-2544-4852-ae48-c4c8263162c9');
SELECT "id", "currency", "balance", "customerProfileId" FROM "WalletAccount" WHERE "customerProfileId" IN ('c2281142-a9dc-468a-99da-848a725e62dc', 'd058f0e6-2544-4852-ae48-c4c8263162c9');
SELECT "id", "expiresAt", "revokedAt", "customerProfileId" FROM "AuthSession" WHERE "customerProfileId" IN ('c2281142-a9dc-468a-99da-848a725e62dc', 'd058f0e6-2544-4852-ae48-c4c8263162c9');
SELECT * FROM "CustomerIdentityMerge" WHERE "shopId"='3ea59c93-efbd-41d6-aede-7787b2e1eaee' AND "sourceCustomerProfileId"='d058f0e6-2544-4852-ae48-c4c8263162c9';
SELECT regexp_replace("shopifyCustomerId", '^gid://shopify/Customer/', '') AS normalized, count(*) FROM "CustomerProfile" WHERE "shopId"='3ea59c93-efbd-41d6-aede-7787b2e1eaee' AND "shopifyCustomerId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

Production checkout, Reviews, OTP, Dashboard, wallet/store credit, issues, cancellation, exchange, timelines, and Express Checkout UAT must be performed after apply in the production environment. Static repository tests do not claim those production results.

## Financial and incident policy

Single-account wallets retain account, transaction, reservation, amount, currency, and timestamps while ownership is repointed. Multiple accounts in the same currency are deliberately blocked for manual accounting design; never add a balancing transaction. Any thrown invariant aborts the entire transaction. Preserve the failed plan and database logs, do not edit its checksum/status directly, and create a fresh plan after the underlying conflict is resolved.
