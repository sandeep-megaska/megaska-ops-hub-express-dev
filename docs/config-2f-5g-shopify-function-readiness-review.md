# CONFIG-2F.5G — Shopify Function Environment Readiness Review

Date: 2026-07-08

Scope: repository readiness review and deployment preparation only. Codex Cloud did not install local software and did not run Shopify CLI against Sandeep's development environment.

## Executive recommendation

CONFIG-2F.5H should **not** begin until successful local UAT confirms a real Shopify CLI-generated `extensions/loopdesk-discount-function/dist/function.wasm` artifact and checkout behavior in a development store.

The repository is **ready for local Shopify CLI build preparation**, but local UAT has one material gate: the committed JavaScript function source still contains a foundation path that returns no discount operations. Do not treat checkout fixed-price enforcement as proven until the locally built artifact demonstrates the expected fixed-price rule behavior in checkout.

## Repository readiness report

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Extension structure | Ready for JS Shopify Function build | `extensions/loopdesk-discount-function` contains the extension manifest, GraphQL input query, JS target source, build script, package manifest, and `dist/README.md`. | No Rust extension layout is present for this function. |
| Cargo.toml / Cargo.lock | Not applicable / absent | No `Cargo.toml` or `Cargo.lock` files exist in the repository. | This is a JavaScript Shopify Function extension path, not a Rust function path. |
| Rust source | Not applicable / absent | No Rust source files were found for the discount function. | Local build depends on Shopify CLI JS Functions/Javy tooling rather than Cargo. |
| Build scripts | Ready, with no synthetic fallback | Root `build:discount-function` delegates to the extension build; extension `build` runs `scripts/build-shopify-function.mjs`. The script deletes stale `dist/function.wasm`, requires Shopify CLI, runs `shopify app function build`, and refuses minimal/synthetic artifacts. | Codex Cloud did not run Shopify CLI. |
| package.json scripts | Ready | Root scripts include `build:discount-function`; extension scripts include `build` and `typecheck`. | Use the root script for the local function build. |
| shopify.extension.toml | Ready for local CLI validation | Manifest sets API version `2026-04`, function type, `cart.lines.discounts.generate.run` targeting, GraphQL input query, JS export, and build output path `dist/function.wasm`. | Shopify CLI remains the source of truth for final manifest validation. |
| GraphQL input | Ready for configured rule evaluation | Input fetches the discount metafield and cart line product/variant metadata needed by supported triggers. | Query includes product tags, product type, collection membership, variant id, quantities, and subtotal amounts. |
| Activation service | Ready with artifact gate | Activation validates the local artifact before querying app discount types or creating/updating automatic app discounts. | Activation compiles current promotion rules into the discount metafield payload. |
| Activation validation | Ready | Validation requires artifact existence, non-minimal size, WASM magic header, `WebAssembly.Module` validation, target export, and Shopify function runtime imports. | This blocks fake/minimal WASM activation. |
| Function artifact validation | Ready | `validateLoopDeskDiscountFunctionBuildArtifact()` is used directly in activation and exposed through `loopDeskDiscountFunctionBuildArtifactPresent()`. | A missing artifact returns a blocked activation diagnostic rather than proceeding. |
| .gitignore | Ready | Generated `extensions/loopdesk-discount-function/dist/function.wasm` is ignored. | Real artifacts are generated locally and are not committed. |
| Compiled reward configuration | Ready for fixed-price-only payloads | The compiler emits only active, enabled rules with `reward.discount.type === "fixed_price"`, valid reward product/variant gids, numeric fixed price, and valid trigger values. | No new reward types were added in this phase. |

## Placeholder and fake-WASM review

### Placeholder implementations

Remaining issue: the function source still includes foundation wording and currently returns the prepared `evaluation.discountOperations` array without adding operations. This means repository readiness is **not the same as verified fixed-price checkout enforcement**. Local UAT must prove the Shopify CLI-built artifact applies a fixed-price rule, or this must be fixed before CONFIG-2F.5H.

