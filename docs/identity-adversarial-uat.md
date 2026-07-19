# IDENTITY-1A.5 adversarial UAT and cross-module integrity verification

This is an operator-run verification phase. It does not authorize production data changes. Run it against an isolated test-store database and retain the JSON output from every integrity check as evidence.

## Hard gates and evidence

Set `SHOP_ID`, `DATABASE_URL`, an evidence directory, and a unique run ID. Record build SHA, test-store domain, database snapshot identifier, operator, start/end timestamps, browser/device identifiers, and external provider event IDs. A phase passes only when its functional assertions pass **and** the verifier prints `"status": "VERIFIED"`.

```bash
export RUN_ID="identity-1a5-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "evidence/$RUN_ID"
git rev-parse HEAD | tee "evidence/$RUN_ID/commit.txt"
npm run identity:verify -- --shop-id="$SHOP_ID" | tee "evidence/$RUN_ID/00-baseline.json"
```

Stop immediately on `FAILED`, an identity conflict, a deadlock, ownership drift, duplicated monetary value, or any unexpected mutation. Preserve logs and the snapshot; do not repair data merely to make a phase pass.

## Phase A — historical cleanup (mandatory before UAT)

1. Snapshot the test database using the platform's transactionally consistent snapshot mechanism. Record and independently validate the snapshot identifier. A schema-only dump is not a snapshot.
2. Run read-only discovery for one known duplicate and save output.
3. Follow the separate discover → plan → approve → apply sequence in the [reconciliation runbook](customer-identity-reconciliation-runbook.md). Approval and apply must be distinct operator actions.
4. Run `npm run identity:verify -- --shop-id="$SHOP_ID"` and functional smoke checks for OTP, Dashboard, orders, reviews, wallet, and checkout.
5. Discover all remaining duplicate groups in the test store. Reconcile only `SAFE_AUTOMATIC` groups, one reviewed plan at a time. Wallet collisions and trusted-identifier conflicts remain manual-review failures.
6. Repeat the integrity verifier. Do not begin Phase B unless discovery is empty and the verifier is `VERIFIED`.

## Scenario execution matrix

Use one deliberately selected customer throughout, except where a scenario explicitly requires a new or guest customer. Capture the canonical profile ID after the first successful OTP verification. After **every row**, run the integrity verifier and save a monotonically numbered JSON artifact.

| Phase | Operations | Required functional assertions |
|---|---|---|
| B — OTP | First login; second login; logout/login; burst of OTP requests; expired and invalid OTP; two browsers; two devices; simultaneous verify of the same challenge | Exactly one profile; every successful session owns that profile; replay cannot create another session owner; expired/invalid codes create no session. |
| C — customer sync | Deliver the identical Shopify customer sync three times, then OTP and Dashboard | All deliveries and the session resolve to the captured profile; profile count remains one. |
| D — order import | Existing, new, and guest customers; duplicate webhook; repeated sync; webhook delayed until after sync | One order per Shopify order key; known-customer orders use the canonical profile; guest identity behavior is explicitly recorded and later linking does not drift ownership. |
| E — express checkout | OTP → address → payment → retry → payment → order sync; canceled payment; COD; Razorpay | Intent, address, payments, reservation, and order retain one owner across retries/methods; provider/idempotency keys prevent duplicate charges and orders. |
| F — reviews | OTP → order → delivered → review request → review; repeat candidate sync; re-import order; Dashboard | One request per order line; review, request, and order owners agree; eligibility is strict and remains correct. |
| G — wallet | Refund → store credit → Wallet → Dashboard → redemption; replay settlement and redemption callbacks | One account per profile/currency; stored balance equals signed ledger sum; source idempotency creates no duplicate value. |
| H — requests | Create exchange, cancellation, and issue requests; refresh; logout/login; sync | Request, order, tracking, refund, and session all resolve to the captured profile. |
| I — Dashboard | Inspect orders, addresses, wallet, reviews, tracking, issues, exchanges, cancellations | Every displayed object belongs to the captured profile; no object belonging to another seeded customer appears. |
| J — concurrency | Release OTP verify, customer sync, order import, checkout creation, and review sync from one barrier | All calls complete without deadlock; one profile remains; retry behavior is bounded; ownership does not drift. Run at least 20 repetitions. |
| K — normalization/replay | Phones `9876543210`, `+919876543210`, `91 9876543210`, `+91-98765-43210`; Shopify IDs `gid://shopify/Customer/123`, `123`; mixed-case/whitespace email; duplicate webhook, checkout, OTP | Each representation normalizes to one trusted identifier; replay is idempotent. Email alone must not merge identities unless the calling flow supplies verified-email trust. |

For concurrency, synchronize request release rather than merely starting commands sequentially. Preserve request/response status, correlation ID, idempotency key, provider event ID, latency, retry count, and resulting record IDs. Never store OTP values, session tokens, raw phone numbers, or full email addresses in evidence.

## Phase L — automated integrity interpretation

`identity:verify` opens a read-only, repeatable-read transaction and checks the complete shop snapshot. It reports only record IDs (at most 20 samples per failed check), never PII. It verifies:

- canonical Shopify IDs, E.164 verified phones, and normalized emails;
- shop/profile agreement for orders, order-action requests, review requests, and reviews;
- one wallet account per database constraint, ledger ownership/currency, exact signed-ledger balance, and reservation ownership;
- refund ownership through its request and wallet settlement;
- checkout intent, address, recovery-token, and COD-intent ownership.

Tracking and timeline ownership are verified through their owning order or request; these child tables intentionally do not carry a second customer ID. Database foreign keys prove that sessions resolve to an existing profile, while the scenario assertion proves that each newly issued session resolves to the **captured** canonical profile.

The verifier is a detector, not a repair tool. A nonzero exit is a UAT failure. Attach its JSON plus the functional evidence to the test record.

## Exit criteria

Sign-off requires all phases A–L, no waived integrity failure, empty duplicate discovery, successful replay/concurrency repetitions, provider-side confirmation of no duplicate payment, and a final `VERIFIED` artifact. Record any unexercised provider or unavailable environment as **not tested**, never as passed.
