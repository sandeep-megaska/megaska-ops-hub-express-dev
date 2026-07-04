# CONFIG-1C — Merchant Settings Domain Architecture

Date: 2026-07-04  
Scope: target SaaS merchant settings domain architecture for Megaska Ops Hub.  
Status: architecture/documentation only; no application code, Prisma schema, migrations, or runtime behavior changes.

## Purpose and non-goals

This document defines the target merchant settings domain architecture for a SaaS version of Megaska Ops Hub after the CONFIG-1A configuration audit and CONFIG-1B SaaS ownership decision.

This document does **not** implement schema, migrations, services, routes, secrets, UI, or provider behavior. It is a planning artifact for future implementation phases.

## Locked integration ownership

| Integration | Target ownership | Required behavior |
| --- | --- | --- |
| Razorpay | Merchant-owned mandatory | Each merchant supplies and manages their own Razorpay account credentials. Platform credentials must not be used as the default production payment account for merchant funds. |
| Delhivery | Merchant-owned mandatory | Each merchant supplies and manages their own Delhivery account/token and fulfillment-origin settings. Platform carrier credentials must not be used as the default production carrier account. |
| Resend | Platform-owned by default; merchant-owned optional | Platform email sending is the default. Merchant-owned email sending may be enabled when domain/sender verification is complete. |
| Twilio | Platform-owned by default; merchant-owned optional | Platform Twilio can provide the default OTP/communication path. Merchant Twilio can override when enabled and validated. |
| WhatsApp | Platform-owned by default; merchant-owned optional | Platform WhatsApp sending can be default. Merchant WhatsApp Cloud API/WABA ownership is optional when onboarding and webhook validation are complete. |
| MSG91 | Optional merchant-owned OTP provider only | Supported as an optional merchant OTP provider, inactive unless merchant KYC, DLT, and template approvals are complete. Existing MSG91 code/provision is documented as currently unused/inactive. |

## Recommended domain model

The target model should separate tenant identity, typed domain settings, provider credentials, provider-derived state, and free-form display/config metadata.

### Core tenant and settings aggregate

| Concept | Recommended model | Notes |
| --- | --- | --- |
| Merchant/tenant | `Merchant` or existing shop-root tenant aggregate | Represents the commercial SaaS customer. A merchant may own one or more Shopify shops in the future. |
| Shop/store | Existing `Shop` aggregate | Stores Shopify install identity, domains, lifecycle, OAuth tokens, app proxy state, and shop-level enablement. |
| Settings revision/audit | `MerchantSettingsRevision` / `MerchantSettingsAuditEvent` | Records who changed settings, what changed, approval state transitions, provider activation changes, and rollback metadata. |
| Module settings index | Existing `ShopModuleConfig` or future typed module registry | Useful for generic module enablement and discoverability, but high-risk business rules should graduate to typed tables. |

### Provider credential and approval aggregates

| Domain | Recommended model | Purpose |
| --- | --- | --- |
| Razorpay | `MerchantRazorpaySettings` + encrypted credential fields | Mandatory merchant payment credentials, webhook secret, account activation state, test/live mode, verification metadata. |
| Delhivery | `MerchantDelhiverySettings` + `MerchantFulfillmentLocation` | Mandatory merchant carrier API credentials plus pickup/origin/warehouse configuration. |
| Email/Resend | `MerchantEmailSettings` | Optional merchant email provider override, sender/domain verification state, fallback-to-platform policy. |
| SMS/OTP | `MerchantOtpSettings` + provider-specific `MerchantTwilioSettings` and `MerchantMsg91Settings` | Selects active OTP provider according to approval and fallback rules. |
| WhatsApp | `MerchantWhatsAppSettings` | Optional merchant WhatsApp Cloud API/WABA details, phone number, template namespace/state, webhook validation state. |

### Business settings aggregates

| Domain | Recommended model | Purpose |
| --- | --- | --- |
| Branding/theme | `MerchantBrandingSettings` / `MerchantThemeSettings` | Logo, colors, typography tokens, storefront/admin display names, customer-facing copy. |
| GST | Existing/future `GstSettings`, GST templates, HSN/tax maps | Legal GST profile, numbering, template, tax mapping, statutory settings. |
| Checkout | `MerchantCheckoutSettings` and/or typed express-checkout settings | COD fee/copy, payment method availability, checkout safety rules, cart/order behavior. |
| Exchange/returns | `MerchantExchangeSettings` | Return/exchange windows, exclusions, pickup charge policy, customer-facing return copy. |
| Wallet/store credit | `MerchantWalletSettings` | Wallet feature enablement, expiry policy, refund-to-wallet defaults, ledger policy settings. |
| Notifications | `MerchantNotificationSettings` | Channel enablement, sender identity, fallback routing, template selection and throttling policy. |

