# Customer dashboard issue reporting flow (DASH-4D)

DASH-4D wires `ISSUE` into the app-owned LoopDesk customer dashboard action framework. The flow reuses the OTP session, server-resolved shop/customer context, opaque dashboard order IDs, `dashboard.v1`, action registry/executor, request interlocks, and the existing merchant issue queue backed by `OrderActionRequest` and `OrderActionItem`.

## Contract and categories

The customer payload is `issueType`, selected `{ lineItemId, quantity }` entries, a required description, an explicit `declarations` object, and an optional attachments array. Exposed issue codes are `DAMAGED`, `WRONG_ITEM`, `MISSING_ITEM`, `QUALITY`, `INCOMPLETE_ORDER`, and `OTHER`; these are persisted in the existing `OrderActionRequest.reason` string and merchant pages continue to display the value as the issue reason.

The declaration object contains the existing issue-policy affirmations: the affected item is unused, has not been washed, and has original tags intact. The dashboard renders these as unchecked, required controls. They are never preselected, inferred from prior requests, or fabricated by the server.

## Eligibility and interlocks

Both form configuration and submission reload server-owned state. The server validates the OTP context, shop/customer ownership, issue module, trusted delivery timestamp, the existing two-day request window, active cancellation/exchange/issue conflicts, delivered line ownership, and authoritative quantities. Submission recomputes all checks immediately before creating the request.

For form configuration, declarations have not yet been submitted, so the API returns the declaration requirements as form controls only when the issue action is otherwise available. Submission validates that all three declaration values are actual JSON booleans and then passes those exact values, together with authoritative fulfillment and trusted delivery state, to the existing `evaluateIssueEligibility()` service. If that service rejects the request, no issue request is created.

## Persistence, notifications, and admin compatibility

Issue requests use the existing `OrderActionRequest` lifecycle with initial status `OPEN`. Affected lines are stored as `OrderActionItem` records. The existing issue route already established `requestedSize: "N/A"` for issue items because the shared table has an exchange-specific required column; DASH-4D keeps that convention and stores issue metadata in `eligibilitySnapshot`.

The eligibility snapshot persists the exact submitted declaration values. Customer identity and order snapshots are resolved from server-side order/customer context rather than accepted from the browser. Successful new dashboard issue requests preserve existing issue-created notification behavior by attempting `sendIssueRequestCreatedEmail(...)` after persistence; notification failure is logged as safe metadata and does not fail the already-created request. Idempotent replay returns the prior action result and does not create a second request or send a second notification.

## Attachments

No safe upload-token infrastructure was found for customer issue evidence. DASH-4D therefore exposes attachments as disabled in form configuration (`enabled: false`, `uploadSupported: false`, `maximumCount: 0`) and rejects any non-empty attachments payload. Arbitrary URLs, data URLs, base64, raw paths, and file contents are not accepted.

## Idempotency

The flow uses the central action idempotency helper. As of this implementation, that helper is still in-memory, so replay behavior works within a single process/test run but is not production-durable across serverless instances. No issue-specific in-memory map was added and no Prisma migration was created.

## UAT cases

- Open an eligible delivered order and verify the issue form contains only server-generated issue types, eligible delivered lines, and unchecked required declarations.
- Submit a valid issue and confirm one `OrderActionRequest` appears in merchant Issues with status `OPEN`.
- Verify the persisted eligibility snapshot contains the exact submitted declaration values and `requestedSize: "N/A"`.
- Verify dashboard refresh shows canonical issue status from `dashboard.v1`.
- Verify stale forms are rejected after deadline, module disablement, or a new active cancellation/exchange/issue.
- Verify duplicate idempotency key + changed payload is rejected.
- Verify non-empty attachments are rejected and no URLs/base64 are accepted.
