# LoopDesk dev environment commissioning (CONFIG-INFRA-1)

This checklist commissions the cloned `megaska-ops-hub-express-dev` deployment as a real Shopify app environment. `DATABASE_URL` is required, but it is not enough: embedded admin modules also need Shopify app credentials, an installed active `Shop` row, and a valid shop/session context.

## Required environment checklist

### Core required

| Vercel env var                                  | Value for this dev app                           | Where to get it                                                                  |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `SHOPIFY_APP_URL`                               | `https://megaska-ops-hub-express-dev.vercel.app` | Vercel deployment domain; must match the Shopify Partner Dashboard App URL.      |
| `APP_BASE_URL`                                  | `https://megaska-ops-hub-express-dev.vercel.app` | Same Vercel deployment domain; used by internal notification/deep-link helpers.  |
| `NEXT_PUBLIC_APP_URL`                           | `https://megaska-ops-hub-express-dev.vercel.app` | Same Vercel deployment domain; build-time public URL for browser/PDF references. |
| `ADMIN_OPS_KEY` or `INTERNAL_DIAGNOSTIC_SECRET` | Strong random secret                             | Generate in a password manager. Required to access production diagnostics.       |

### Shopify required

| Vercel env var              | Value/source                                                                                                                                                                                                                                                                                                                                                                                            | Where to get it                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHOPIFY_API_KEY`           | Shopify app client ID/API key                                                                                                                                                                                                                                                                                                                                                                           | Shopify Partner Dashboard → Apps → `megaska-ops-hub-express-dev` → Client credentials. Must match `client_id` in `shopify.app.megaska-ops-hub-express-dev.toml`. |
| `SHOPIFY_API_SECRET`        | Shopify app client secret/API secret                                                                                                                                                                                                                                                                                                                                                                    | Shopify Partner Dashboard → app client credentials. Required for OAuth HMAC validation and token encryption fallback.                                            |
| `SHOPIFY_SCOPES`            | `customer_read_draft_orders,read_all_orders,read_app_proxy,read_customers,read_discounts,read_draft_orders,read_orders,read_products,unauthenticated_read_checkouts,unauthenticated_read_metaobjects,unauthenticated_read_product_listings,unauthenticated_write_checkouts,write_app_proxy,write_customers,write_discounts,write_draft_orders,write_metaobject_definitions,write_orders,write_products` | Copy from `[access_scopes].scopes` in `shopify.app.megaska-ops-hub-express-dev.toml`.                                                                            |
| `SHOPIFY_STORE_DOMAIN`      | `megaskastore.myshopify.com` for the current dev store                                                                                                                                                                                                                                                                                                                                                  | Shopify admin store URL. Used as a default/fallback shop domain in server-side helpers.                                                                          |
| `SHOPIFY_WEBHOOK_SECRET`    | Shopify webhook signing secret, if different from API secret                                                                                                                                                                                                                                                                                                                                            | Shopify Partner Dashboard webhook settings. If absent, webhook code falls back to `SHOPIFY_API_SECRET`.                                                          |
| `SHOPIFY_APP_PROXY_PREFIX`  | `apps`                                                                                                                                                                                                                                                                                                                                                                                                  | Shopify Partner Dashboard → App proxy. Mirrors `[app_proxy].prefix`.                                                                                             |
| `SHOPIFY_APP_PROXY_SUBPATH` | `megaska`                                                                                                                                                                                                                                                                                                                                                                                               | Shopify Partner Dashboard → App proxy. Mirrors `[app_proxy].subpath`.                                                                                            |

### Database required

| Vercel env var                                           | Value/source                                             | Where to get it                                                                                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                           | PostgreSQL connection string for the cloned dev database | Vercel Postgres/Neon/Supabase/Railway dashboard for this dev deployment. Must point at the database that receives the OAuth callback write.                                                            |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` or `TOKEN_ENCRYPTION_KEY` | Stable encryption key                                    | Existing secret store/password manager. Keep stable across deploys so encrypted Shopify tokens remain decryptable. If absent, code can derive from `SHOPIFY_API_SECRET`, but a dedicated key is safer. |

### Optional feature-specific

Only configure these when testing the related module; they are not required to commission embedded merchant settings and runtime config.

