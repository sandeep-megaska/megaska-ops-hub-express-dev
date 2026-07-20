# PROMOTION-3A.1 reward architecture audit

## Repository paths audited before implementation

- Persistence: `prisma/schema.prisma` and `prisma/migrations/20260711083000_add_promotion_domain_foundation/migration.sql`.
- Domain, normalization, and validation: `services/promotions/domain.ts`, `services/promotions/normalization.ts`, `services/promotions/validation.ts`, and `services/promotions/form-validation.ts`.
- Admin save, hydration, and repository boundaries: `services/promotions/admin-actions.server.ts`, `services/promotions/repository.server.ts`, `services/promotions/admin-read-model.server.ts`, and `app/admin/promotions/PromotionForm.tsx`.
- Compilation, serialization, and hashing: `services/promotions/compiler-domain.ts`, `services/promotions/compiler-normalization.ts`, `services/promotions/compiler-payload.ts`, `services/promotions/compiler-hash.ts`, and `services/promotions/compiler.server.ts`.
- Runtime publication: `services/promotions/runtime/mapper.ts`, `services/promotions/runtime/function-contract.ts`, `services/promotions/runtime/synchronization.server.ts`, and `services/promotions/runtime/shopify-discount.server.ts`.
- Storefront offer and display consumers: `extensions/megaska-otp/assets/loopdesk-cart-drawer.js`, `extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid`, `scripts/loopdesk-cart-drawer-regression.test.mjs`, `assets/megaska-express-checkout.js`, and `sections/megaska-express-checkout-page.liquid`.
- Shopify Function input and execution: `extensions/loopdesk-discount-function/src/config.rs`, `extensions/loopdesk-discount-function/src/eligibility.rs`, `extensions/loopdesk-discount-function/src/rewards.rs`, `extensions/loopdesk-discount-function/src/cart_lines_discounts_generate_run.rs`, and the Function GraphQL/schema files.
- Regression coverage: promotion tests under `services/promotions`, Function tests in `extensions/loopdesk-discount-function/src/lib.rs`, and `shared/fixtures/loopdesk-function-configuration.json`.

## Findings

- `PromotionRule` persists product rewards in the legacy columns `rewardType`, `rewardValue`, `maximumRewardQuantity`, and `offerProductGid`; there is no persisted reward JSON or reward variant GID. This phase therefore keeps those non-destructive columns as the merchant compatibility boundary.
- TypeScript compilation previously emitted `{ type, value, maximumQuantity }` and storefront code read those fields directly. Admin form hydration and writes likewise use the legacy enum and columns.
- Rust previously deserialized only that legacy reward object. It allocates marked offer-product cart lines in rule priority order, caps quantities, excludes marked reward lines from trigger eligibility, and claims a cart line after the first matching candidate. These mechanics are the existing conflict contract.
- Product targeting is currently product-level. The selected Shopify variant is represented by the marked cart line at execution time rather than persisted in a promotion rule. Canonical rewards therefore permit a validated optional variant GID without making it mandatory and breaking existing rules.
- Compilation hashes use recursively sorted object keys (`deterministicSerialize`) and sorted source groups/product GIDs. Moving reward fields changes hashes once by design, but equivalent legacy and canonical inputs normalize to the same canonical object before subsequent hashing/publication.
- Cart Drawer pricing is explicitly an offer display estimate. Rust continues to create Shopify candidates and remains the pricing authority. Express Checkout does not directly interpret promotion reward calculation fields.

## Compatibility boundary

Legacy database rows, admin payloads, compiled payloads, and already-published Function configurations remain readable. New compiler and runtime serialization emits the canonical `{ scope, method, configuration }` reward. Unsupported scopes and malformed configurations fail closed and cannot produce a Function candidate.
