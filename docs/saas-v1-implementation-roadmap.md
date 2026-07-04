# CONFIG-1D — SaaS v1 Implementation Roadmap & Migration Strategy

Date: 2026-07-04  
Scope: implementation roadmap and migration strategy for converting Megaska Ops Hub from an internal Shopify operations app into SaaS-ready Version 01.  
Status: documentation/planning only; no application code, Prisma schema, migrations, or runtime behavior changes.

## 1. SaaS v1 target scope

SaaS Version 01 converts the current internal Shopify operations app into a controlled, single-shop-per-merchant SaaS product while preserving existing production behavior until each runtime phase is explicitly approved and released.

Locked v1 assumptions:

- One merchant maps to exactly one Shopify shop.
- Do **not** introduce a separate multi-shop `Merchant` aggregate in v1.
- The existing shop-root tenancy model remains the v1 tenant boundary.
- Merchant-owned Razorpay is mandatory before production payment activation.
- Merchant-owned Delhivery is mandatory before production shipment activation.
- Resend is platform-owned by default, with optional merchant-owned email sending after verification.
- Twilio is platform-owned by default, with optional merchant-owned Twilio after validation.
- WhatsApp is platform-owned by default, with optional merchant-owned WhatsApp after onboarding and verification.
- MSG91 is optional merchant-owned OTP only, and must remain inactive unless KYC, DLT, and template approvals are all `APPROVED`.
- No new settings table, admin screen, wizard step, or seed operation may change live behavior by itself.

Target v1 capabilities:

- Shop-scoped settings domains for provider credentials, provider verification state, business policy settings, branding/theme, and install readiness.
- Explicit provider ownership and activation states.
- Settings revisions that can be snapshotted by payment, shipment, notification, GST, checkout, wallet, refund, and exchange workflows.
- Safe migration from environment-based configuration to encrypted DB-backed settings.
- A phased install wizard that guides merchants through required setup without silently enabling production behavior.
- Feature flags that allow schema creation, reads, dual-read shadow validation, write paths, verification, and runtime cutover to be released independently.

## 2. Explicit non-goals for v1

SaaS v1 does **not** include:

- A multi-shop merchant/account aggregate.
- Cross-shop billing, consolidated reporting, or organization/team hierarchy beyond the current shop-root model.
- Reinterpretation of historical payments, shipments, invoices, refunds, wallet transactions, checkout intents, OTP challenges, or notification outcomes using newly configured settings.
- Automatic production activation when credentials are entered.
- Silent fallback from merchant-owned Razorpay or Delhivery to platform credentials for production merchant activity.
- Silent fallback from merchant-owned communication providers to platform providers.
- Active MSG91 sending unless KYC, DLT, and template approval state are all `APPROVED`.
- Prisma schema changes, migrations, or code changes as part of this planning document.
- Runtime behavior changes before separate implementation approval.

## 3. Phase-by-phase implementation roadmap

### Phase 0 — Planning baseline and release controls

Purpose: lock implementation boundaries before touching runtime systems.

Deliverables:

- Confirm v1 tenancy: existing shop ID/domain is the tenant root.
- Create implementation tickets per domain and per migration.
- Define global feature flags and kill switches.
- Define approval roles for provider activation and rollback.
- Define acceptance criteria for each phase.

Migration required: no.  
Documentation/UI-only: documentation only.  
Runtime behavior change: no.

### Phase 1 — Schema design for settings, revisions, and provider states

Purpose: design DB-backed settings without changing live behavior.

Suggested domain additions:

- `ShopSettingsRevision` or equivalent shop-scoped settings revision table.
- `ShopSettingsAuditEvent` for write, verify, activate, suspend, rollback, and secret-rotation events.
- `ShopRazorpaySettings` with encrypted secret references, verification status, active revision, and mode.
- `ShopDelhiverySettings` and `ShopFulfillmentLocation` with encrypted token reference and pickup/origin details.
- `ShopCommunicationSettings` for channel policy, explicit fallback policy, and active provider selection.
- Provider-specific settings for merchant-owned Resend, Twilio, WhatsApp, and MSG91.
- `ShopThemeSettings` or `ShopBrandingSettings` for portable presentation tokens.
- Snapshot-reference columns or snapshot payload tables on future workflow records where settings-dependent actions occur.

Migration required: yes, in the later implementation phase that creates these tables/columns.  
Documentation/UI-only: schema design is documentation-only until approved.  
Runtime behavior change: no; new tables must be inert until feature flags enable reads/writes.