- OTP/SMS: `OTP_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`.
- Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- Logistics: `DELHIVERY_API_TOKEN`, `DELHIVERY_ORIGIN_PIN`, `DELHIVERY_PINCODE_URL`, `DELHIVERY_TAT_URL`.
- Notifications: `RESEND_API_KEY`, `OPS_NOTIFICATION_FROM_EMAIL`, `OPS_NOTIFICATION_TO_EMAIL`, `ADMIN_ALERT_EMAIL`, `CUSTOMER_NOTIFICATION_FROM_EMAIL`.
- Refund/store-credit security: `SESSION_SECRET`, `REFUND_PAYOUT_ENCRYPTION_KEY`.
- Express checkout safety gates: `EXPRESS_CHECKOUT_ENABLED`, `EXPRESS_CHECKOUT_ALLOWED_SHOPS`.
- WhatsApp: `WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_BUSINESS_ACCOUNT_ID`, `WHATSAPP_META_GRAPH_VERSION`, `WHATSAPP_META_PHONE_NUMBER_ID`, `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`.

### Diagnostics/internal

- `ADMIN_OPS_KEY`: accepted as `x-admin-ops-key` header or `ops_key` query parameter for production diagnostics.
- `INTERNAL_DIAGNOSTIC_SECRET`: accepted as `x-internal-diagnostic-secret` header or `diagnostic_secret` query parameter for production diagnostics.
- `SHOPIFY_ADMIN_DIAGNOSTIC_SECRET`: used by the internal admin-token diagnostic endpoint.
- `INTERNAL_CHECKOUT_RECOVERY_DISPATCH_SECRET`: used only by checkout recovery dispatch diagnostics.
- `VERCEL_ENV` and `NODE_ENV`: provided by Vercel/Next.js; surfaced by diagnostics as non-secret context.

## Shopify Partner Dashboard settings to verify

Use Shopify Partner Dashboard → Apps → `megaska-ops-hub-express-dev`.

- **App URL:** `https://megaska-ops-hub-express-dev.vercel.app`
- **Allowed redirection URL:** `https://megaska-ops-hub-express-dev.vercel.app/api/auth/callback`
- **Embedded app:** enabled.
- **App proxy:**
  - Prefix: `apps`
  - Subpath: `megaska`
  - Proxy URL: `https://megaska-ops-hub-express-dev.vercel.app/apps/megaska`
- **Admin API scopes:** exactly match `SHOPIFY_SCOPES` above and `shopify.app.megaska-ops-hub-express-dev.toml`.
- **Webhook API version:** `2026-04` in the Shopify app TOML; keep Partner Dashboard/CLI configuration aligned.

## Install/reinstall steps

1. Set all **Core required**, **Shopify required**, and **Database required** variables in Vercel for the correct environment.
2. Redeploy the Vercel project so server and `NEXT_PUBLIC_*` build-time values refresh.
3. Start OAuth for the dev store:
   - `https://megaska-ops-hub-express-dev.vercel.app/api/auth/install?shop=megaskastore.myshopify.com`
4. Approve the app in Shopify admin.
5. Confirm Shopify redirects to:
   - `https://megaska-ops-hub-express-dev.vercel.app/api/auth/callback`
6. The callback should exchange the OAuth code and create/update an active `Shop` row with `installationStatus = 'ACTIVE'`.
7. If the dev DB was cloned after a previous install, reinstall anyway so the app secret, token encryption key, scopes, and active `Shop` row are all aligned in the same database.

## DB verification steps

Run against the dev database after OAuth callback:

```sql
SELECT "id", "shopDomain", "myshopifyDomain", "isActive", "installedAt", "uninstalledAt", "installationStatus", ("accessToken" IS NOT NULL OR "accessTokenEncrypted" IS NOT NULL) AS "hasAdminToken"
FROM "Shop"
WHERE "shopDomain" = 'megaskastore.myshopify.com' OR "myshopifyDomain" = 'megaskastore.myshopify.com'
ORDER BY "updatedAt" DESC;
```

Expected result:

- At least one row exists.
- The newest/active row has `isActive = true`.
- `uninstalledAt IS NULL`.
- `installationStatus = 'ACTIVE'`.
- `hasAdminToken = true`.

Runtime config verification:

```sql
SELECT "id", "shopId", "moduleKey", "enabled", "updatedAt"
FROM "ShopModuleConfig"
WHERE "moduleKey" = 'loopdesk_runtime_config';
```

A runtime config row is created/updated when merchant settings are saved. If no row exists before settings are saved, storefront runtime config may still return defaults, but diagnostics will report the row as absent.