### Fake WASM generation paths

No fake WASM generation path remains in the repository-owned build flow. The extension build script fails when Shopify CLI is absent, fails when Shopify CLI does not produce `dist/function.wasm`, and deletes/refuses a minimal artifact. The generated WASM artifact is ignored by git.

### Activation artifact requirement

Activation requires a real local function artifact before Shopify Admin API discount activation proceeds. The gate checks the artifact path, size, WASM header, module validity, exported target function, and Shopify Function runtime imports.

## Remaining issues

1. **Local Shopify CLI build not executed in Codex Cloud.** Sandeep must run the local CLI build and confirm `dist/function.wasm` is produced.
2. **Checkout behavior not verified in Codex Cloud.** Fixed-price enforcement must be tested in a development store checkout after local build and activation.
3. **Function source still appears foundation-only.** The local UAT should be treated as the acceptance gate for whether the artifact enforces fixed-price discounts; if no discount applies, CONFIG-2F.5H should remain blocked.
4. **No Rust/Cargo artifacts exist.** If the intended standard is a Rust Shopify Function, a separate migration/scaffold phase is required. This review does not introduce Rust, new reward types, discount-logic changes, or schema changes.

## Deployment checklist

- [ ] Pull the reviewed branch locally.
- [ ] Install dependencies with the project's normal package manager workflow.
- [ ] Install Shopify CLI locally.
- [ ] Authenticate Shopify CLI against the correct partner/store context.
- [ ] Run the app locally with environment variables for the target development shop.
- [ ] Build the LoopDesk discount function locally.
- [ ] Verify `extensions/loopdesk-discount-function/dist/function.wasm` exists and is larger than a minimal header.
- [ ] Confirm activation endpoint returns `ok: true`, `activationStatus: "activated"`, `functionFound: true`, and `metafieldUpdated: true`.
- [ ] Create or enable one fixed-price promotion rule.
- [ ] Validate checkout behavior with qualifying and non-qualifying carts.
- [ ] Capture diagnostics and screenshots from the development store.
- [ ] Roll back automatic app discount and disable the rule if UAT fails.

## Local UAT Guide for Sandeep

### 1. Pull the latest branch

```bash
git pull
npm install
```

Expected: dependencies install successfully and Prisma generation/postinstall completes according to the repo's existing setup.

### 2. Install Shopify CLI

Install Shopify CLI on the local machine using Shopify's current official installation instructions for the operating system.

Then verify:

```bash
shopify version
```

Expected: Shopify CLI prints a version and exits successfully.

### 3. Login / authenticate

```bash
shopify auth login
```

Expected: browser login completes for the correct Shopify Partner/development-store account.

If the CLI version uses a different auth command, use the current Shopify CLI equivalent and record it in the UAT notes.

### 4. Start the app development server

From the repository root:

```bash
npm run dev
```

In a second terminal, if Shopify app tunneling/dev orchestration is required for the app configuration, run the appropriate local Shopify app dev command for the project:

```bash
shopify app dev
```

Expected: the Next.js app starts, Shopify app dev links to the intended app and development store, and the app is reachable from the development store/admin context.

### 5. Build the Shopify Function

From the repository root:

```bash
npm run build:discount-function
```

Equivalent extension-local command:

```bash
npm --prefix extensions/loopdesk-discount-function run build
```

Expected:

- The build invokes `shopify app function build` from `extensions/loopdesk-discount-function`.
- No fallback artifact is generated.
- The command exits successfully.
- `extensions/loopdesk-discount-function/dist/function.wasm` exists.

### 6. Verify `function.wasm`

```bash
node -e "const fs=require('fs'); const p='extensions/loopdesk-discount-function/dist/function.wasm'; const b=fs.readFileSync(p); console.log({size:b.length, magic:[...b.slice(0,4)]}); if (b.length<=8) process.exit(1); if (b[0]!==0||b[1]!==97||b[2]!==115||b[3]!==109) process.exit(1);"
```

