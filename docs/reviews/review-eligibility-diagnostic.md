# REVIEW-1A.15 review eligibility diagnostic

## Entry-point map

The product extension renders **Write Review** and calls `loadEligible` in
`extensions/megaska-otp/assets/loopdesk-product-reviews.js`. That loader calls
`GET /api/reviews/submissions/eligible-purchases`, whose route authenticates the
customer session and invokes `resolveReviewEligibility`. The resolver uses
`ReviewRequest` as the purchased-line snapshot and `MegaskaOrder` as the
authoritative ownership and delivery record. The browser then posts the chosen
line to `POST /api/reviews/submissions`; `submitEligibleReview` separately calls
`evaluateReviewSubmissionEligibility`, and only after purchase predicates pass
does that service query `ProductReview` for a duplicate.

Dashboard pending-review presentation wraps the same purchase resolver through
`services/reviews/customer-review-query.ts`. Email-token form loading follows a
separate, intentionally stricter path through
`GET /api/reviews/submissions/eligibility`, `resolveReviewSubmissionAccess`, and
`getReviewSubmissionContext`; a valid, active `ReviewRequest` token is mandatory
there. Review-request automation uses `decideReviewEligibility` in
`services/reviews/review-eligibility.ts`. These are lifecycle/token policies,
not alternate product-page purchase ownership sources.

## Proven root cause and minimal correction

The product-page query included Prisma predicate `review: null`. Consequently,
the exact purchased line disappeared before delivery and ownership predicates
were evaluated whenever its `ReviewRequest` already had a `ProductReview`. The
form loader received an empty list and displayed the generic delivered-order
message. This was an `existing review excludes eligible order line` predicate
failure—not a delivery, OTP-session, or dashboard order-source failure.

The staged resolver no longer mixes those questions. It resolves canonical
identity, normalizes the product identifier, finds matching customer-owned
request lines, checks `MegaskaOrder` ownership and canonical delivery, and only
then records whether the line has a review. Thus an already-reviewed delivered
line resolves as `ELIGIBLE` with `existingReviewFound: true`; submission retains
the existing duplicate-review rejection.

## Security and operations

The storefront response retains generic customer-facing failures. The route
emits one redacted `review_eligibility_resolution` event without contact,
address, token, payment, or review-content data. Operators can run the local CLI:

```sh
npm run review:diagnose-eligibility -- \
  --shop-id=<shop-id> \
  --customer-profile-id=<profile-id> \
  --product-id=<numeric-id-or-product-gid>
```

The CLI is not an HTTP endpoint and therefore cannot be reached from the public
storefront. It reads only; it does not merge profiles or rewrite ownership.