### Phase 2 — Encryption service and secret storage foundation

Purpose: create the secret-handling foundation before storing merchant credentials.

Suggested changes:

- Introduce a centralized encryption service or envelope encryption abstraction.
- Store encrypted values plus metadata: secret type, key version, last four characters where safe, created/updated timestamps, verified timestamp, rotated timestamp, and revoked timestamp.
- Ensure decrypted secrets are never returned to the browser after initial write.
- Ensure audit logs record secret lifecycle events without secret values.
- Add rotation workflow support: save candidate secret, verify candidate, promote candidate, retain old active secret only as needed for safe webhook/payment transition.

Migration required: yes, if adding secret metadata tables or encrypted columns.  
Documentation/UI-only: no; implementation requires code/schema, but must remain behavior-inert until enabled.  
Runtime behavior change: no until provider runtime cutover flags are enabled.

### Phase 3 — Admin settings surfaces and install wizard shell

Purpose: let merchants enter and validate settings while still using legacy runtime behavior.

Deliverables:

- Wizard shell with setup progress for Shopify install, Razorpay, Delhivery, communication providers, theme, GST/checkout/exchange/wallet settings as applicable.
- Admin settings pages for mandatory Razorpay and Delhivery.
- Admin settings pages for optional Resend, Twilio, WhatsApp, and MSG91.
- Status display for `NOT_CONFIGURED`, `PENDING_VERIFICATION`, `VERIFIED`, `ACTIVE`, `SUSPENDED`, and `ERROR`.
- Read-only masked secret display.
- Explicit labels for platform-owned vs merchant-owned providers.
- Explicit fallback controls for communication providers.

Migration required: no if built against already-created tables; yes only if tables do not yet exist.  
Documentation/UI-only: UI and settings writes only; no live workflow cutover.  
Runtime behavior change: no.

### Phase 4 — Provider verification flows

Purpose: validate merchant credentials and readiness without production activation.

Deliverables:

- Razorpay credential verification and webhook test status.
- Delhivery token verification, pickup/origin validation, and pincode/serviceability checks.
- Resend sender/domain verification.
- Twilio account/service validation.
- WhatsApp WABA, phone number, token, webhook, and template validation.
- MSG91 approval state capture for KYC, DLT, and templates.

Migration required: no if schema exists.  
Documentation/UI-only: no; this adds server verification code, but still no live business cutover.  
Runtime behavior change: no for production workflows.

### Phase 5 — Dual-read shadow mode and settings snapshots

Purpose: compare DB settings with current environment/config behavior and add immutable snapshot support before cutover.

Deliverables:

- Shadow resolver reads DB settings and legacy env settings, logs differences, and reports readiness.
- Snapshot object/version contract for each workflow that consumes settings.
- Settings revision IDs captured in newly created workflow records only after explicit flag enablement.
- No mutation of historical records.

Migration required: likely yes if adding snapshot-reference columns or snapshot tables.  
Documentation/UI-only: no.  
Runtime behavior change: no business outcome change; diagnostics only.

### Phase 6 — Controlled runtime cutover by domain

Purpose: activate DB settings one domain at a time with feature flags and rollback switches.

Recommended sequence:

1. Theme/branding portability.
2. Notification sender/template settings where platform fallback remains explicit.
3. Delhivery settings for selected test shops, then production shops after verification.
4. Razorpay settings for selected test shops, then production shops after verification.
5. Optional merchant-owned Twilio/WhatsApp/Resend.
6. MSG91 only for merchants with all approvals `APPROVED`.

Migration required: no if prior schema is complete.  
Documentation/UI-only: no.  
Runtime behavior change: yes, but only behind per-domain and per-shop activation flags.

### Phase 7 — Legacy env deprecation and cleanup

Purpose: remove dependency on env-based merchant settings only after safe cutover and observation.

Deliverables:

- Deprecation report for env values that are now DB-owned.
- Read-only backup/export of legacy env-derived bootstrap values.
- Removal plan for legacy fallback code in a later release.
- Post-cutover monitoring and audit review.

Migration required: maybe, if adding deprecation markers or cleanup migrations.  
Documentation/UI-only: mixed; reporting can be documentation/admin-only, cleanup requires code changes.  
Runtime behavior change: yes only when legacy fallback is removed, and only after approval.

## 4. Suggested schema/domain changes by phase