## Typed tables vs JSON config

Use typed tables when correctness, validation, secrets, provider activation, money movement, tax compliance, or workflow branching depends on the setting. Use JSON only for low-risk, extensible presentation/config metadata with schema validation.

### Should be typed tables

| Settings family | Why typed |
| --- | --- |
| Razorpay credentials and activation | Mandatory merchant-owned payment credentials directly affect money movement, webhook verification, and settlement ownership. |
| Delhivery credentials and pickup/origin locations | Mandatory merchant-owned logistics settings affect shipment creation, billing, pickup, and customer delivery promises. |
| OTP provider selection and provider approval status | Security-sensitive authentication path; must enforce Twilio/MSG91 fallback and approval gates. |
| MSG91 KYC/DLT/template approval status | Must prevent activation unless status is `APPROVED`; typed state machine is safer than JSON flags. |
| WhatsApp provider credentials and template approval state | Credentials, webhook verification, and template availability require deterministic validation. |
| GST legal profile, numbering, counters, templates, tax slabs, HSN/product/SKU mappings | Statutory and audit-sensitive. |
| Checkout money settings | COD fee, COD advance, currency, thresholds, payment method eligibility, and order behavior should be typed. |
| Exchange/refund/wallet financial policy | Affects customer liabilities, ledger behavior, and refund rules. |
| Sender/domain verification | Email/notification sender validity affects deliverability, trust, and compliance. |

### May be JSON config with typed validation

| Settings family | Acceptable JSON usage |
| --- | --- |
| Theme tokens | Colors, spacing, radius, custom CSS-safe variables, typography presets. |
| Customer-facing copy blocks | Help text, banners, checkout explanatory copy, return policy snippets when not used for statutory numbering or money calculation. |
| Notification template metadata | Template labels, preview copy, optional channel-specific display hints; provider IDs and approval state should stay typed. |
| Feature-specific UI preferences | Dashboard display options, non-critical default filters, module UI preferences. |
| Experimental settings | Feature-flagged fields before promotion to stable typed columns, with strict schema versioning and audit logs. |

### JSON governance rules

- Every JSON settings blob should have a `schemaVersion`.
- JSON should be validated at write time against a server-owned schema.
- JSON should not contain raw secrets, provider tokens, webhook secrets, bank/payment details, GSTIN/PAN if they require special handling, or approval gates.
- JSON values used in immutable workflows should be copied into transaction snapshots at the time of action.

## Encryption requirements

### Must be encrypted at rest

| Field family | Examples |
| --- | --- |
| Provider API secrets | Razorpay key secret, Razorpay webhook secret, Delhivery API token, Resend API key, Twilio auth token, MSG91 auth key, WhatsApp access token, WhatsApp webhook verify token. |
| OAuth/access tokens | Shopify Admin/Storefront tokens and any future provider OAuth refresh/access tokens. |
| Payment/refund sensitive data | Payout account identifiers, UPI/bank details, customer refund payout details. |
| Webhook signing secrets | Provider webhook secrets and verification tokens. |
| Private sender credentials | SMTP credentials, if ever supported. |

### Should be protected, masked, and audited

| Field family | Examples |
| --- | --- |
| Provider public identifiers | Razorpay key ID, Twilio account SID, WhatsApp phone number ID, WABA ID, MSG91 sender ID. These may not need encryption but should be masked in UI and logged carefully. |
| Statutory identifiers | GSTIN and PAN. These are business identifiers but should be masked where practical and audited on changes. |
| Contact endpoints | Merchant notification emails, phone numbers, pickup contacts. Protect as business PII/contact data. |

### Encryption architecture expectations

- Use envelope encryption or a centralized application encryption service with key rotation support.
- Store only encrypted secret values plus metadata such as `last4`, `createdAt`, `updatedAt`, `verifiedAt`, and `rotatedAt`.
- Never expose decrypted secrets back to the browser after initial save.
- Provider verification should use decrypted values server-side only.
- Audit events should record that a secret changed, not the secret value.

