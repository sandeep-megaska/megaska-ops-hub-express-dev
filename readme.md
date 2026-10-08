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

### COD order confirmation

`services/orders/whatsapp-cod-confirmation.ts`, switched on per shop
(Merchant Settings → WhatsApp → COD order confirmation). The 15-minute
checkout-recovery cron asks each new cash-on-delivery order (3 minutes to 6
hours old, unshipped, not cancelled) once, from the shop's own number, with a
**Utility** template (default `cod_order_confirmation`): body `{{1}}` first
name, `{{2}}` order number, `{{3}}` total; two Quick reply buttons, Confirm
order then Cancel order (payloads `codc:confirm|cancel:<order id>`). The
webhook handles the taps (only from a phone on that order): Confirm → tag
`cod-confirmed` + thank-you; Cancel → tag `cod-cancel-requested`, chat flagged
for the team, email; nothing is cancelled automatically. No reply in 12 hours →
tag `cod-no-response` (no second message). Events: AuditEvent
`WHATSAPP_COD_CONFIRMATION_SENT` / `_RESPONSE` on the order. Admin:
`/admin/whatsapp/cod`.

### Shipping updates

`services/orders/whatsapp-shipping-updates.ts`, switched on per shop
(Merchant Settings → WhatsApp → Shipping updates), run by the 15-minute
checkout-recovery cron, 8 am–9 pm IST only. Source: the courier tracking events
on the Shopify fulfillment (CONFIRMED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED).
Utility templates, fixed names: `order_shipped` ({{1}} name, {{2}} order,
{{3}} courier, {{4}} tracking link) on the first IN_TRANSIT;
`order_out_for_delivery` ({{1}}, {{2}}, {{3}} amount to pay, e.g. "₹1,195
(Cash on Delivery)" or "nothing, it's already paid"); `order_delivery_attempt_failed`
({{1}}, {{2}}) when OUT_FOR_DELIVERY is followed by IN_TRANSIT again (at most two
per order); `order_delivered` ({{1}}, {{2}}). One message per order per run, the
most advanced step wins; events older than 24 h (12 h for out for delivery) are
not announced. AuditEvent `WHATSAPP_SHIPPING_UPDATE_SENT` (step + key) per order.

### Back-in-stock alerts

`services/whatsapp/back-in-stock.ts`, switched on per shop (Merchant Settings →
WhatsApp → Back-in-stock alerts). The AI assistant sees each product's sold-out
sizes/colours; when a customer asks to be told (or agrees to the offer) it returns
`restock_request`, which is matched to the product/variant it was shown and saved
as a `BackInStockRequest` (unique per shop + phone + variant, or product|size|colour).
Unmatched requests become a SOFT handoff. The 15-minute cron checks waiting
requests with one `nodes(ids)` query per shop and sends the template
`back_in_stock` ({{1}} first name, {{2}} product and size/colour, {{3}} product
link opening the variant, with utm_source=whatsapp) once, 9 am–9 pm IST; opted-out
numbers are cancelled, requests expire after 60 days. Admin: WhatsApp → Back in stock
(who is waiting for what).

### Review requests on WhatsApp

`services/reviews/review-whatsapp.ts`, hooked into the automatic review-request
pipeline (`review-request-processor.ts`, hourly `review-requests` cron). Needs
Reviews → automatic requests on, plus Merchant Settings → WhatsApp → Review
requests on WhatsApp. A due, still-eligible request is sent as the template
`review_request` ({{1}} first name, {{2}} product (size), {{3}} review link with
the request token) to the customer's verified phone (or the order's phone), once
per order; other lines of that order, customers without a phone and opted-out
numbers fall back to email. Each send is a WHATSAPP `ProductReviewRequestDeliveryAttempt`,
so reviews from it are sourced REVIEW_REQUEST_WHATSAPP. The WhatsApp path has its
own toggle and is not gated by `REVIEW_REQUEST_DELIVERY_ENABLED` (that env var
still gates email).

### Second-order nudge

`services/orders/whatsapp-second-order.ts`, switched on per shop with a delay
(7–90 days after delivery, default 21) and the merchant's own offer line (required;
sent as written). 15-minute cron, 11 am–7 pm IST. Shopify orders delivered
delay…delay+7 days ago whose customer has exactly one order, not cancelled,
refunded or returned; skipped when the customer's chat is waiting on the team or
they opted out. Marketing template `second_order_nudge` ({{1}} first name, {{2}}
product bought, {{3}} store link with utm_medium=second_order, {{4}} offer line).
Once per customer: AuditEvent `WHATSAPP_SECOND_ORDER_NUDGE_SENT` on the Shopify customer.

