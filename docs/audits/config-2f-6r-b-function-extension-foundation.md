# CONFIG-2F.6R-B Function Extension Foundation

## Repository audit

- Existing extensions before implementation were `megaska-phone-checkout-validation` and `megaska-otp`.
- No complete surviving promotion Discount Function extension was present.
- Root `package.json`, `shopify.app.toml`, and `shopify.app.megaska-ops-hub-express-dev.toml` were inspected and left unchanged.
- Existing promotion compiler payload code remains in `services/promotions/compiler-payload.ts`; no compiler or service files were modified.
- Repository TypeScript tests use Node's built-in test runner. This phase adds Rust unit tests local to the Function crate.

## Extension

- Handle: `loopdesk-discount-function`.
- Merchant-readable name: `LoopDesk Promotions`.
- API version: `2026-04`.
- Function target: `cart.lines.discounts.generate.run` only.
- Rust/WASM target: `wasm32-wasip1`.
- Build command: `cargo build --target=wasm32-wasip1 --release`.
- Configured WASM path: `target/wasm32-wasip1/release/loopdesk_discount_function.wasm` because Cargo normalizes the hyphenated package name to an underscored artifact name.

## Configuration metafield

- Namespace: `$app:loopdesk-promotions`.
- Key: `function-config`.
- Query alias: `configuration`.
- No shop, product, variant, app API, database, storefront, or secondary configuration reads were added.

## Minimal input fields

The input query reads cart subtotal, cart line IDs, quantities, amount per quantity, LoopDesk line attributes, ProductVariant and Product IDs, discount classes, and the app-owned configuration metafield.

## Foundation JSON schema

The accepted top-level foundation shape is `{ "schemaVersion": 1, "configurationVersion": 1, "configurationHash": "sha256-value", "rules": [] }`. `schemaVersion` must be `1`, `configurationVersion` must be positive, `configurationHash` must be non-blank, and `rules` must exist as an array. Rule internals are intentionally not interpreted in this phase. Unknown top-level fields are ignored for forward compatibility.

## Fail-closed behavior

The Function checks for the `PRODUCT` discount class, parses the optional configuration metafield only when the class is present, and returns an empty operations array for all inputs and all parser outcomes. Missing, blank, malformed, unsupported, and invalid configuration values do not panic, trap, or surface customer-facing errors.

## Tests added

- Parser classification tests for missing, blank, malformed, unsupported schema version, invalid configuration version, blank hash, missing rules, valid empty configuration, and unknown top-level fields.
- Function tests for missing PRODUCT class, PRODUCT class with missing configuration, PRODUCT class with malformed configuration, PRODUCT class with valid empty configuration, empty cart, and deterministic repeated output.

## Commands and results

- `shopify version`: failed; Shopify CLI is not installed in the environment.
- `cargo fmt --check`: passed.
- `cargo test`: passed.
- `rustup target add wasm32-wasip1`: failed because the environment could not download `rust-std-wasm32-wasip1` through the network tunnel.
- `cargo build --target=wasm32-wasip1 --release`: not completed because the required Rust standard library target could not be installed in this environment.
- `cargo build --release`: passed for the native release artifact.
- `shopify app function build`: not run successfully because the Shopify CLI is not installed.
- `npm run lint`: failed on pre-existing repository lint errors outside this phase, including generated Prisma output and unrelated app/service files.
- `npm run typecheck`: failed on pre-existing generated Prisma/model mismatches and unrelated application files.
- `npm run build`: compiled the Next.js production bundle, then failed during type checking on pre-existing unrelated Prisma include/type errors.

## Generated-template differences

The Shopify CLI was not available in the environment (`shopify: command not found`), so the extension was manually scaffolded to match the approved Rust extension layout. A minimal schema snapshot file and checked-in Rust input/output type module are included for this foundation phase.

## Scope confirmation

No discount execution, discount candidates, publication, automatic discount creation, eligibility logic, reward logic, storefront runtime, cart drawer, Prisma, or shared Shopify infrastructure changes were implemented.