| Phase | Suggested schema/domain changes | Notes |
| --- | --- | --- |
| Phase 1 | Shop settings revision/audit tables; provider settings tables; theme settings table; communication settings table | Create as inert schema only when implementation starts. |
| Phase 2 | Secret metadata/encrypted secret references | Prefer reusable secret abstraction over duplicating encrypted columns without metadata. |
| Phase 3 | No additional schema if Phase 1/2 complete | UI should write settings but not activate workflows automatically. |
| Phase 4 | Verification timestamps, error codes, provider account IDs, approval status fields | Verification state is provider-derived, not merchant-edited. |
| Phase 5 | Workflow snapshot references/payloads | Required for immutable settings-at-action behavior. |
| Phase 6 | Activation timestamps, active revision pointers, per-domain cutover markers | Avoid using current rows implicitly; always select an approved active revision. |
| Phase 7 | Optional deprecation/cleanup markers | Only after DB settings are authoritative. |

## 5. Which phases require migrations

Migrations are expected for:

- Phase 1: new settings, revision, audit, provider, communication, and theme tables.
- Phase 2: encrypted secret storage metadata or encrypted columns.
- Phase 4: provider verification/approval state if not included in Phase 1.
- Phase 5: workflow snapshot references or snapshot payload tables.
- Phase 6: activation pointers/markers if not included earlier.
- Phase 7: cleanup/deprecation changes if legacy fields or compatibility tables are removed.

Migrations are not expected for:

- Phase 0 planning.
- Phase 3 UI shell if schema already exists.
- Documentation updates, runbooks, and UAT checklists.

## 6. Which phases are documentation/UI-only

Documentation-only:

- Phase 0.
- This CONFIG-1D roadmap.
- Future runbooks and UAT scripts until implementation is approved.

UI-only or UI-first with no runtime cutover:

- Phase 3 install wizard shell and settings entry screens.
- Provider status dashboards that only display already-stored verification state.
- Theme preview screens that do not alter live storefront behavior until the theme flag is enabled.

Not UI-only:

- Secret encryption.
- Provider verification.
- Snapshotting.
- Runtime provider cutover.
- Legacy fallback removal.

## 7. Feature flag strategy

Use layered flags so each risk can be enabled independently:

- Global capability flags:
  - `saasSettingsSchemaEnabled`
  - `settingsWriteEnabled`
  - `settingsVerificationEnabled`
  - `settingsShadowReadEnabled`
  - `settingsRuntimeReadEnabled`
- Domain flags:
  - `razorpayMerchantOwnedEnabled`
  - `delhiveryMerchantOwnedEnabled`
  - `merchantEmailProviderEnabled`
  - `merchantTwilioEnabled`
  - `merchantWhatsAppEnabled`
  - `merchantMsg91Enabled`
  - `themeSettingsRuntimeEnabled`
- Shop-scoped rollout flags:
  - Enable per test shop first.
  - Enable per production merchant only after verification, UAT, and approval.
- Kill switches:
  - Disable merchant-owned provider reads per domain.
  - Force platform communication provider only when explicitly configured as allowed.
  - Suspend payment/shipment creation if mandatory merchant providers are not verified.

Rules:

- Adding tables must not enable runtime reads.
- Writing settings must not activate providers.
- Verification must not activate providers.
- Activation must require a separate explicit action and flag.
- Communication fallback must be explicit and auditable.
- MSG91 must fail closed unless all approval flags are `APPROVED`.

## 8. Backward compatibility strategy

Backward compatibility principles:

- Existing production behavior remains unchanged until per-domain runtime flags are enabled.
- Legacy env-based settings remain the active source during schema, UI, write, and verification phases.
- DB settings are first introduced as inert records, then shadow-read, then selectively activated.
- Existing historical workflow records must continue to render and reconcile using their original persisted facts and snapshots.
- If a historical record lacks a settings revision reference, treat it as legacy and use its stored fields, not current settings.
- Never reinterpret old payments, shipments, invoices, refunds, wallet transactions, checkout intents, or notification sends against current provider settings.

Compatibility layers:

1. Legacy resolver: current env/config behavior.
2. DB settings resolver: future shop-scoped settings.
3. Shadow resolver: compares both without changing results.
4. Runtime resolver: returns DB settings only after activation and verification.
5. Legacy fallback resolver: temporary rollback path, explicitly logged and gated.

## 9. Migration strategy from env-based config to DB settings

Recommended migration path:

1. Inventory all env values that represent merchant-operational settings.
2. Classify each env as platform-only, legacy bootstrap, merchant-owned mandatory, merchant-owned optional, or deprecated.
3. Create DB settings rows in `NOT_CONFIGURED` or `LEGACY_IMPORTED_DRAFT` status without activating them.
4. For the existing internal shop, optionally seed draft settings from env values for operator review.
5. Require verification before moving any provider to `VERIFIED`.
6. Require explicit activation before moving any provider to `ACTIVE`.
7. Enable shadow reads and compare runtime decisions.
8. Enable runtime reads per shop/domain only after UAT passes.
9. Keep legacy env fallback available for rollback until stability criteria are met.
10. Deprecate legacy env keys only after multiple successful production cycles.

Important constraints:

- Imported env credentials are not automatically trusted as merchant-owned credentials.
- Production payment/shipment activation still requires provider verification.
- Platform fallback is allowed only where the ownership model permits it and where fallback was explicitly configured.

## 10. Secret migration/encryption strategy

Secret migration approach:

- Do not store raw secrets in general settings JSON.
- Move secrets into encrypted fields or a dedicated encrypted secret store.
- Use envelope encryption or an application encryption service with key version metadata.
- Record non-secret metadata for display and audit: provider, mode, last4, status, createdAt, updatedAt, verifiedAt, rotatedAt.
- Never display decrypted secrets after save.
- Avoid logging request bodies that contain secret candidates.
- For env-to-DB import, use a one-time operator-controlled migration job and immediately mark imported secrets as requiring verification.

Rotation approach:

- Store candidate credentials separately from active credentials.
- Verify candidate credentials before promotion.
- Promote atomically to a new settings revision.
- Keep prior credentials only as long as needed for safe webhook overlap.
- Record rotation in audit events without secret values.

## 11. Settings revision/snapshot strategy

Every workflow that depends on configurable behavior must capture the settings revision used at the time of action.

Required behavior:

- Create a new settings revision when relevant settings change.
- Store revision metadata: shop, domain, version, status, author/system actor, reason, createdAt, activatedAt, supersededAt.
- Snapshot the effective settings values needed to reproduce or audit the action.
- Store references to provider/account IDs and masked credential metadata, not decrypted secrets.
- For money, shipment, tax, and customer-communication workflows, persist the exact computed values used.

Workflows that must snapshot settings:

- Razorpay order/payment/link creation and webhook processing context.
- Delhivery forward/reverse shipment creation and pickup/origin context.
- GST invoice/credit note/debit note generation.
- Checkout intent creation, payment method selection, COD fee, COD advance, discount, and order creation.
- Refund and wallet/store-credit decisions.
- Exchange/return eligibility, pickup charge policy, and customer-facing policy copy.
- Notification sends, including provider, template, sender, fallback decision, and template revision.

Historical rule:

- If an old record has no revision reference, keep using the data already persisted on that record or the legacy behavior required to display it. Do not backfill new settings meaning into old records unless a separately approved audit-safe migration is designed.

## 12. Razorpay migration strategy

Razorpay is merchant-owned mandatory for SaaS v1.

Recommended phases:

1. Add shop-scoped Razorpay settings and encrypted credential storage.
2. Add admin UI for key ID, key secret, webhook secret, mode, and masked metadata.
3. Add verification flow that validates credentials and webhook readiness.
4. Keep current env-based Razorpay behavior active until cutover.
5. Enable shadow comparison for selected shops.
6. Require `VERIFIED` status before enabling payment activation.
7. Activate only through an explicit action that creates an active settings revision.
8. For every payment/order/link, snapshot the active Razorpay revision and provider identifiers.
9. Verify webhooks using the revision/provider context associated with the payment where possible.
10. Remove or restrict platform Razorpay fallback for production merchant payments after cutover.

Risk controls:

- Do not process production merchant funds through platform credentials by default.
- Do not silently fall back to platform Razorpay if merchant credentials fail.
- Suspend payment activation rather than failing open.
- Rotation must verify candidate credentials before promotion.

## 13. Delhivery migration strategy

Delhivery is merchant-owned mandatory for SaaS v1.

Recommended phases:

1. Add shop-scoped Delhivery settings and encrypted token storage.
2. Add fulfillment-location settings for pickup name, origin address, origin PIN, contacts, package defaults, and account environment.
3. Add admin UI for merchant credentials and pickup/origin data.
4. Add verification for API token, pickup/origin, and serviceability.
5. Keep current env-based Delhivery behavior active until cutover.
6. Enable shadow validation comparing current payloads with DB-derived payloads.
7. Require `VERIFIED` status before production shipment activation.
8. Snapshot active Delhivery revision, pickup/origin data, account mode, and serviceability decision for every shipment.
9. Disable silent platform fallback for merchant production shipments after cutover.