Expected: output includes a meaningful size and magic bytes `[0,97,115,109]`.

### 7. Activate the function

Use the admin UI action or call the activation endpoint in the authenticated admin context:

```bash
curl -i -X POST "http://localhost:3000/admin/promotion-rules/actions/activate-discount-function"
```

Expected diagnostics:

- `ok: true`
- `diagnostics.buildArtifactPresent: true`
- `diagnostics.functionFound: true`
- `diagnostics.activationStatus: "activated"`
- `diagnostics.metafieldUpdated: true`
- `diagnostics.rulesCompiledCount` matches the active fixed-price rules eligible for function enforcement
- `diagnostics.automaticDiscount` is `"created"` on first activation or `"updated"` on repeat activation

If activation returns `409`, read `message` and `diagnostics`. A missing/invalid artifact must be resolved by rebuilding locally; do not bypass this gate.

### 8. Create a `fixed_price` rule

In the promotion-rules admin UI or existing configuration workflow:

- Enable Promotion Rules globally.
- Create a rule with status `active` and `enabled: true`.
- Select a supported trigger, such as `always` for a smoke test or `cart_contains_product` for targeted validation.
- Select the offer product and variant.
- Set `reward.discount.type` to `fixed_price`.
- Set `reward.discount.value` to the intended fixed price.
- Save the configuration.
- Re-run activation so the automatic discount metafield receives the compiled rules.

Expected: activation diagnostics show `rulesCompiledCount >= 1`.

### 9. Checkout validation

Qualifying-cart test:

- Add the trigger product or satisfy the configured trigger condition.
- Add the reward variant, if the drawer/app flow does not add it automatically.
- Proceed to checkout.
- Confirm the automatic app discount appears.
- Confirm the reward line is priced at the configured fixed price after discount.

Non-qualifying-cart test:

- Remove trigger conditions or use an unrelated cart.
- Proceed to checkout.
- Confirm no LoopDesk fixed-price discount is applied.

Regression checks:

- Confirm non-reward products do not receive the reward discount.
- Confirm inactive, draft, paused, or disabled rules do not compile into active discount behavior.
- Confirm repeat activation updates the existing automatic discount rather than creating duplicate active discounts.

### 10. Expected diagnostics to capture

Capture and paste into the UAT record:

- Output of `shopify version`.
- Output of `npm run build:discount-function`.
- Output of the Node WASM verification command.
- Activation JSON response.
- Promotion rule id/name used for testing.
- Qualifying checkout screenshot showing discount behavior.
- Non-qualifying checkout screenshot showing no discount.
- Any Shopify Admin API user errors, if present.

### 11. Rollback procedure

If UAT fails or discount behavior is wrong:

1. Disable the Promotion Rules config globally or pause/archive the tested rule.
2. In Shopify Admin, disable/delete the `LoopDesk Promotions` automatic app discount if it was created.
3. Re-run activation only after the rule/config has been corrected, or leave automatic discount disabled until the next fix is deployed.
4. Remove the local generated artifact if a clean rebuild is needed:

```bash
rm -f extensions/loopdesk-discount-function/dist/function.wasm
npm run build:discount-function
```

5. Record the failure mode, diagnostics, and checkout screenshots before starting the next implementation phase.

## CONFIG-2F.5H readiness recommendation

CONFIG-2F.5H can begin **only after successful local UAT** confirms all of the following:

- Shopify CLI builds a real `function.wasm` locally.
- Activation succeeds with a real function id and automatic app discount.
- A compiled `fixed_price` rule produces the expected checkout discount.
- Non-qualifying carts do not receive the discount.
- Rollback has been tested or documented for the development store.

Until those checks pass, CONFIG-2F.5H should remain blocked.