## Merchant-editable settings

Merchant admins should be able to edit these settings, subject to role-based permissions, validation, and approval gates:

| Settings family | Merchant-editable fields |
| --- | --- |
| Razorpay | Key ID, key secret, webhook secret, mode, webhook setup status, activation request; active state only after verification. |
| Delhivery | API token, base/account mode if supported, pickup location name, warehouse/origin address, contact, pincode, shipment defaults. |
| Notifications | Channel enablement, sender display name, merchant-owned Resend/email credentials if enabled, templates/copy, fallback preference where allowed. |
| OTP | Preferred OTP provider among allowed providers, merchant Twilio credentials, merchant MSG91 credentials, MSG91 template IDs and sender IDs, activation requests. |
| WhatsApp | Merchant WABA/phone number IDs, access token, template selections, webhook verification inputs, activation requests. |
| Branding/theme | Logo, colors, typography/theme presets, customer-facing app name, checkout/customer portal copy. |
| GST | GST profile, legal/trade name, GSTIN/PAN, state, numbering prefixes, invoice template, HSN/tax mappings according to permissions. |
| Checkout | COD fee/copy, COD advance settings, payment method availability, checkout messaging, thresholds. |
| Exchange | Return/exchange window, exclusions, pickup charge/tax treatment, policy copy. |
| Wallet | Feature enablement, customer-visible policy, expiry/default refund preferences where legally and operationally allowed. |

## Platform-only settings

These should remain platform-owned and not merchant-editable:

| Settings family | Platform-only fields |
| --- | --- |
| Infrastructure | Database URL, deployment URLs, runtime mode, internal diagnostic secrets, app encryption keys. |
| Shopify app registration | Shopify API key/secret, app URL, OAuth scopes, webhook secret, app proxy registration policy. |
| Platform provider defaults | Platform Resend/Twilio/WhatsApp credentials, platform-owned sender domains, platform notification recipients. |
| Provider availability policy | Whether merchant-owned provider mode is available for a merchant, allowed countries/providers, feature flags, rollout gates. |
| Approval override policy | Manual approval/rejection powers, provider risk holds, KYC review status where platform review is required. |
| System templates | Required operational alert templates, security OTP constraints, non-editable legal/security copy. |
| Diagnostics and recovery | Internal checkout recovery dispatch secrets, debug toggles, mock/seed controls. |

## OAuth-derived and provider-derived settings

Some values should be read from OAuth/provider APIs and stored as derived state rather than manually edited.

| Source | Derived values | Mutability |
| --- | --- | --- |
| Shopify OAuth/Admin API | Shop domain, myshopify domain, primary domain, shop name, scopes, install/uninstall lifecycle, access tokens. | Not merchant-edited directly; updated from OAuth/admin sync. |
| Provider OAuth, if added later | Access token, refresh token, account ID, granted scopes, expiry. | Derived from OAuth and encrypted; merchant can disconnect/reconnect, not edit token text. |
| Razorpay verification | Account/key verification result, webhook verification status, last successful payment/webhook test. | System-derived after validation. |
| Delhivery verification | Token validity, serviceability check result, pickup location validation. | System-derived after API checks. |
| Resend/email verification | Domain/sender verification status, DNS status, bounce/suppression capability. | Provider-derived. |
| Twilio verification | Account/service validity, Verify service availability, sender/phone verification. | Provider-derived. |
| MSG91 approval | KYC status, DLT status, template approval status. | Provider/platform-review derived; must gate activation. |
| WhatsApp verification | WABA/phone number status, webhook challenge status, template approval state. | Provider-derived. |

## Razorpay settings architecture

Razorpay is **merchant-owned mandatory**.

### Recommended fields

| Field | Type | Editable | Encrypted | Notes |
| --- | --- | --- | --- | --- |
| `merchantId` / `shopId` | Relation | No | No | Scope credentials to merchant/shop. |
| `mode` | Enum: `TEST`, `LIVE` | Yes | No | Test/live isolation should be explicit. |
| `keyId` | String | Yes | Usually no; mask in UI | Public-ish identifier but sensitive operationally. |
| `keySecretEncrypted` | Secret | Yes on write only | Yes | Never display after save. |
| `webhookSecretEncrypted` | Secret | Yes on write only | Yes | Required for webhook verification. |
| `status` | Enum | Limited | No | Suggested: `NOT_CONFIGURED`, `PENDING_VERIFICATION`, `VERIFIED`, `ACTIVE`, `SUSPENDED`, `ERROR`. |
| `verifiedAt` / `lastVerifiedAt` | Timestamp | No | No | Set by verification job/action. |
| `activeFrom` / `disabledAt` | Timestamp | Platform/system | No | Controls runtime activation. |

