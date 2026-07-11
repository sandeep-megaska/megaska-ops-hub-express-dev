# CONFIG-2F.6R-C Core Eligibility and Reward Execution

## Audit and foundation correction

The CONFIG-2F.6R-B foundation was confirmed to be a placeholder: it had hand-written input/output structs, an empty `#[no_mangle]` C export, no executable Shopify Function macro, and manual configuration scanning. This phase removes the empty export and adds a Rust Function entrypoint shaped as `cart_lines_discounts_generate_run(input) -> Result<CartLinesDiscountsGenerateRunResult>`.

The Shopify CLI is not installed in this environment, so schema generation could not be run here. To keep the extension compiling in this environment, a local compatibility crate named `shopify_function` provides the macro/prelude surface while the extension keeps checked-in schema-shaped Rust types under `src/schema.rs`. This should be replaced by Shopify CLI-generated bindings as soon as the CLI is available.

## Compiler payload contract

The existing compiler emits function payload rules with `schemaVersion`, `ruleId`, `status`, `priority`, `trigger`, `offer`, `reward`, `schedule`, and `combinesWith`. Trigger payloads include `type`, `matchMode`, `minimumQuantity`, `minimumCartSubtotal`, and compiled `sourceGroups`. Rewards include `type`, `value`, and `maximumQuantity`.

## Cargo dependencies

`Cargo.toml` now depends on a local `shopify_function` compatibility package. No HTTP clients, async runtimes, Prisma libraries, Admin SDKs, or storefront dependencies were added.

## Runtime behavior

The Function requires the PRODUCT discount class before parsing configuration. It parses a typed top-level configuration and typed rules, executes only ACTIVE + ANY rules, evaluates trigger membership from compiled Product GIDs, excludes marked offer lines from trigger quantity, validates cart subtotal thresholds using decimal-safe fixed-scale parsing, validates rule and compilation markers, validates the offer parent Product GID, and creates deterministic product discount candidates.

Supported rewards are percentage off, fixed amount off per item, and fixed final unit price. Fixed final price subtracts the configured final price from Shopify's current line unit amount and emits a per-item fixed amount only when the result is positive.

Reward maximum quantity is applied across all marked lines for a rule in original cart-line order. Duplicate cart-line targeting is defensively blocked across rules.

## Tests and fixtures

Unit tests cover PRODUCT class gating, malformed configuration, percentage, fixed amount, fixed price, reward cap, wrong compilation markers, and unmarked offer lines. Required fixture filenames were added under `tests/fixtures`.

## Validation results

- `cargo fmt --check`: passed.
- `cargo test`: passed, 8 tests.
- `cargo build --target=wasm32-wasip1 --release`: failed because the `wasm32-wasip1` Rust standard library target is not installed in the container.
- `shopify app function build --config shopify.app.megaska-ops-hub-express-dev.toml`: failed because `shopify` CLI is not installed.
- `npm run lint`: failed on existing repository lint errors outside this phase.
- `npm run typecheck`: failed on existing Prisma/generated type mismatches outside this phase.
- `npm run build`: compiled the Next.js bundle and failed during type checking on the same existing Prisma/generated type mismatch class.

## Deferred behavior

CONFIG-2F.6R-D should implement full generated Shopify bindings, multi-rule priority and conflict handling, ALL semantics, schedule evaluation, and additional hardening. No publication, automatic discount creation, configuration metafield write, storefront code, cart drawer code, Prisma migration, or shared Shopify service code was added.
