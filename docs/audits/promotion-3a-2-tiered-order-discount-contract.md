# PROMOTION-3A.2 — tiered order discount domain and stacking contract

## Status and boundary

This phase adds a TypeScript-only, Shopify-neutral order reward domain. It does **not** add an order candidate to the published runtime, change the Rust parser or output, alter persistence, or render merchant/storefront UI. `order/percentage` is deliberately `planned`, and validation always reports `executable: false`. PROMOTION-3A.3 must create a versioned Function contract before any order reward can cross the publication boundary.

## Repository audit

| Concern | Current path | Existing constraint / 3A.3 change point |
| --- | --- | --- |
| Canonical rewards and strategy resolver | `services/promotions/reward-strategy.ts` | Product configuration is the only executable strategy. Legacy reward types normalize to canonical product rewards. The new capability matrix centralizes scope/method status. |
| Tiered order domain | `services/promotions/tiered-order-discount.ts` | Pure types, validation, decimal canonicalization, evaluation, serialization, and candidate conflict ordering only. |
| Promotion compiler domain | `services/promotions/compiler-domain.ts`, `services/promotions/compiler-normalization.ts`, `services/promotions/compiler.server.ts` | Compiler snapshots currently require an offer product and product-shaped canonical reward. 3A.3 must introduce a versioned union without weakening legacy parsing. |
| Runtime mapper/publication gate | `services/promotions/runtime/mapper.ts`, `services/promotions/runtime/function-contract.ts`, `services/promotions/runtime/synchronization.server.ts` | Mapper calls the product-only executable validator. Consequently order definitions cannot enter live Function configuration. This fail-closed gate must remain until Rust support deploys. |
| Hashing | `services/promotions/compiler-hash.ts`, `services/promotions/runtime/function-contract.ts` | Object keys are sorted, but arrays retain caller order. Tier canonicalization must run before these hash functions; the new domain canonicalizer sorts tiers and normalizes decimals. |
| Function manifest/API | `extensions/loopdesk-discount-function/shopify.extension.toml` | API `2026-04`; sole target `cart.lines.discounts.generate.run`. Root app manifests are mixed (`2026-04` development and `2026-01` default), so 3A.3 must not infer the Function schema from the root manifest. |
| Generated Function schema | `extensions/loopdesk-discount-function/schema.graphql` | The checked-in 2026-04 schema supports both `ProductDiscountsAddOperation` and `OrderDiscountsAddOperation` in the cart operation result. Order candidates target `orderSubtotal`, accept percentage/fixed amount, and use `FIRST` or `MAXIMUM`. This phase does not select or emit either order strategy. |
| Function input | `extensions/loopdesk-discount-function/src/cart_lines_discounts_generate_run.graphql` | Reads `cart.cost.subtotalAmount.amount`, line quantity/unit amount/product identity, marker attributes, `discount.discountClasses`, and configuration. It does not request taxes, shipping, gift cards, store credit, allocations, or a reconstructed retail value. |
| Rust input/config/output | `extensions/loopdesk-discount-function/src/schema.rs`, `src/config.rs`, `src/cart_lines_discounts_generate_run.rs`, `src/rewards.rs` | Generated bindings come from the checked-in schema/query. Parser accepts legacy/canonical product rewards. Run fails unless PRODUCT class exists and emits exactly one `ProductDiscountsAdd(All)` operation. No order candidate exists. |
| Product conflict resolution | `extensions/loopdesk-discount-function/src/cart_lines_discounts_generate_run.rs`, `src/eligibility.rs` | Rules are traversed in serialized priority order; claimed reward lines prevent a later product allocation. Product candidates use `ALL`. 3A.2 does not alter this behavior. |
| Automatic discount classes/combinations | `services/promotions/runtime/shopify-discount.server.ts` | Automatic discount is created with class `PRODUCT`; all three `combinesWith` flags are currently true and read-back verification requires them. This differs from the proposed order-reward default and must be migrated explicitly in 3A.3 rather than silently reused. |
| Persistence/admin form | `prisma/schema.prisma`, `app/admin/promotions/PromotionForm.tsx`, `services/promotions/form-validation.ts` | One product-shaped row has `offerProductGid`, legacy reward enum/value, quantity cap, and existing combination booleans. No tier persistence or editor is introduced here. |
| Decimal/currency | `services/promotions/normalization.ts`, `extensions/loopdesk-discount-function/src/decimal.rs`, `prisma/schema.prisma` | Existing TS normalization passes through JavaScript numbers; Prisma money uses `Decimal(18,4)`; Rust uses a six-place fixed-scale type. The tier domain instead parses plain decimal strings into bigint coefficient/scale and serializes canonical strings. Currency is shop/cart currency supplied by Shopify; tiers must be interpreted in that currency and never converted locally. |
| Rule priority | `services/promotions/runtime/function-contract.ts`, `extensions/loopdesk-discount-function/src/cart_lines_discounts_generate_run.rs` | Runtime currently sorts ascending priority then rule ID and Rust processes in that order. The proposed order-candidate contract explicitly ranks priority descending, benefit descending, then rule ID ascending. 3A.3 must reconcile/document priority direction before activation. |
| Cart goal/Savings Summary | `services/loopdesk/merchant-settings.ts`, `extensions/megaska-otp/assets/loopdesk-cart-drawer.js` | Cart goal is a static minor-unit free-shipping target; savings are locally derived view data. Future tier progress must add a target resolver and consume shared evaluation, not another pricing engine/component. Untouched here. |
| Express Checkout context | `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`, `extensions/megaska-otp/assets/megaska-express-modal.js`, `app/api/express/checkout/intents/route.ts` | Drawer hands cart context to the modal, whose totals/coupons are separate existing behavior. Future motivational tier context must be shared and non-authoritative. Untouched here. |