### Rules

- Merchant Razorpay credentials must be present and verified before payment features that move merchant funds can be active.
- Webhook signature verification must use the merchant's scoped webhook secret.
- Payment/order/link records should snapshot the Razorpay credential/settings revision used at creation time.
- Platform Razorpay credentials, if retained for tests or internal operations, must not silently process production merchant payments.
- Rotation should support entering new credentials, verifying them, then atomically promoting them to active.

## Delhivery settings architecture

Delhivery is **merchant-owned mandatory**.

### Recommended fields

| Field | Type | Editable | Encrypted | Notes |
| --- | --- | --- | --- | --- |
| `apiTokenEncrypted` | Secret | Yes on write only | Yes | Required. |
| `accountMode` / `environment` | Enum | Yes/platform-gated | No | Sandbox/production if applicable. |
| `pickupLocationName` | String | Yes | No | Must match Delhivery account expectations. |
| `originAddress` | Structured address | Yes | No | Use typed address fields, not an unvalidated blob. |
| `originPin` | String | Yes | No | Validate serviceability. |
| `contactName` / `contactPhone` / `contactEmail` | Strings | Yes | Protect/mask | Business contact data. |
| `defaultPackageSettings` | Typed or JSON schema | Yes | No | Dimensions/weight defaults may be typed if used in billing calculations. |
| `status` | Enum | Limited | No | Suggested: `NOT_CONFIGURED`, `PENDING_VERIFICATION`, `VERIFIED`, `ACTIVE`, `SUSPENDED`, `ERROR`. |

### Rules

- Shipment creation must not use platform Delhivery credentials for a merchant-owned production shipment.
- Pickup/origin settings should be location-scoped if a merchant has multiple warehouses.
- Pincode/serviceability checks should use the active merchant Delhivery context where provider behavior depends on account.
- Shipment records should snapshot origin/pickup data and credential revision/account ID used at booking time.
- Existing environment-based warehouse/pickup values should be treated as legacy/platform bootstrap only until migrated.

## Notification settings architecture

Notifications include email, SMS, WhatsApp, customer-facing transactional messages, and internal operations alerts.

### Ownership model

| Area | Default owner | Merchant override |
| --- | --- | --- |
| Customer email via Resend | Platform | Optional merchant-owned verified sender/domain/API key. |
| Operational/internal alerts | Platform | Usually no; merchant recipients may be configurable for merchant-facing copies. |
| SMS/OTP | Platform Twilio by default | Optional merchant Twilio or MSG91 with gates. |
| WhatsApp notifications | Platform by default | Optional merchant WhatsApp Cloud API/WABA. |
| Template copy | Merchant for customer-facing copy; platform for security/legal/system copy | Merchant edits should be versioned and validated. |

### Recommended structure

- `MerchantNotificationSettings` should define channel enablement, fallback behavior, sender identity, and template policy.
- Provider credentials should live in provider-specific typed/encrypted tables, not inside notification JSON.
- Customer-facing templates should have versions, preview data, approval state where provider approval is required, and locale support if needed.
- Notification send events should snapshot template version, provider, sender, and recipient metadata for auditability.
- If a merchant-owned provider fails verification or becomes suspended, fallback to platform provider should be explicit and policy-driven, not accidental.

## OTP settings with Twilio and MSG91

OTP is an authentication/security domain and should be conservative.

### Allowed provider modes

| Mode | Description | Activation rule |
| --- | --- | --- |
| `PLATFORM_TWILIO` | Platform-owned Twilio Verify/default OTP provider. | Can be default when platform credentials are healthy. |
| `MERCHANT_TWILIO` | Merchant-owned Twilio account/Verify service. | Active only after credential and service verification. |
| `MERCHANT_MSG91` | Merchant-owned MSG91 OTP route. | Active only when credentials are valid and KYC, DLT, and template approval status are all `APPROVED`. |

### MSG91-specific rules