### Shop in chat (WhatsApp catalog → Shopify cart)

`services/whatsapp/shop-in-chat.ts`, switched on per shop (Merchant Settings →
WhatsApp → Shop in chat); needs the Meta catalog connected to the WhatsApp
number with cart on. A cart sent with "Place order" arrives as an `order`
message (webhook routes it here, not to the AI). Catalog retailer ids are mapped
to Shopify variants (`shopify_<CC>_<product>_<variant>`, plain variant ids,
variant gids, else SKU lookup), checked for stock, and the customer gets one
free-form reply with the signed bag link (`/apps/loopd2c/checkout/bag`, token
from `createCodRecoveryToken`, checkout id `wa:<message id>`, needs
CHECKOUT_RECOVERY_SIGNING_SECRET). The bag opens with exactly those items and is
tagged with the cart attribute `loopd2c_source=whatsapp_cart`. Sold-out items are
named; unmatched carts become a SOFT handoff. AuditEvent `WHATSAPP_CART_LINK_SENT`.
The AI assistant may set `show_catalog` to send a `catalog_message` after its reply.

### Click-to-WhatsApp ads (attribution + Conversions API)

The webhook's `referral` on a message (first message after an ad tap) is stored
on the conversation (`adSourceId`, `adHeadline`, `adBody`, `adCtwaClid`,
`adReferredAt`; latest ad wins). The AI assistant is told about an ad clicked in
the last 3 days. `services/whatsapp/ad-attribution.ts`, called from the
orders/create webhook (after()): an order whose phone matches a chat with an ad
click in the 7 days before is recorded as AuditEvent `WHATSAPP_AD_ORDER` (shown
under WhatsApp → Ads, per ad: chats, orders, revenue). With Merchant Settings →
WhatsApp → Report WhatsApp ad sales to Meta, it is also sent as a Purchase to the
WABA's Meta dataset (`GET/POST /{waba}/dataset`, cached in `capiDatasetId`;
`POST /{dataset}/events`, action_source business_messaging, messaging_channel
whatsapp, user_data whatsapp_business_account_id + ctwa_clid). The token needs
`whatsapp_business_manage_events`.

### AI assistant (inbound chats)

LoopD2C → WhatsApp Inbox → **AI assistant** (`/admin/whatsapp/assistant`).
Modes per shop (`MerchantWhatsAppAccount.aiMode`): `OFF`, `DRAFT` (suggested
reply in the chat, a person sends it) and `AUTO` (answers on its own). It runs
after the webhook responds (`next/server` `after`), waits 4s so a burst of
messages gets one answer, shows WhatsApp's typing indicator, then asks OpenAI
(`OPENAI_API_KEY`; model `OPENAI_WHATSAPP_MODEL` → `OPENAI_MODEL` →
`gpt-4o-mini`) with facts read live from Shopify: matching products (price,
sizes in stock, link), the customer's last 3 orders by phone (status,
tracking), shop policies when `read_legal_policies` is granted, and the
merchant's store notes (`aiKnowledge`). Rules: only quote those facts, no
invented prices/offers/urgency, never ask for OTP/card/UPI details.
Complaints, refunds, exchanges, photos/voice notes, low confidence (< 0.6) or
AI failure: one holding message (AUTO), the chat is flagged "Needs your team"
and the team is emailed. Limits: 6 AI replies per chat per hour, 300 per shop
per day. A team reply clears the flag and pauses the assistant in that chat for
12 hours. In AUTO the "new chat" email is replaced by the handoff email.
Logic and prompt: `services/whatsapp/assistant/` (`policy.ts` is pure and
unit-tested).

### Exchange updates

Templates `exchange_approved`, `exchange_payment_received`,
`exchange_pickup_scheduled`, `exchange_pickup_completed`, `exchange_item_received`,
`exchange_replacement_processing`, `exchange_replacement_shipped`,
`exchange_completed`, `exchange_rejected` (override names with
`WHATSAPP_TEMPLATE_EXCHANGE_<STATUS>`), sent from the shop's own number when
exchange updates are switched on.

Never expose WhatsApp secrets as `NEXT_PUBLIC_*`.