Risk controls:

- Shipment booking must fail closed if mandatory merchant Delhivery settings are absent or unverified after cutover.
- Pickup/origin values used for a shipment must remain immutable on that shipment.
- Pincode/serviceability behavior that depends on account context should use the active merchant Delhivery context after activation.

## 14. Resend/Twilio/WhatsApp/MSG91 strategy

### Resend

- Platform-owned email is default.
- Merchant-owned Resend is optional.
- Merchant sender/domain must be verified before activation.
- Fallback to platform email must be explicit and auditable.
- Notification snapshots must include provider, sender, template revision, fallback decision, and status.

### Twilio

- Platform-owned Twilio is default for OTP/communications where applicable.
- Merchant-owned Twilio is optional.
- Validate account credentials, Verify service, sender/phone configuration, and allowed use cases before activation.
- Fallback to platform Twilio must be explicit and auditable.

### WhatsApp

- Platform-owned WhatsApp is default.
- Merchant-owned WhatsApp is optional.
- Validate WABA/phone number, access token, webhook verification, and template approval state before activation.
- Template selection must reference approved provider templates.
- Fallback to platform WhatsApp must be explicit, not silent.

### MSG91

- MSG91 is optional merchant-owned OTP only.
- It must remain inactive unless KYC, DLT, and template approvals are all `APPROVED`.
- If any status is `PENDING`, `REJECTED`, `EXPIRED`, missing, or unknown, MSG91 must fail closed.
- MSG91 should not become a general communication provider in v1 unless a later architecture decision expands scope.

## 15. Theme portability strategy

Theme portability should let a merchant carry customer-facing branding across checkout, portal, notification, and embedded surfaces without mixing presentation config with secrets or business rules.

Recommended v1 model:

- Store theme tokens separately from provider and business settings.
- Include logo asset references, color tokens, typography presets, radius/spacing tokens, app display name, and customer-facing copy blocks.
- Use `schemaVersion` for JSON theme blobs.
- Validate theme JSON server-side before save.
- Keep unsafe CSS/script injection out of merchant-editable fields.
- Preview theme changes before publishing.
- Publish as a new settings revision when made live.
- Snapshot customer-facing copy when it affects a transactional workflow.

Migration approach:

- Start with current defaults as platform theme defaults.
- Let merchants create draft theme settings.
- Enable preview-only first.
- Enable runtime theme reads only after UI/UAT approval.

## 16. Install wizard roadmap

Recommended wizard steps:

1. Shopify installation and shop identity confirmation.
2. Business profile and support contacts.
3. Mandatory Razorpay setup and verification.
4. Mandatory Delhivery setup, pickup/origin details, and verification.
5. Communication provider choices:
   - Use platform defaults.
   - Configure merchant-owned Resend/Twilio/WhatsApp.
   - Configure MSG91 OTP only if approval prerequisites can be satisfied.
6. Branding/theme setup and preview.
7. GST, checkout, exchange, wallet, and notification policy review where applicable.
8. Test transaction/shipment/notification checklist.
9. Final production readiness review.
10. Explicit activation request and approval.

Wizard rules:

- Wizard completion is not the same as production activation.
- Mandatory provider setup must block production payment/shipment activation until verified.
- Optional provider setup must not block launch if platform defaults are selected and allowed.
- MSG91 step must show fail-closed prerequisites.
- Every activation step must be auditable.

## 17. Testing/UAT checklist

Core regression:

- Existing production flows behave unchanged with all SaaS settings runtime flags disabled.
- Existing checkout, GST, wallet, refund, exchange, notification, payment, and shipment records render without reinterpretation.
- Legacy env behavior remains active until cutover.

Settings and revisions:

- Settings writes create audit events and revisions.
- Secret writes store encrypted values only.
- Masked metadata displays correctly.
- Rollback selects a previous approved revision without deleting audit history.
- Historical records keep original snapshots.

Razorpay:

- Invalid credentials fail verification.
- Valid test credentials verify but do not activate automatically.
- Production activation requires verified merchant credentials.
- Webhook verification uses the correct merchant context.
- No silent platform fallback occurs after merchant-owned activation.

Delhivery:

- Invalid token/pickup/origin fails verification.
- Serviceability checks use correct account context after activation.
- Shipment snapshots include pickup/origin and settings revision.
- Shipment creation fails closed if required verified settings are absent after cutover.