### Function capability finding

The checked-in generated schema—not memory or locally reconstructed GraphQL—is the implementation source of truth. A single `CartLinesDiscountsGenerateRunResult.operations` list can represent product and order operations, and the target schema contains both candidate families. That is schema capability only: the deployed discount is PRODUCT-class-only, the Rust entry point explicitly rejects inputs without PRODUCT, and its output constructs only `ProductDiscountsAdd`. Coexistence, operation ordering, discount-class provisioning, product-discount effects on `cart.cost.subtotalAmount`, and code/automatic combination behavior require Shopify CLI/schema verification and integration fixtures during 3A.3.

## Locked domain contract

### Monetary basis and boundaries

The only V1 basis is `eligible_merchandise_subtotal`: eligible merchandise after Shopify product pricing and before the LoopDesk order reward, excluding shipping, tax, gift cards, and store-credit redemption. The Function must use Shopify's input value. Storefront cart data may estimate progress but cannot confirm pricing. Compare-at price, wallet data, predicted checkout total, or reconstructed retail value are forbidden.

Minimum is inclusive and maximum is exclusive: `[minimumSubtotal, maximumSubtotal)`. An omitted maximum is open-ended. At an exact shared boundary the next tier activates. All eligible merchandise, including a product-reward line, counts unless a future eligibility model explicitly excludes it; Shopify's actual pre-order-discount input remains authoritative and prevents circular tier selection.

### Validation and deterministic representation

`validateTieredOrderReward` returns structured error issues and never throws for configuration errors. It detects: required tiers; invalid/duplicate public IDs; malformed plain decimals; negative bounds; percentage outside `0 < p <= 100`; maximum not greater than minimum; duplicate minimum/range; overlap; multiple open-ended tiers; a canonical successor after an open end; continuous-mode gaps; unsupported scope/method, basis, continuity, and selection mode. `allow_gaps` permits non-overlapping holes; `continuous` requires every next minimum to equal the previous maximum.

Canonical order is minimum ascending, bounded maximum ascending (open-ended last), then public tier ID. Decimal spellings normalize without binary floating arithmetic (`0010.5000` becomes `10.5`). Canonical runtime data contains public tier IDs only. Equivalent inputs therefore serialize and hash identically after canonicalization, regardless of UI array order.

### Evaluation

`evaluateTierProgress` sorts canonically, finds tiers containing the subtotal, and throws if an invalid overlapping configuration produces multiple matches. It returns zero or one active tier; percentages never sum. The next tier has the smallest minimum strictly greater than current subtotal. `amountToNextTier` is decimal subtraction and thus non-negative. Highest-tier state means an active tier exists and no future tier exists. Progress is display/motivation data, not a second pricing engine.

The normalized evaluation union separately represents `not_eligible`, `no_matching_tier`, `invalid_reward`, `unsupported_reward`, `suppressed_by_conflict`, and `excluded_by_combination_policy`; callers must not collapse them into a boolean.

## Stacking and conflict contract

Three independent decisions remain distinct:

1. **LoopDesk candidate selection** evaluates product and order categories independently.
2. **LoopDesk conflict resolution** selects at most one applicable order percentage by priority descending, customer benefit descending using the authoritative subtotal, then stable rule ID ascending. Percentages never compound.
3. **Shopify combination eligibility** enforces whether LoopDesk can coexist with other product/order/shipping discounts and codes.

The default intent for future tiered order rules is product `true`, order `false`, shipping `true`. It is intent, not a checkout guarantee. Coupon codes may combine only when Shopify configuration permits order-discount combinations; UI must say “eligible” or “available at checkout,” never guarantee additive savings. Store credit and gift cards are payment instruments outside promotion conflicts.

Product and order reward candidates remain Shopify-neutral discriminated categories. The order candidate contains percentage, public source rule/tier IDs, priority, and combination policy—no GraphQL operation fields. A future adapter alone will translate a resolved candidate into Shopify output.

## 3A.3 risks and required proof

1. Generate/validate bindings with the deployed 2026-04 Function schema and confirm a result containing both product and order operations is accepted.
2. Confirm `cart.cost.subtotalAmount` timing relative to product discount candidates. Do not infer product-discounted subtotals locally.
3. Reconcile current ascending product priority with the newly locked descending order contract without changing product behavior.
4. Version Rust/TypeScript configuration together so old Functions safely reject/ignore new shapes; do not publish order rewards first.
5. Provision ORDER discount class and combination fields explicitly, then test automatic discounts and triggered codes in Shopify. `combinesWith` cannot emulate local arithmetic.
6. Preserve shop-scoped publication ownership and redact internal database IDs/display-only/secrets from Function runtime.
7. Keep confirmed savings tied to authoritative Shopify allocations; progress estimates remain labeled estimates/eligibility.

## Deferred integration contracts

The existing Cart Goal Progress component should later accept `StaticGoalTarget | PromotionTierTarget`; drawer and Express Checkout should consume one shared display context; Savings Summary should call tier savings confirmed only when Shopify allocations contain them. Analytics may use shop ID, promotion public ID, tier ID, percentage, subtotal band, surface, and currency, but no customer PII. None of these integrations are implemented in 3A.2.
