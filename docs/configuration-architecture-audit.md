# CONFIG-1A — Configuration Architecture Audit

Date: 2026-07-04  
Scope: `sandeep-megaska/megaska-ops-hub-express-dev` application configuration sources.  
Phase constraints: audit only; no code, schema, migration, or runtime behavior changes.

## Ownership model used for classification

| Ownership model | Definition | Expected system of record |
| --- | --- | --- |
| Platform / deployment runtime | Secrets, infrastructure endpoints, runtime mode, internal operational gates, and provider credentials required before the app can boot or call external services. These are not merchant-editable. | Environment variables and deployment secret manager. |
| Installed shop / tenant identity | Per-shop install state, Shopify domains, access tokens, app proxy metadata, checkout enablement, and install lifecycle. | `Shop`, `ShopInstallationEvent`, `ShopProxyRoute`; env fallback only for bootstrap/dev compatibility. |
| Merchant-operational settings | Settings a merchant/admin should own per shop because they affect business policy, module availability, display copy, charges, GST profile, numbering, templates, or tax mappings. | Database tables or shop-scoped config records. |
| External platform authority | Data that should be read from Shopify, Razorpay, Delhivery, WhatsApp, email providers, or request signatures rather than duplicated as mutable app config. | External provider API/request/webhook payloads. |
| Derived runtime state / immutable snapshots | Values produced by user actions or workflows. They may include configuration values copied at the time of action for auditability, but should not be edited as source config. | Transactional workflow tables. |
| Application code constants | Stable product defaults, enums, lifecycle maps, safe fallback copy, and internal policy constants. If merchants need to alter them, they should be promoted to merchant-operational settings. | Source code constants. |
| Development / diagnostics only | Non-production bypasses, seed controls, debug routes, and diagnostics toggles. | Environment variables, restricted to non-production/internal access. |

## Executive summary

The app already has three configuration layers:

1. **Deployment environment variables** for database connectivity, provider credentials, secrets, diagnostics, and bootstrap fallbacks.
2. **Shop-scoped database records** for installed shop identity, module toggles, GST settings, COD advance settings, express checkout settings stored inside `ShopModuleConfig.config`, proxy routes, and install events.
3. **Workflow tables and snapshots** that persist values used during checkout, refunds, GST document generation, wallet activity, and logistics events.

Primary architecture risk is that several merchant/business-policy values still live in environment variables or hard-coded constants. Those should remain unchanged during this audit, but future phases should evaluate moving them into explicit shop-scoped merchant settings.

## Source inventory by ownership model

