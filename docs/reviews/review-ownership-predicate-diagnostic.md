# REVIEW-1A.16 — Ownership predicate diagnostic

This phase is read-only. It does not update ownership, create merge mappings, or use canonical equality to change review eligibility.

## Exact legacy gates

The staged resolver has two ownership exits, evaluated in this order after the tenant/product query finds a `ReviewRequest`:

1. `ReviewRequest.customerProfileId === canonical(session customerProfileId)` (implemented by the second, customer-filtered `ReviewRequest` query). If no row survives, the result is `CUSTOMER_OWNERSHIP_MISMATCH` and the predicate is `REVIEW_REQUEST_PROFILE_NOT_CANONICAL`.
2. For a row that survives, `MegaskaOrder.shopId === request shopId` and `MegaskaOrder.customerProfileId === canonical(session customerProfileId)`. Failures are respectively `ORDER_TENANT_MISMATCH` and `ORDER_PROFILE_NOT_CANONICAL`, and retain the public result `CUSTOMER_OWNERSHIP_MISMATCH`.

The diagnostic additionally checks the ReviewRequest tenant, missing owner fields, raw ReviewRequest/order equality, and canonicalized session, ReviewRequest, and order owners. Those checks explain the state; they do not broaden the rows admitted by either legacy gate.

## Proven failing predicate

The supplied failing observation has one product row before the customer-profile filter and zero after it. Therefore it exits at legacy gate 1, before the order ownership filter:

```text
PASS — tenant resolved
PASS — OTP session authenticated
PASS — authenticated profile found
PASS — authenticated profile canonicalized

PASS — ReviewRequest profile found
FAIL — ReviewRequest raw profile matches canonical session profile
NOT REACHED — MegaskaOrder legacy ownership gate

FINAL: CUSTOMER_OWNERSHIP_MISMATCH
Failing predicate: REVIEW_REQUEST_PROFILE_NOT_CANONICAL
```

The raw owner UUID and all three canonical results must be collected from the secure server event or the operator CLI in the target environment. They are intentionally not guessed from static source or exposed to the storefront. The CLI follows merge mappings in both directions while resolving outgoing chains, checks every target in the same tenant, detects conflicting targets and loops, and stops after 20 links.

## Operator command

```sh
npm run review:diagnose-ownership -- \
  --shop-id=<shopId> \
  --customer-profile-id=<profileId> \
  --product-id=<productId> \
  [--review-request-id=<id>] \
  [--order-id=<id>]
```

The command performs only tenant-scoped reads. Its output separates the unchanged raw ownership gates from canonical-to-canonical comparisons so a historical source ID cannot be mistaken for an actual canonical ownership mismatch.