## Embedded admin verification steps

1. Open diagnostics with the shop query:
   - `https://megaska-ops-hub-express-dev.vercel.app/admin/diagnostics/environment?shop=megaskastore.myshopify.com`
   - In production, include `x-admin-ops-key: <ADMIN_OPS_KEY>` or `x-internal-diagnostic-secret: <INTERNAL_DIAGNOSTIC_SECRET>`.
2. Confirm presence booleans are `true` for `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SHOPIFY_SCOPES`, `SHOPIFY_STORE_DOMAIN`, `APP_BASE_URL`, and `NEXT_PUBLIC_APP_URL`.
3. Confirm `db.connectionOk = true`.
4. Confirm `shop.resolvedShop = "megaskastore.myshopify.com"` and `shop.installedActiveShopRowExists = true`.
5. Open merchant settings:
   - `https://megaska-ops-hub-express-dev.vercel.app/admin/merchant-settings?shop=megaskastore.myshopify.com`
6. If the page says `Shop not installed in this database. Reinstall the Shopify app to create the Shop record.`, run the install URL again for this deployment/database.

## Storefront/app proxy verification steps

- Confirm OAuth starts: `/api/auth/install?shop=megaskastore.myshopify.com` redirects to Shopify authorization.
- Confirm callback creates/updates `Shop`: `/api/auth/callback` runs after Shopify approval and logs `[SHOPIFY OAUTH CALLBACK] shop persisted` without exposing tokens.
- Confirm merchant settings load after install: `/admin/merchant-settings?shop=megaskastore.myshopify.com`.
- Confirm app proxy runtime config works from Shopify storefront context: `/apps/megaska/api/runtime/config`.
- Confirm direct runtime config works with explicit shop context: `/api/runtime/config?shop=megaskastore.myshopify.com`.
- Confirm the storefront drawer still loads and consumes runtime config. This phase does not change drawer behavior.

## Common failure symptoms and causes

| Symptom                                             | Likely cause                                                                                                         | Fix                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/api/auth/install?shop=...` returns `Invalid shop` | Missing or malformed `shop` query parameter                                                                          | Use the `.myshopify.com` domain, for example `megaskastore.myshopify.com`.                                  |
| Shopify rejects OAuth redirect                      | Partner Dashboard redirect URL does not exactly match `SHOPIFY_APP_URL + /api/auth/callback`                         | Update Partner Dashboard and Vercel env, then redeploy.                                                     |
| Callback returns `Invalid HMAC`                     | Wrong `SHOPIFY_API_SECRET`, missing secret, or callback from a different Shopify app                                 | Copy the client secret from the matching dev app and redeploy.                                              |
| Callback token exchange fails                       | Wrong `SHOPIFY_API_KEY`/secret pair or app URL mismatch                                                              | Verify app credentials in Partner Dashboard.                                                                |
| Merchant settings says unable to resolve shop       | Missing `shop` query/header, invalid domain, DB unavailable, missing active `Shop` row, or inactive/uninstalled shop | Check `/admin/diagnostics/environment?shop=...`, then reinstall if row is absent.                           |
| Diagnostics returns 403 in production               | Neither `ADMIN_OPS_KEY` nor `INTERNAL_DIAGNOSTIC_SECRET` is set, or the supplied header/query value does not match   | Set a diagnostic secret and pass it as a header.                                                            |
| Runtime config has defaults or reports no row       | `ShopModuleConfig` row for `loopdesk_runtime_config` has not been saved yet                                          | Open merchant settings after install and save settings.                                                     |
| App proxy path 404/does not reach app               | App proxy prefix/subpath/proxy URL mismatch in Partner Dashboard                                                     | Verify prefix `apps`, subpath `megaska`, URL `https://megaska-ops-hub-express-dev.vercel.app/apps/megaska`. |
| Storefront app proxy HMAC fails                     | Wrong `SHOPIFY_API_SECRET`/fallback secret or request not coming through Shopify app proxy                           | Verify secret and test through the storefront proxy path.                                                   |

## Post-env setup verification checklist

- `/api/auth/install?shop=megaskastore.myshopify.com` starts OAuth.
- `/api/auth/callback` creates or updates the active `Shop` row.
- `/admin/merchant-settings?shop=megaskastore.myshopify.com` loads settings after install.
- `/apps/megaska/api/runtime/config` works through the app proxy.
- Storefront drawer still works.
