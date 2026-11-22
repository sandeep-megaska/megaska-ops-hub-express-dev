# Project status and decisions (LoopD2C, website, Chatji)

Last updated 22 Nov 2026. Keep this short; details live in the linked docs and PRs.

## Repositories
- `megaska-ops-hub-express-dev`: the LoopD2C Shopify app. Branches `main` (production)
  and `staging`; PRs go to both.
- `loopdesk-website`: loopd2c.com (Next.js). PRs to `main`.
- `chatji`: chatji.ai (WhatsApp assistant). PRs to `main` and `staging`.

## LoopD2C app
- **Two Shopify apps, one codebase.** Old store-specific app (client
  91b6af8eff2be76428980364cad07a57, `shopify.app.toml`) still serves Megaska
  (bigonbuy-fashions) from the production Vercel project and DB. Public app
  LoopD2C (client e16e6f02914ab7a1c1814b1cdb28cfb0, `shopify.app.loopd2c.toml`)
  runs on Vercel `loopd2c-partner` with the staging DB. Megaska moves after App
  Store approval: `docs/loopd2c-partner-app-migration.md`.
- **App Store:** submitted 21 Nov 2026; Shopify reviewers installed it on their
  review stores. Listing text: `docs/app-store-listing.md`. Screenshots:
  `docs/app-store-screenshots/`. Messages arrive at support@loopd2c.com.
- **No payments or refunds outside Shopify in the public app** (App Store 1.1.2 /
  1.1.15), switched by client ID in `services/platform/off-shopify-payments.ts`:
  - Reverse pickup charge and style price difference: Shopify draft-order invoice
    (`services/exchange/shopify-fee-invoice.ts`); `orders/paid` webhook marks it
    paid and books the Delhivery pickup. Megaska keeps Razorpay links.
  - No app wallet / gift-card store credit; no bank or UPI payout form (removed for
    both apps). Prepaid refunds: merchant in Shopify admin. COD refunds: merchant
    issues Shopify store credit or a gift card in Shopify admin.
  - Shopify store credit only works at checkout for customers signed in with
    Shopify's own customer accounts (LoopD2C OTP doesn't count).
  - Question to Shopify about app-issued gift cards for COD returns (send after
    review): `docs/shopify-support-cod-gift-card-question.md`.
- **Tokens:** expiring offline tokens with refresh (Shopify rejects non-expiring
  tokens). Admin/Storefront API 2026-04.
- **Reviews:** fixed 22 Nov: the eligibility API rejected Shopify app-proxy query
  fields, so no review could be submitted (Megaska had 62 requests, 0 reviews).

## Website (loopd2c.com)
- Copy matches the public app (no store credit, no Razorpay integration, pickup
  charge on Shopify Checkout).
- Signature design: Loop line, receipt edges, OTP tiles, parcel labels, marigold
  accent (`src/components/brand/`).

## Chatji
- Operated by **BIGONBUY Technologies Private Limited** (CIN
  U62099RJ2026PTC119310) on the website and legal pages.
- Meta: move the app to a new business portfolio verified for BIGONBUY
  Technologies (`chatji/docs/meta-entity-change.md`). Keep the Trading portfolio
  until the new one is approved. Remove `CHATJI_GSTIN` (Trading's GSTIN) in Vercel
  until Technologies' GST is issued.

## Open items
- Shopify App Store review: respond to reviewer emails.
- After approval: Megaska cutover; ask Shopify the COD gift-card question.
- WhatsApp template with the pickup-charge link (Meta approval needed).
- Chatji Meta portfolio move; GST registration for BIGONBUY Technologies.
- Before April 2027: Admin/Storefront API upgrade (2026-04 support ends 16 Apr 2027);
  cart.discountAllocations deprecation (Storefront 2026-07).
