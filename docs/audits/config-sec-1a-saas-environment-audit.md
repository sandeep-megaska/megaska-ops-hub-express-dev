# CONFIG-SEC-1A SaaS environment audit

## Scope and method

The audit covered `app/`, `services/`, `lib/`, `extensions/`, `scripts/`, `prisma/`, `sections/`, and `templates/`. Searches included direct and indexed `process.env` reads, helper-based reads, `NEXT_PUBLIC_*`, merchant/provider names, domains, credentials, contact data, development controls, extension assets, jobs, webhooks, OAuth, billing, GST, reviews, OTP, wallet, and Express Checkout.

The authoritative variable-by-variable result is [the environment inventory](../environment-variables.md). The repository check is `npm run audit:saas-env`; CI runs the same command.

## Stage 1 changes

### Platform variables retained

Database connectivity, Shopify application/OAuth/webhook configuration, token and payout encryption, LoopDesk operational authorization, Resend, Supabase, application URL, and the optional LoopDesk Twilio fallback remain platform-owned. `services/config/environment.ts` provides typed, redaction-safe access and production development-flag rejection.

### Merchant variables migrated

- Express Checkout Razorpay already resolves through the tenant `razorpay_config` record. COD Advance and exchange payment links now use that same `shopId`-scoped configuration.
- Exchange Razorpay webhook verification selects the webhook secret only after resolving the payment's tenant.
- The Delhivery pincode route resolves the active shop and `delhivery_config`; absence returns `DELHIVERY_NOT_CONFIGURED` and never selects a global token.
- Storefront access no longer adds a global storefront token after shop resolution. Production default-shop bootstrapping is disabled.
- OAuth no longer special-cases the cloned merchant or globally enables new installations. Tenant readiness remains authoritative.

### Legacy variables deprecated

`MEGASKA_CUSTOM_SESSION_SECRET` is supported only through the canonical `LOOPDESK_SESSION_SECRET` compatibility resolver. A warning names the deprecated and canonical variables but never logs either value. `SESSION_SECRET`, Shopify encryption aliases, and internal diagnostic aliases remain migration items documented in the inventory.

### Hard-coded store references removed

The OAuth install exception and wallet CORS origin were removed. Wallet CORS now reflects only syntactically valid Shopify origins. Generated Shopify schema examples and the isolated MEGA15 migration adapter are explicit audit exclusions; neither selects credentials.

## Deletion decisions

### Safe to remove from Preview after deployment smoke test

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` for the migrated Express Checkout, COD Advance, and exchange paths.
- `DELHIVERY_API_TOKEN` and merchant origin/pickup variables for the migrated pincode path.
- `EXPRESS_CHECKOUT_ALLOWED_SHOPS` once Preview confirms all entry points use tenant readiness.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` after local-only bootstrap workflows are replaced with explicit script arguments.

### Safe to remove from Production

None in Stage 1. Production deletion is intentionally gated on two-shop UAT and Preview removal proof.

### Requiring further migration

- Legacy standalone OTP transport helpers still require conversion to encrypted merchant provider records before `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, and `OTP_PROVIDER` deletion.
- Remaining notification sender/recipient globals require completion of tenant notification settings coverage.
- Standalone logistics, GST sync, and legacy Razorpay compatibility modules listed as consumers in the inventory require tenant resolver proof.
- Development bootstrap variables and MEGA15 compatibility identifiers require explicit migration tooling before removal.

## UAT evidence and required deployment proof

Automated evidence covers static prohibited-pattern detection and lint. TypeScript compilation is currently blocked by the repository's stale generated Prisma client, and database/provider UAT cannot be truthfully completed without two installed shops and provider credentials; the following remains the release gate:

| UAT | Stage 1 evidence | Deployment proof required |
|---|---|---|
| A — existing merchant | Tenant resolver compatibility retained. | Exercise all enabled modules. |
| B — clean merchant | OAuth has no cloned-shop exception; missing providers return not-configured. | Install and smoke-test admin/cart/Shopify Checkout. |
| C — tenant Razorpay | Express, COD Advance, exchange and webhook paths resolve by `shopId`. | Configure through Merchant Settings without redeploy. |
| D — no Delhivery | Pincode path returns `DELHIVERY_NOT_CONFIGURED`. | Confirm unrelated modules and manual flow. |
| E — international OTP | Country policy remains E.164 capable. | Configure a non-India tenant provider and verify delivery. |
| F — unresolved shop | Storefront and Delhivery paths fail without default production shop. | Exercise missing/unknown shop requests. |
| G — production safety | Central resolver rejects production development flags; audit runs in CI. | Deploy Preview, inspect redacted logs, then repeat in Production. |

Vercel variables must not be deleted until the deployment proof above is recorded. Inherited merchant secrets must be rotated after removal.