- MSG91 is supported only as an optional merchant-owned OTP provider.
- MSG91 must remain inactive unless merchant KYC, DLT registration, and OTP template approval are complete.
- MSG91 must not become active unless approval status is `APPROVED`.
- Partial states such as `PENDING`, `SUBMITTED`, `REJECTED`, `EXPIRED`, or `UNKNOWN` must block activation.
- Existing MSG91 code/provision should be documented as currently unused/inactive until the approval-gated merchant settings domain is implemented.
- Runtime provider selection should fail closed to an approved provider. It should not select MSG91 because credentials merely exist.

### Recommended OTP fields

| Field | Type | Notes |
| --- | --- | --- |
| `activeProvider` | Enum | Effective provider selected by system after validation. |
| `preferredProvider` | Enum | Merchant preference; not necessarily active. |
| `fallbackProvider` | Enum | Usually `PLATFORM_TWILIO`. |
| `twilioAccountSid` | String | Merchant Twilio identifier; mask in UI. |
| `twilioAuthTokenEncrypted` | Secret | Encrypted. |
| `twilioVerifyServiceSid` | String | Validate before activation. |
| `msg91AuthKeyEncrypted` | Secret | Encrypted. |
| `msg91SenderId` | String | DLT-linked sender ID. |
| `msg91TemplateId` | String | Must correspond to approved template. |
| `msg91KycStatus` | Enum | Must be `APPROVED`. |
| `msg91DltStatus` | Enum | Must be `APPROVED`. |
| `msg91TemplateStatus` | Enum | Must be `APPROVED`. |

## WhatsApp settings architecture

WhatsApp is platform-owned by default and merchant-owned optional.

### Recommended fields

| Field | Type | Editable | Encrypted | Notes |
| --- | --- | --- | --- | --- |
| `ownershipMode` | Enum: `PLATFORM`, `MERCHANT` | Merchant request/platform-gated | No | Controls provider source. |
| `wabaId` | String | Yes | No | Merchant WhatsApp Business Account ID. |
| `phoneNumberId` | String | Yes | No | Sender phone number identifier. |
| `accessTokenEncrypted` | Secret | Yes on write only | Yes | Cloud API access token. |
| `webhookVerifyTokenEncrypted` | Secret | Yes on write only | Yes | If merchant webhook flow is supported. |
| `graphApiVersion` | String | Platform/default | No | Prefer platform-controlled compatible version. |
| `templateStatus` | Typed related records | No/derived | No | Per-template approval and language state. |
| `status` | Enum | Limited | No | `NOT_CONFIGURED`, `PENDING_VERIFICATION`, `VERIFIED`, `ACTIVE`, `SUSPENDED`, `ERROR`. |

### Rules

- Platform WhatsApp credentials can remain the default for platform-managed communications.
- Merchant WhatsApp should only activate after token, phone number, WABA, webhook, and template checks pass.
- Template IDs/names used for sends should be typed and approval-aware, not free-form runtime strings.
- Send events should snapshot provider ownership mode and template version.

## Branding, GST, checkout, exchange, wallet, and theme settings

### Branding and theme

- Use typed top-level fields for identity: display name, support email, support phone, logo asset ID, favicon asset ID.
- Use JSON with schema validation for theme tokens: colors, typography, border radius, spacing, and optional module-specific display variants.
- Store uploaded assets as asset records with ownership, MIME type, dimensions, storage key, and audit metadata.
- Merchant-editable, with platform moderation hooks if public brand misuse is a concern.

### GST

- Keep GST legal profile, GSTIN/PAN, state code, numbering, invoice templates, tax slabs, HSN mappings, and product/SKU tax maps in typed tables.
- GST counters are derived operational state, not merchant-editable settings.
- Changes to GST legal identity and numbering should create immutable revisions and be audit logged.
- Generated GST documents should snapshot the settings revision used at generation time.

### Checkout

- Promote checkout money and policy settings to typed tables: COD fee, COD advance, currency, thresholds, payment method enablement, order creation behavior, and risk controls.
- Keep customer-facing explanatory copy as JSON or versioned template records with validation.
- Checkout intents/orders/payments must snapshot the relevant settings revision at creation/selection time.
- Razorpay dependency should point to active merchant Razorpay settings.

### Exchange and returns

