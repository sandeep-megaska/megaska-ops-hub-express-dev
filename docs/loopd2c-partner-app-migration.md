# Moving LoopD2C to the BIGONBUY Technologies Partner app

LoopD2C was built as an app in the **MEGASKA store organization**, which can
only install on that organization's stores and can't be listed on the Shopify
App Store. The public app now lives in the **BIGONBUY Technologies Private
Limited** Partner organization:

| | Old app (store org) | New public app (Partner org) |
|---|---|---|
| Config | `shopify.app.toml` | `shopify.app.loopd2c.toml` |
| Client ID | `91b6af8eff2be76428980364cad07a57` | `e16e6f02914ab7a1c1814b1cdb28cfb0` |
| Handle (admin URL) | `megaska-ops-hub-express-dev` | `loopd2c` |
| Vercel project | production (`app.loopd2c.com`) | `loopd2c-partner` (`loopd2c-partner.vercel.app`) |
| Stores | Megaska (live), test store | Partner-org development stores only, until approved |

A public app can be installed only on development stores of its Partner
organization until Shopify approves it, so **Megaska stays on the old app until
approval**. Both projects use the same database: data is keyed by shop.

## Phase 1: review (now)

1. **Dev Dashboard (Partner org):** app created; choose **Public distribution**
   (Partner Dashboard → Apps → LoopD2C → Choose distribution); request
   **Protected customer data** (name, email, phone, address) and **Read all
   orders**; create a development store for reviewers.
2. **Vercel:** new project `loopd2c-partner` from this repository, branch `main`.
   Environment (Production):
   - Copy from the production project, same values: `DATABASE_URL`,
     `DIRECT_URL`, `SHOPIFY_TOKEN_ENCRYPTION_KEY` (must match, or stored tokens
     can't be read), `LOOPDESK_SESSION_SECRET`, `DATA_ENCRYPTION_KEY`/
     `GIFT_CARD_ENCRYPTION_KEY`/`TOKEN_ENCRYPTION_KEY` if set, email (Resend),
     OpenAI, Delhivery/Razorpay platform keys if any.
   - New: `SHOPIFY_API_KEY=e16e6f02914ab7a1c1814b1cdb28cfb0`,
     `SHOPIFY_API_SECRET=<new app client secret>`,
     `SHOPIFY_APP_HANDLE=loopd2c`,
     `APP_BASE_URL`, `SHOPIFY_APP_URL`, `NEXT_PUBLIC_APP_URL` =
     `https://loopd2c-partner.vercel.app`.
   - **Do not set** `CRON_SECRET` (cron routes then return 404, so the
     reviews, Delhivery tracking and checkout-recovery jobs don't run twice
     against the shared database) or `SHOPIFY_WEBHOOK_SECRET`.
3. **GitHub:** repository secret `SHOPIFY_SERVICE_ACCOUNT_TOKEN` = the new app's
   service account token (Dev Dashboard → LoopD2C → Settings → App CLI
   automation token → Manage → add service account, "App development").
4. **Deploy:** Actions → *Shopify app deploy* → config `shopify.app.loopd2c.toml`.
5. Install on the review store from the Dev Dashboard; test; submit for review.

## Phase 2: move Megaska (after approval)

1. Vercel production: `SHOPIFY_API_SECRET_PREVIOUS=<old secret>` (keeps values
   encrypted under the old secret readable), then `SHOPIFY_API_KEY`,
   `SHOPIFY_API_SECRET` = new app, `SHOPIFY_APP_HANDLE=loopd2c`; keep
   `CRON_SECRET`. Point `app.loopd2c.com` at the app (or move the domain to
   `loopd2c-partner` and give it `CRON_SECRET`), update the URLs in
   `shopify.app.loopd2c.toml` to `https://app.loopd2c.com` and deploy.
2. Uninstall the old app from Megaska. Its `app/uninstalled` and later
   `shop/redact` are signed with the old secret and are ignored (see
   `identifyShopifyWebhookSigner`), so they can't drop the new token or delete
   Megaska's data. Its payment customization and discounts are removed by
   Shopify with it.
3. Install the new app on Megaska (`/api/auth/install?shop=bigonbuy-fashions.myshopify.com`).
4. In the new app: save the prepaid offer / payment settings and Promotions
   (re-publishes `$app:loopd2c-express` / `$app:loopdesk-promotions` and
   re-creates the payment customization and discounts); in the theme editor,
   enable the LoopD2C app embed and blocks.
5. Check: OTP login, cart drawer, COD hidden for ineligible carts, prepaid
   discount, order-page GST Invoice link, an `orders/create` webhook arriving,
   reviews and tracking crons. Megaska's admin URL is then
   `…/apps/loopd2c`.