### 1. Platform / deployment runtime

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `services/db/prisma.ts`, `prisma.config.ts` | Prisma datasource / adapter connection string. | Platform / deployment runtime | Correct as env secret/infrastructure config. |
| `NODE_ENV` | DB client singleton, cookies, dev fallbacks, diagnostics, seed script | Controls production vs non-production behavior. | Platform / deployment runtime | Correct as env. |
| Shopify OAuth app credentials: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_API_SECRET_KEY`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES` | Auth routes, webhook/app-proxy validation, token encryption fallback, admin runtime checks | Required for OAuth install/callback, HMAC/webhook validation, and app URL construction. | Platform / deployment runtime | Correct as env secrets/config. Scopes are deployment/app-registration policy, not merchant settings. |
| Shopify webhook secrets: `SHOPIFY_WEBHOOK_SECRET`, fallbacks to API secret | Webhook routes | Validates Shopify webhook signatures. | Platform / deployment runtime | Correct as env secret. |
| Token encryption: `SHOPIFY_TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY`, fallback Shopify secrets | `services/shopify/token-crypto.ts` | Derives key material for stored token encryption/decryption. | Platform / deployment runtime | Correct as env secret. Avoid relying on fallbacks long-term. |
| Internal/admin operational gates: `ADMIN_OPS_KEY`, `INTERNAL_DIAGNOSTIC_SECRET`, `SHOPIFY_ADMIN_DIAGNOSTIC_SECRET`, `INTERNAL_CHECKOUT_RECOVERY_DISPATCH_SECRET` | Admin wallet/issue/internal routes | Restricts internal/admin operational APIs. | Platform / deployment runtime | Correct as env secrets; should not be merchant-owned. |
| Razorpay credentials: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Express checkout, COD advance, exchange Razorpay services | Creates/verifies Razorpay orders/payment links/webhooks. | Platform / deployment runtime by current app shape | Correct if one platform-level Razorpay account is used. If each merchant brings their own Razorpay account, move to encrypted shop-scoped credentials. |
| Delhivery credentials/endpoints: `DELHIVERY_API_TOKEN`, `DELHIVERY_BASE_URL`, endpoint path vars, pincode/TAT URLs | Logistics services and pincode route | Calls Delhivery APIs. | Platform / deployment runtime by current app shape | Correct for platform-level carrier integration. Warehouse/pickup details below are business/location config candidates. |
| OTP provider credentials and selector: `OTP_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | `services/auth/otp.ts` | Selects and authenticates OTP provider. | Platform / deployment runtime | Correct as env credentials/config. OTP template copy can be provider-side config. |
| WhatsApp Meta credentials: `WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`, `WHATSAPP_META_BUSINESS_ACCOUNT_ID`, `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_META_GRAPH_VERSION` | `services/whatsapp/meta-cloud-api.ts` | Sends/verifies WhatsApp provider calls. | Platform / deployment runtime | Correct as env secrets. Graph API version is runtime integration config. |
| Resend/email credentials and recipients: `RESEND_API_KEY`, `OPS_NOTIFICATION_FROM_EMAIL`, `CUSTOMER_NOTIFICATION_FROM_EMAIL`, `ADMIN_ALERT_EMAIL`, `OPS_NOTIFICATION_TO_EMAIL` | Notification services | Sends operational/customer email and routes ops alerts. | Platform / deployment runtime | Credentials correct as env. Sender/recipient policy may become shop-scoped if multi-merchant notification branding is required. |
| Public/base URLs: `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `VERCEL_URL` | Notifications and GST PDF service | Builds absolute links/assets. | Platform / deployment runtime | Correct as deployment config. |
| Refund payout encryption: `REFUND_PAYOUT_ENCRYPTION_KEY`, fallback `SESSION_SECRET` | Refund customer payout service | Encrypts sensitive payout details. | Platform / deployment runtime | Correct as env secret. Dev fallback should not be relied on in production. |

