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

## Financial and incident policy

Single-account wallets retain account, transaction, reservation, amount, currency, and timestamps while ownership is repointed. Multiple accounts in the same currency are deliberately blocked for manual accounting design; never add a balancing transaction. Any thrown invariant aborts the entire transaction. Preserve the failed plan and database logs, do not edit its checksum/status directly, and create a fresh plan after the underlying conflict is resolved.