- Use typed settings for exchange window, eligibility rules, pickup charge, reverse pickup GST treatment, and refund/exchange methods.
- Use JSON or versioned copy records for customer policy text and help messages.
- Exchange requests and reverse shipments should snapshot eligibility result, policy revision, pickup charge, and tax settings used.

### Wallet/store credit

- Use typed settings for wallet enablement, expiry policy, refund-to-wallet defaults, max balance if needed, reservation expiry, and customer communication rules.
- Wallet balances, ledger transactions, and reservations are derived financial state, not settings.
- Any wallet policy change should not mutate historical ledger meaning; snapshot policy where needed.

### Theme/UI module preferences

- JSON is acceptable for UI preferences that do not alter money movement, authentication, statutory output, provider credentials, or workflow eligibility.
- Schema versions and write-time validation are required.
- Promote JSON fields to typed columns when they become workflow-critical.

## Suggested future implementation phases

### Phase 1 — Domain design and schema plan

- Produce ERD and state machines for merchant provider settings.
- Define enums for provider ownership, verification, approval, and activation states.
- Define encryption service/key-management approach.
- Define settings revision/audit strategy.

### Phase 2 — Credential vault and provider verification foundation

- Implement encrypted secret storage and masking conventions.
- Add provider verification flows without switching runtime behavior.
- Add audit events for secret create/rotate/delete and verification results.

### Phase 3 — Merchant-owned Razorpay and Delhivery mandatory onboarding

- Add merchant Razorpay and Delhivery settings onboarding.
- Verify credentials and webhook/pickup/serviceability setup.
- Gate payment/shipment activation on verified merchant-owned settings.
- Snapshot settings revisions in payments and shipments.

### Phase 4 — Notification and OTP provider settings

- Add platform-default notification policy with optional merchant overrides.
- Add merchant Twilio settings and safe fallback to platform Twilio.
- Add MSG91 settings with KYC/DLT/template approval gates; keep inactive until all approvals are `APPROVED`.
- Document and retire or activate existing MSG91 code paths only after the new gates exist.

### Phase 5 — WhatsApp merchant ownership

- Add merchant WhatsApp onboarding, token verification, WABA/phone checks, webhook verification, and template approval tracking.
- Add explicit fallback and suspension behavior.

### Phase 6 — Business settings hardening

- Promote checkout, exchange, wallet, and logistics/tax settings from env/code/JSON into typed shop-scoped models where required.
- Add settings revisions to workflows and generated documents.
- Add merchant UI permissions and approval flows.

### Phase 7 — Migration and deprecation cleanup

- Remove production reliance on env fallbacks for merchant-owned integrations.
- Backfill settings revisions and provider states.
- Deprecate legacy config paths after parallel-run validation.

## Migration-risk warnings

- **Payment ownership risk:** Switching from platform Razorpay to merchant Razorpay changes settlement ownership, webhook routing, reconciliation, refund flows, and historical payment interpretation.
- **Webhook secret risk:** Webhook verification must be shop/provider scoped. A global webhook secret can incorrectly accept or reject merchant-specific events.
- **Shipment billing risk:** Switching Delhivery accounts affects rates, pickup locations, COD remittance, serviceability, and tracking behavior.
- **Historical snapshot risk:** Existing payment, shipment, invoice, refund, wallet, and checkout records may lack settings revision references. Do not reinterpret historical records using current settings.
- **Secret migration risk:** Moving env secrets into DB requires careful one-way encrypted import, masking, rotation, and rollback planning.
- **MSG91 activation risk:** Credentials alone are insufficient. Activating before KYC/DLT/template approval can break OTP delivery and violate telecom compliance expectations.
- **Fallback ambiguity risk:** Platform defaults must be explicit. Silent fallback from merchant-owned provider to platform provider can create billing, compliance, and customer trust issues.
- **GST/legal risk:** GST profile, numbering, tax maps, and templates are statutory. Migration must preserve document numbering, audit trails, and generated-document snapshots.
- **JSON drift risk:** Unversioned JSON settings can become untestable hidden schema. Every JSON config needs schema versioning, validation, and promotion criteria.
- **Multi-shop risk:** A future merchant with multiple Shopify shops may need merchant-level credentials with shop-level overrides. Schema design should avoid assuming exactly one shop per merchant forever.
- **Runtime behavior risk:** Implementation must be phased behind feature flags and verification gates. Do not change live payment, shipment, OTP, or notification routing merely by adding settings tables.