### 2. Installed shop / tenant identity

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| `Shop.shopDomain`, `myshopifyDomain`, `primaryDomain`, `shopName` | `Shop` model and Shopify shop services | Identifies the tenant/store. | Installed shop / tenant identity | Correct as database state sourced from Shopify install/admin APIs. |
| `Shop.accessToken`, `accessTokenEncrypted`, `storefrontAccessToken`, `storefrontTokenEncrypted`, `scopes`, token rotation fields | `Shop` model, token/admin/storefront services | Stores per-shop API tokens and install scopes. | Installed shop / tenant identity | Correct as DB secrets/state, ideally encrypted fields only. |
| `Shop.isActive`, `installedAt`, `uninstalledAt`, `installationStatus` | `Shop` model, install/uninstall routes | Tracks install lifecycle and active/inactive state. | Installed shop / tenant identity | Correct as DB lifecycle state sourced from OAuth/webhooks. |
| `Shop.appProxyPrefix`, `appProxySubpath`, `appProxyEnabled` | `Shop` model | Stores app proxy settings for installed shop. | Installed shop / tenant identity | Correct as DB install/config state. |
| `Shop.checkoutEnabled` | `Shop` model and auth callback | Enables checkout per shop after install. | Merchant-operational / installed shop setting | Correct to store per shop; future UI should make ownership explicit. |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN` | Shop resolution and storefront services | Bootstrap/default-shop fallback when DB install state is unavailable. | Development/bootstrap platform fallback only | Not correct as long-term multi-store source of truth; DB shop records should own runtime tenant identity. |
| `SHOPIFY_APP_PROXY_PREFIX`, `SHOPIFY_APP_PROXY_SUBPATH` | Auth callback app-proxy enablement check | Determines whether app proxy should be considered enabled at install. | Platform app registration config | Correct as deployment/app-registration config; per-shop effective state belongs in `Shop`/`ShopProxyRoute`. |
| `ShopInstallationEvent` | Prisma model | Records install lifecycle events. | Installed shop / tenant identity audit log | Correct as derived audit/event state, not editable config. |
| `ShopProxyRoute` | Prisma model | Per-shop proxy route mapping to target modules. | Installed shop / tenant routing config | Correct as database config; should remain shop-scoped. |

### 3. Merchant-operational settings

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| `ShopModuleConfig.enabled` and `moduleKey` | `ShopModuleConfig`, app proxy module routes | Enables/disables modules such as dashboard, exchanges, cancellations, GST, issues, and express checkout settings. | Merchant-operational settings | Correct as shop-scoped DB config. |
| `ShopModuleConfig.config` for `express_checkout_settings` | `services/express-checkout/settings.ts`, admin settings route/form | Stores COD fee and customer-facing COD information text. | Merchant-operational settings | Correct as shop-scoped config, though a typed model may be clearer later. |
| Express checkout default COD fee/text constants | `services/express-checkout/settings.ts`, component defaults | Fallback when no shop config exists. | Application code constants as defaults | Correct as defaults only; source of truth should be DB once saved. |
| `CodAdvanceSettings` | Prisma model and COD advance admin APIs | Fixed COD advance enablement, amount, currency, order thresholds, policy text. | Merchant-operational settings | Correct as shop-scoped DB settings. |
| `GstSettings` | Prisma model and GST admin/settings flow | GST legal/trade name, GSTIN, PAN, state code, prefixes, numbering strategy, currency, tax-inclusion, e-invoice enablement, active status. | Merchant-operational settings | Correct as DB settings. GSTIN is unique globally in schema; multi-registration/multi-shop implications should be reviewed in future phases. |
| `GstCounter` | Prisma model | Last GST document number by settings/document type/financial year. | Derived operational state | Not merchant-editable config, but governed by GST numbering settings. Correct as DB state. |
| `GstInvoiceTemplate` | Prisma model and GST template page | Header/footer/declaration/notes/logo/theme/version/default status. | Merchant-operational settings | Correct as DB settings/assets. |
| `GstHsnCode`, `GstTaxSlab`, `GstHsnSlabMap` | Prisma model | HSN master data and tax slabs/effective mappings. | Merchant-operational or statutory master data | Correct as DB master data. Ownership should be explicit: centrally maintained statutory catalogue vs merchant-maintained. |
| `GstProductTaxMap`, `GstSkuTaxMap` | Prisma model and GST product mapping flows | Shop/product/variant/SKU/style-to-HSN/tax mapping. | Merchant-operational settings | Correct as shop-scoped DB mapping config. |
| `REVERSE_PICKUP_GST_RATE`, `REVERSE_PICKUP_PRICE_INCLUDES_GST`, `MEGASKA_SHOP_STATE` | `services/exchange/invoice.ts` | Controls GST split for exchange reverse-pickup payment invoice. | Merchant-operational/tax settings candidate | Currently env. Future phases should consider deriving from `GstSettings`/tax tables or shop-scoped exchange logistics settings. |
| Exchange eligibility constants: excluded category keywords, clearance keywords, allowed-days window | `services/exchange/constants.ts`, eligibility service | Determines exchange eligibility. | Merchant-operational policy candidate | Currently code constants. If merchants need policy control, move to shop-scoped settings. |
| Delhivery warehouse/pickup details: `DELHIVERY_PICKUP_LOCATION_NAME`, `DELHIVERY_WAREHOUSE_*`, `DELHIVERY_PICKUP_*`, `DELHIVERY_ORIGIN_PIN` | Forward/reverse shipment and pincode services | Supplies origin/warehouse/pickup values for logistics payloads. | Merchant-operational / fulfillment-location settings candidate | Currently env. For multi-store, should be shop/location-scoped DB config unless one platform warehouse is guaranteed. |
| Notification branding/from addresses/customer email sender | Notification services | Determines sender identity and customer links. | Mixed: platform runtime today; merchant-operational if branded per shop | Currently env. Future multi-merchant branding may require shop-scoped notification settings. |

### 4. External platform authority

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| Shopify request shop domain | `shop`/`shopify_shop` query params, referer, `x-shopify-shop-domain` header | Resolves tenant for embedded/admin/app-proxy flows. | External platform/request authority | Correct to read from request, then validate against DB shop state. |
| Shopify OAuth code/HMAC/state | Auth install/callback routes | Installs app and exchanges code for tokens. | External platform authority | Correct. Runtime secret validates authenticity. |
| Shopify webhooks | Orders/create and app/uninstalled webhook routes | Update app workflow and install state. | External platform authority | Correct. Payloads are event facts, not config. |
| Shopify Admin/Storefront API data | Shopify service modules, dashboard/GST/order flows | Customer/order/product/cart data and shop metadata. | External platform authority | Correct. Snapshot data should be persisted only where audit/workflow needs it. |
| Razorpay order/payment/link/webhook payloads | Razorpay services and routes | Payment state, payment IDs, signature verification. | External platform authority | Correct. Credentials stay runtime config; payment facts are workflow state. |
| Delhivery shipment/tracking/pincode API responses | Logistics services/routes | Carrier availability and tracking state. | External platform authority | Correct. Tracking events are derived workflow state. |
| WhatsApp/Resend provider API responses | Notification services | Delivery or send outcomes. | External platform authority | Correct. Any persisted outcome should be event/audit state. |

### 5. Derived runtime state / immutable snapshots

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| `ExpressCheckoutIntent` monetary fields, cart snapshot, selected payment method, status, expiry | Prisma model and express checkout routes | Captures checkout state and copied settings such as COD fee at selection time. | Derived runtime state / immutable snapshot | Correct. Do not treat as editable config after intent creation. |
| `ExpressCheckoutAddressSnapshot`, `ExpressCheckoutDiscount`, `ExpressCheckoutPayment`, `ExpressCheckoutOrderLink` | Prisma models/services | Checkout address, discounts, payments, and Shopify order link. | Derived runtime state | Correct. |
| `CodAdvanceIntent` | Prisma model/services | Stores COD advance calculation, Razorpay link/payment, Shopify order link. | Derived runtime state | Correct; settings source is `CodAdvanceSettings`. |
| `WalletAccount`, `WalletTransaction`, `WalletReservation` | Prisma models/services | Store-credit balance, ledger, reservation state. | Derived financial state | Correct. Not configuration. |
| `RefundRequest`, `RefundPayoutDetails`, `RefundPayout`, `RefundEvent` | Prisma models/services | Refund workflow state and encrypted payout details. | Derived workflow/financial state | Correct. Encryption secret is platform config. |
| `GstDocument`, `GstDocumentLine`, `GstParty`, `GstOrderImport`, `GstOrderImportLine`, `GstExport`, `GstReportRun`, `GstReconciliationRun`, `GstAuditLog`, `GstLegacyDocument` | Prisma GST models/services | Generated/imported GST documents, order snapshots, reports, reconciliation/audit. | Derived statutory/workflow state | Correct. Source configuration is `GstSettings`, tax maps, and templates. |
| `MegaskaOrder`, `OrderShipment`, `OrderShipmentEvent` | Prisma OMS/logistics models | Local order/shipment/tracking state. | Derived workflow state | Correct. Carrier credentials and warehouse config are separate. |
| `CustomerProfile`, `OTPChallenge`, `AuthSession` | Prisma auth/customer models | Customer identity, verification challenge, sessions. | Derived identity/session state | Correct. OTP provider config is env. |
| `AuditEvent` and module-specific events/logs | Prisma model/services | Audit trail of admin/system/customer actions. | Derived audit state | Correct. |

### 6. Application code constants and defaults

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| Module route keys such as `dashboard`, `exchanges`, `cancellations`, `gst`, `issues` | App proxy route files | Identifies module to gate with `ShopModuleConfig`. | Application code constants | Correct as stable module identifiers. |
| Express checkout state order / legacy equivalents | Payment-method route and state-machine helpers | Guards workflow transitions. | Application code constants | Correct. |
| Indian state code map | Express checkout order route | Normalizes state values for Shopify order creation. | Application code constants / statutory reference | Acceptable as code constant; may become shared reference data if reused widely. |
| Delhivery status map | Logistics adapter | Maps carrier statuses to local order statuses. | Application code constants | Correct. |
| Default express checkout COD fee/text | Express checkout settings service/UI | Fallback before merchant saves config. | Application code defaults | Acceptable only as fallback. |
| Default reverse pickup GST values | Exchange invoice service | Fallback GST rate/tax inclusion/shop state. | Merchant-operational candidate | See merchant settings section; currently code/env hybrid. |

### 7. Development / diagnostics only

| Source | Current location(s) | Current behavior | Correct owner | Notes / future consideration |
| --- | --- | --- | --- | --- |
| `EXPRESS_CHECKOUT_ENABLED`, `EXPRESS_CHECKOUT_ALLOWED_SHOPS` | App-proxy/shop fallback and safety helpers | Enables non-production/dev storefront fallback and checkout safety checks. | Development/diagnostics gate today; merchant setting candidate for production enablement | Current production fallback is blocked in some resolvers. Long-term production enablement should be shop-scoped DB (`Shop.checkoutEnabled` / module config). |
| `STORE_CREDIT_DIAGNOSTICS` | Express checkout store-credit service | Emits diagnostics outside production or when enabled. | Development / diagnostics only | Correct as env diagnostics toggle. |
| `ALLOW_MOCK_TRACKING_SEED`, `ORDER_NAMES` | Dev seed script | Allows mock tracking seed outside production. | Development only | Correct as env/script inputs. |
| Debug route secret inputs | Debug/internal routes | Protects debugging actions. | Development/internal diagnostics | Correct only if inaccessible without secret and disabled/controlled in production. |

## Cross-cutting findings

### Correctly placed today

- Provider credentials, encryption keys, database URLs, webhook secrets, internal diagnostics secrets, and runtime mode are correctly environment-owned.
- Installed shop identity and lifecycle are mostly database-owned through `Shop` and related install/proxy tables.
- GST core settings, GST templates, GST tax/product/SKU mappings, COD advance settings, and express checkout merchant settings are database-owned and shop-scoped.
- Checkout, payment, wallet, refund, GST document, shipment, OTP, session, and audit records are workflow state/snapshots rather than configuration.

### Ambiguous or likely misplaced sources for future phases

- Reverse-pickup invoice GST rate, tax-inclusion flag, and shop state are environment variables but behave like shop/tax settings.
- Delhivery warehouse and pickup location values are environment variables but behave like fulfillment-location settings, especially in multi-store mode.
- Exchange eligibility keywords and day windows are code constants but may be merchant policy.
- Notification from/to addresses and customer-facing notification branding are environment variables but may need per-shop ownership.
- Platform-level Razorpay and Delhivery credentials are acceptable only if Megaska operates one shared provider account. Bring-your-own-provider scenarios require encrypted shop-scoped credentials.
- `SHOPIFY_STORE_DOMAIN` and token env variables are useful bootstrap fallbacks but should not be authoritative tenant config in a mature multi-store deployment.

## Recommended ownership target map

| Configuration family | Target owner | Priority for future remediation |
| --- | --- | --- |
| Secrets/infrastructure/provider credentials | Platform env / secret manager | Keep as-is unless provider accounts become merchant-owned. |
| Shopify shop identity/tokens/install state | `Shop` + install/proxy tables | Keep DB authoritative; reduce env fallback reliance. |
| Module enablement | `ShopModuleConfig` / typed shop module settings | Keep DB authoritative. |
| Express checkout COD fee/copy | Shop-scoped merchant settings | Already DB-backed via `ShopModuleConfig.config`; consider typed schema later. |
| Fixed COD advance settings | `CodAdvanceSettings` | Already correctly DB-backed. |
| GST legal profile/numbering/templates/tax maps | GST DB models | Already correctly DB-backed. |
| Exchange return window/category policy | Shop-scoped exchange settings | Future candidate; currently code constants. |
| Reverse-pickup GST and logistics pricing/tax treatment | Shop-scoped logistics/exchange settings or GST settings derivation | Future candidate; currently env/code. |
| Fulfillment warehouse/pickup origin | Shop/location-scoped DB settings | Future candidate if more than one warehouse/store. |
| Notifications branding/senders | Shop-scoped notification settings if merchant branded; platform env if centrally operated | Future candidate. |
| Diagnostics/dev fallbacks | Env, non-production/internal only | Keep isolated; ensure production cannot rely on them accidentally. |

## Audit-only conclusion

No production behavior changes were made. The current architecture is serviceable but mixed: core secrets and infrastructure are properly environment-owned, several merchant settings are already shop-scoped in the database, and workflow facts are stored as derived state. The most important future cleanup is to remove merchant/business-policy data from environment variables and source constants where it affects tax, fulfillment, exchange eligibility, or branded customer communication.
