This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Billing catalog deployment

Commercial billing catalog records are platform-owned and are not created by Billing page requests. Deploy them explicitly after migrations and before the application:

```bash
npx prisma migrate deploy
npm run billing:seed-catalog
npm run billing:verify-catalog
# deploy application
```

The catalog seed is idempotent and is configured in `prisma.config.ts` for explicit Prisma seed operations. Do not add catalog seeding to Vercel builds.

## OTP provider environment variables

Set these server-side variables in Vercel/Next.js runtime:

- `OTP_PROVIDER` (optional): `twilio`, `msg91`, or `mock`

Twilio config (required when using Twilio):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

MSG91 config (required when using MSG91):
- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`

Provider selection behavior:
- If `OTP_PROVIDER` is explicitly set and configured, that provider is used.
- If `OTP_PROVIDER` is explicitly set but missing required config, the API logs a warning and falls back.
- If `OTP_PROVIDER` is not set, fallback order is: `twilio` -> `msg91` -> `mock`.

Never expose OTP provider secrets as `NEXT_PUBLIC_*`.

## WhatsApp (Meta WhatsApp Cloud API)

Which number sends what (`services/whatsapp/sender.ts`):

| Message | Shop with its own number | Shop without one |
|---|---|---|
| Login code (OTP) | the shop's number | the LoopD2C platform number |
| Abandoned-checkout reminders | the shop's number | not sent |
| Exchange updates | the shop's number | not sent |

The platform number only ever sends authentication (OTP) messages, so no store's
marketing or order updates go out under LoopD2C's name or another store's.
There is no global fallback: every send names its sender.

### A shop's own number

Merchant Settings → **WhatsApp** (stored in `MerchantWhatsAppAccount`, token
encrypted with `TOKEN_ENCRYPTION_KEY`): phone number ID, WhatsApp Business
Account ID, permanent system-user token, template language, and toggles for
OTP, abandoned-checkout reminders and exchange updates. **Save & check
connection** makes a read-only Graph call and shows the number's name and
quality rating. Own-number OTP is metered as `MERCHANT_WHATSAPP` (not billed).

### LoopD2C platform number (OTP for shops without their own number)

- `WHATSAPP_OTP_ENABLED` — must be `true`
- `WHATSAPP_OTP_ACCESS_TOKEN` — system-user token with `whatsapp_business_messaging`
- `WHATSAPP_OTP_PHONE_NUMBER_ID`
- `WHATSAPP_OTP_TEMPLATE_NAME` (optional; defaults to `loopd2c_login_otp`)
- `WHATSAPP_OTP_TEMPLATE_LANGUAGE` (optional; defaults to `en`)
- `WHATSAPP_OTP_COUNTRY_PREFIXES` (optional; comma-separated, defaults to `+91`; applies to every sender)
- `WHATSAPP_OTP_GRAPH_VERSION` (optional; defaults to `v20.0`)

Metered as `PLATFORM_WHATSAPP`.

### OTP behaviour

WhatsApp first (authentication template, no DLT), Twilio SMS fallback when the
send fails; shoppers can tap "Get code by SMS" after 30s. The code is generated,
hashed and verified by us (4 digits, 5-minute expiry, 5 attempts, 25s resend
cooldown, 5 sends per 15 minutes per number). Template: category
**Authentication**, code delivery **Copy code** button.

### Webhook (opt-outs)

`https://<app-host>/api/webhooks/whatsapp`, subscribed to `messages`.
- `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN` — answers Meta's verification challenge
- `WHATSAPP_META_APP_SECRET` — Meta app secret(s), comma-separated when numbers
  live in different apps; verifies `X-Hub-Signature-256`. Without it every POST
  is rejected.
- `WHATSAPP_META_GRAPH_VERSION` (optional; defaults to `v20.0`)

STOP / "Stop promotions" record an opt-out for the business number that
received it (AuditEvent `whatsapp.opt_out`, `<phone_number_id>:<customer>`), so
a STOP to one store does not stop another; START opts back in.

### Abandoned-checkout reminders (native Shopify Checkout)

`services/checkout-recovery/whatsapp-checkout-recovery.ts`, run by the 15-minute
checkout-recovery cron for shops whose own number has reminders switched on.
Reads Shopify abandoned checkouts whose phone was verified by the OTP gate
(`megaska_verified_phone`) and sends **at most two messages per checkout**: the
first once it has been idle 15 minutes (15–30 minutes after the shopper left;
skipped if it cannot go out within 6 hours) and a reminder 24 hours after the
first if they still have not ordered (dropped after 30 hours). A phone gets at
most two reminders from a shop in any 7 days. Opted-out numbers are skipped.
Needs `CHECKOUT_RECOVERY_SIGNING_SECRET` (32+ chars, shared with the COD email).

Both templates need one URL button
`https://<store-domain>/apps/loopd2c/checkout/bag?t={{1}}`; only the token is
sent. The link rebuilds the bag and opens the drawer with Pay online and COD.

`WHATSAPP_INTENT_RECOVERY_ENABLED` — legacy recovery for LoopD2C express-checkout
intents (in-drawer checkout modal); off unless `true`, own number only.

### Exchange updates

Templates `exchange_approved`, `exchange_payment_received`,
`exchange_pickup_scheduled`, `exchange_pickup_completed`, `exchange_item_received`,
`exchange_replacement_processing`, `exchange_replacement_shipped`,
`exchange_completed`, `exchange_rejected` (override names with
`WHATSAPP_TEMPLATE_EXCHANGE_<STATUS>`), sent from the shop's own number when
exchange updates are switched on.

Never expose WhatsApp secrets as `NEXT_PUBLIC_*`.
