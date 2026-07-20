# PROMOTION-3A.3 Function execution audit

## Checked-in Shopify contract

- The LoopDesk Function targets `cart.lines.discounts.generate.run` at API version `2026-04`.
- The checked-in schema exposes `ProductDiscountsAddOperation` and `OrderDiscountsAddOperation`.
- `OrderDiscountCandidateTarget` exposes `orderSubtotal` through `OrderSubtotalTarget` (whose generated Rust variant is `OrderDiscountCandidateTarget::OrderSubtotal`).
- `OrderDiscountCandidateValue` supports `Percentage` and `FixedAmount`; this phase emits only `Percentage`.
- `OrderDiscountSelectionStrategy` supports `FIRST` and `MAXIMUM`; LoopDesk emits one deterministically resolved candidate with `FIRST`.
- Function input includes Shopify's `cart.cost.subtotalAmount.amount`, discount classes, line quantity and unit amount, merchandise identity, LoopDesk marker attributes, and the app-owned configuration metafield.

The previous deployed configuration is contract V1: its top-level shape has no `functionContractVersion`, and the new parser deliberately defaults that omission to V1. Contract V2 includes `functionContractVersion: 2` and supports canonical product and tiered order percentage rules. Unknown versions fail closed.

## Execution and compatibility decisions

- Product execution retains priority ascending then public rule ID, existing reward-line claiming, and the `ALL` product selection strategy.
- Order execution uses priority descending, percentage descending (equivalent to greater benefit for a common authoritative subtotal), then public rule ID ascending. Percentages never compound and only one LoopDesk order candidate is emitted.
- `PRODUCT` and `ORDER` discount classes are checked independently. Operations are emitted deterministically in product-then-order order.
- Shopify's input subtotal is the sole order-tier basis. The Function does not reconstruct a subtotal and does not perform sequential product/order arithmetic.
- The schema describes `orderSubtotal` as the subtotal before taxes, shipping fees, or discounts. Local Function tests establish that product and order resolution consume the same immutable invocation input. A live Shopify CLI/checkout observation was not available in this environment, so merchant-code combination and live checkout subtotal timing remain an activation verification gate rather than an inferred result.
- Shopify exposes combination settings at the automatic-discount node, not per operation. Existing product-only provisioning remains unchanged. When order rules are present, LoopDesk conservatively requires verified product and shipping combination state and provisions both `PRODUCT` and `ORDER`; LoopDesk itself still emits only one order candidate.

## Safe rollout sequence

1. Deploy the Function containing V1/V2 parsing and verify the deployed artifact.
2. Record/confirm deployed Function contract capability V2.
3. Validate and canonically hash the order runtime configuration.
4. Update the owned automatic discount to include `ORDER`, then verify Shopify's read-back and combination state.
5. Confirm runtime synchronization and contract hash read-back.
6. Publish contract V2 order rules only after every publication gate passes.

The publication gate reports distinct unsupported-contract, missing-class, invalid-reward, stale-synchronization, unverified-combination, and unverified-hash reasons. It fails closed when capability is absent or unknown.