Communications:

- Platform defaults work when explicitly selected.
- Merchant-owned Resend/Twilio/WhatsApp require verification before activation.
- Fallback decisions are visible and audited.
- MSG91 cannot activate unless all approval statuses are `APPROVED`.

Install wizard:

- Required steps cannot be skipped for production activation.
- Optional provider setup can be skipped when platform defaults are explicitly selected.
- Wizard status matches underlying provider verification state.

Rollback/UAT:

- Domain flags can be disabled per shop.
- Legacy env resolver can be restored where allowed.
- Audit trail shows activation, suspension, rollback, and fallback decisions.

## 18. Rollback strategy

Rollback must be designed per domain and per shop.

Rollback levels:

1. UI rollback: hide or disable settings write screens while preserving data.
2. Verification rollback: stop provider verification jobs/actions.
3. Runtime rollback: disable DB runtime reads and return to legacy resolver where allowed.
4. Provider rollback: suspend active merchant provider and require manual review.
5. Full domain rollback: disable all flags for a settings domain.

Rules:

- Rollback must not delete settings, revisions, snapshots, or audit events.
- Rollback must not rewrite historical workflow records.
- Rollback to platform communications is allowed only if platform fallback was explicitly selected or approved.
- Rollback from merchant Razorpay/Delhivery after production activation should normally suspend new payment/shipment creation rather than silently using platform credentials.
- Any rollback that affects customer-visible behavior should create an audit event and operational alert.

## 19. Release criteria for SaaS Version 01

SaaS v1 is ready only when all of the following are true:

- Single-shop tenant model is implemented consistently and documented.
- Required settings domains are shop-scoped.
- Razorpay and Delhivery merchant-owned setup, verification, activation, and rollback flows are complete.
- Resend/Twilio/WhatsApp platform defaults and optional merchant-owned overrides are explicit and tested.
- MSG91 fails closed unless KYC, DLT, and template approvals are all `APPROVED`.
- Settings revisions and workflow snapshots exist for all settings-dependent runtime actions introduced in v1.
- No historical payments, shipments, invoices, refunds, wallet transactions, checkout intents, or notification records are reinterpreted using current settings.
- Feature flags support schema/write/verify/shadow/runtime/cutover phases independently.
- Secret encryption, masking, audit, and rotation behavior pass security review.
- Install wizard blocks production payment/shipment activation until mandatory providers are verified.
- UAT passes for legacy mode, shadow mode, cutover mode, and rollback mode.
- Operational runbooks exist for activation, provider failure, secret rotation, rollback, and merchant support.

## 20. Major risks and mitigations

| Risk | Mitigation |
| --- | --- |
| New settings tables accidentally change production behavior | Keep tables inert until runtime flags are enabled; require shadow mode before cutover. |
| Historical records are reinterpreted with current settings | Snapshot revision and values at action time; treat older records as legacy and use persisted facts only. |
| Merchant funds route through wrong Razorpay account | Require verified merchant-owned Razorpay before activation; disable silent platform fallback for production payments. |
| Shipments book under wrong Delhivery account or origin | Require verified merchant-owned Delhivery and snapshot pickup/origin/account context per shipment. |
| Communication fallback hides merchant provider failures | Make fallback explicit, audited, and visible in settings and notification logs. |
| MSG91 sends before compliance approvals | Fail closed unless KYC, DLT, and template approvals are all `APPROVED`. |
| Secret leakage through UI, logs, or JSON settings | Use encrypted secret store, masked metadata, log redaction, and no secret JSON blobs. |
| Credential rotation breaks webhooks or in-flight workflows | Support candidate verification, atomic promotion, old-secret overlap where required, and revision-aware webhook handling. |
| Install wizard completion is confused with production readiness | Separate wizard completion, verification, and explicit activation states. |
| Rollback accidentally causes silent fallback to platform payment/shipping providers | Payment/shipping rollback should suspend new actions unless platform fallback is explicitly approved for that domain. |
| Theme settings introduce unsafe HTML/CSS/script | Validate schema server-side, restrict tokens, sanitize copy, and avoid arbitrary script injection. |
| Multi-merchant assumptions leak before a Merchant aggregate exists | Keep v1 scoped to one shop per merchant; defer multi-shop organization concepts to a later architecture phase. |

## Validation note

This document is planning-only. It intentionally does not modify application code, Prisma schema, migrations, or runtime behavior. Future implementation must be separately approved phase by phase.
