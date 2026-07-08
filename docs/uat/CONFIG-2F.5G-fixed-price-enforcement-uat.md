# CONFIG-2F.5G — Fixed Price Enforcement UAT & Activation Report

Date: 2026-07-08

## Scope requested

Validate fixed_price enforcement end-to-end on a real/dev Shopify shop without adding percentage, fixed amount, or free-gift enforcement and without changing DB schema or checkout/order/payment logic.

## Environment status

| Check | Result | Evidence |
| --- | --- | --- |
| Pull latest main | Blocked | This workspace has no `origin` remote configured and only the local `work` branch is present, so `git pull origin main` cannot be run here. |
| Shopify CLI present | Blocked | `shopify` is not on PATH. |
| Shopify CLI install attempt | Blocked | `npm install -g @shopify/cli@latest` returned npm `E403 Forbidden` from the configured registry/policy. |
| Function build | Failed | `npm run build:discount-function` failed because Shopify CLI is unavailable. |
| Real WASM artifact | Missing | `extensions/loopdesk-discount-function/dist/function.wasm` is not present after the failed build. |
| Admin activation route | Not executed | Activation is intentionally blocked by missing validated WASM artifact, and this workspace does not include live shop/session credentials for a real Shopify admin request. |
| Storefront UAT | Not executed | Requires successful activation on a real/dev Shopify shop and storefront access. |

## Commands run

```bash
git status --short --branch
git remote get-url origin
command -v shopify
shopify version
npm install -g @shopify/cli@latest
npm run build:discount-function
if [ -f extensions/loopdesk-discount-function/dist/function.wasm ]; then file extensions/loopdesk-discount-function/dist/function.wasm && wc -c extensions/loopdesk-discount-function/dist/function.wasm; else echo missing; fi
node --test services/loopdesk/discount-function-config.test.mts
```

## Build result

`npm run build:discount-function` did not produce a function artifact. The build script correctly refused to generate any fallback or synthetic WASM and failed with:

```text
Error: Shopify CLI is unavailable. Install Shopify CLI and its JavaScript Functions/Javy toolchain, then rerun npm run build:discount-function; no fallback function.wasm will be generated.
```

## Activation diagnostics

Activation was not invoked against a live Shopify shop because the build artifact prerequisite failed. Based on the activation guard, the expected local diagnostics would remain blocked until a valid Shopify Function WASM is present:

| Diagnostic | Observed / expected in this workspace |
| --- | --- |
| `functionFound` | Not reached |
| `functionId` | Not reached |
| `automaticDiscount` | `not-run` |
| `automaticDiscountId` | `null` |
| `metafieldUpdated` | `false` |
| `rulesCompiledCount` | Not validated against live shop in this run |
| `buildArtifactPresent` | `false` |
| `activationStatus` | `blocked` |

## Automatic discount ID / title / status

No automatic discount was created or updated in this run. Therefore:

| Field | Value |
| --- | --- |
| ID | Not available |
| Title | Not available from Shopify; activation code uses `LoopDesk Promotions` when creating/updating. |
| Status | Not available |

## Checkout discount result

Checkout UAT was not executed because activation could not proceed without Shopify CLI/function tooling and a real WASM artifact.

## Unsupported reward types

Not validated on a live shop in this run. The current implementation compiles only `fixed_price` reward discounts for function enforcement; unsupported/non-fixed reward discount types are ignored before reaching the Shopify Function configuration.

## Issues found

1. The repository has no configured Git remote, so pulling latest `main` was blocked.
2. Shopify CLI is not installed in the environment.
3. Installing Shopify CLI from npm is blocked by registry/policy with `E403 Forbidden`.
4. The discount function build cannot complete without Shopify CLI/function tooling.
5. No `dist/function.wasm` artifact exists; activation correctly remains blocked.
6. Live activation and storefront checkout UAT require real/dev shop credentials, a valid app installation/session, and storefront access, none of which are present in this workspace.
7. `node --test services/loopdesk/discount-function-config.test.mts` currently fails under direct Node execution because extensionless TypeScript imports such as `services/db/prisma` are not resolved by Node's native test runner in this setup.

## Next required actions outside this workspace

1. Configure the repository remote and pull `main`.
2. Install Shopify CLI and Shopify Function/Javy tooling in an environment with registry access.
3. Run `npm run build:discount-function` and confirm `extensions/loopdesk-discount-function/dist/function.wasm` exists, is larger than a minimal/synthetic module, exports `cartLinesDiscountsGenerateRun`, and imports the Shopify Function runtime.
4. Start/deploy the app with valid Shopify app configuration and an installed dev shop.
5. POST to `/admin/promotion-rules/actions/activate-discount-function` from a valid admin session and record the JSON diagnostics.
6. Create the fixed-price promotion rule in admin.
7. Perform storefront and checkout UAT, capturing screenshots and confirming only the reward line is discounted.
8. Repeat activation twice and verify the same automatic discount is updated idempotently rather than duplicated.
