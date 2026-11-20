# LoopD2C — Shopify App Store listing and reviewer instructions

Text to paste into Partner Dashboard → Apps → LoopD2C → Distribution → App
listing. Character limits are what the form showed when this was drafted; the
form's counter is the authority. Everything below describes what the app does
today. Keep it that way: no numbers, ratings or results we can't show.

Status: final. All open decisions and pre-submission fixes are done (see the
end). Values in angle brackets, like <your code>, are filled in only in the
submission form.

---

## 1. Basic app information

**App name** (30)
> LoopD2C

**App icon**: `loopd2c-app-icon-1200.png` (1200 × 1200, square, no rounded
corners; Shopify rounds them).

**Primary category**: Store design → Cart customization *(or the closest
"Cart" category offered)*
**Secondary category**: Orders and shipping → Returns and exchanges
Shopify also asks you to tick category features: tick only the ones LoopD2C
does.

**Languages**: English
**Works with**: Shopify Checkout, Shopify Functions, Delhivery, WhatsApp
(Meta Cloud API), Twilio / MSG91 (OTP)

---

## 2. App listing content

**App introduction** (100)
> OTP login, cart drawer, prepaid offers and GST invoices for Indian D2C stores on Shopify Checkout.

**App details** (500)
> LoopD2C brings the tools Indian D2C brands usually stitch together from several apps into one. Shoppers sign in with a one-time code on their phone, shop from a cart drawer with your offers, and complete every order on Shopify Checkout, where a prepaid discount and your COD rules apply through Shopify Functions. After the order, print GST invoices from the order page, ship and track with Delhivery, and let customers request exchanges, cancellations and returns from their own account page.

**Feature list** (up to 5, 80 each)
1. > Phone OTP login and optional verification before Shopify Checkout
2. > Cart drawer with cart offers, prepaid discount and COD rules via Functions
3. > GST invoices (A4/A5) printable from the Shopify order page
4. > Delhivery shipments, tracking, reverse pickups and exchanges
5. > Customer account page, reviews, store credit and WhatsApp updates

**Search terms** (up to 5)
> OTP login · COD · GST invoice · cart drawer · exchanges

---

## 3. Pricing

What the app charges today (`PricingPlan` in production):

| Plan | Price | Includes | Usage beyond the included amount |
|---|---|---|---|
| Professional | ₹2,899 every 30 days (US$29 for stores billed in USD) | All features, 1,000 OTP sends, 2,000 emails | ₹0.35 per OTP, ₹0.08 per email |

Listing text:
- **Plan name**: Professional
- **Price**: ₹2,899 / month
- **Features**: All LoopD2C features · 1,000 OTP sends and 2,000 emails each month included · Additional OTP ₹0.35, email ₹0.08
- **Free trial**: 14 days (first subscription only)
- **Additional charges**: "Usage charges for OTP and email beyond the included amounts, capped at ₹1,000 per 30 days (US$12 for stores billed in USD). WhatsApp messages are sent from your own WhatsApp Business account and billed to you by Meta."

The app charges exactly this (`services/billing/plans/plan-lifecycle.ts`:
`BILLING_TRIAL_DAYS`, `USAGE_CAP_PER_30_DAYS`).
The website pricing page (www.loopd2c.com/pricing) shows the same terms.

---

## 4. Media

- **Screenshots** (1600 × 900, 3–6, no browser chrome or personal data). Take
  them on `loopd2c-review` with test products:
  1. Cart drawer with a cart offer and the prepaid discount message
  2. OTP login on the storefront
  3. Shopify Checkout with the prepaid discount applied / COD hidden
  4. GST invoice opened from the order page (A5)
  5. Customer account page with an exchange request
  6. Admin: Prepaid offer & COD settings
- **Demo store**: `https://loopd2c-review.myshopify.com` (password:
  <storefront password>; Shopify asks for it in the submission form, not the listing).
- **Video** (optional for the listing, but the submission needs a screencast,
  see §6).

---

## 5. Support and legal

- **Support email**: support@loopd2c.com *(create the mailbox first)*
- **Website**: https://www.loopd2c.com
- **Privacy policy**: https://www.loopd2c.com/legal/privacy
- **Terms**: https://www.loopd2c.com/legal/terms
- **Developer**: BIGONBUY Technologies Private Limited, Jaipur, Rajasthan, India

---

## 6. Reviewer instructions (submission form → "Testing instructions")

> LoopD2C is built for Indian D2C stores: prices in INR, phone numbers +91, GST invoices and Delhivery shipping. Every order is placed and paid on Shopify Checkout; LoopD2C never takes payment itself.
>
> **Install**
> 1. Install LoopD2C. It opens in the Shopify admin (embedded) after the OAuth screen.
> 2. In Online Store → Themes → Customize → App embeds, turn on **LoopD2C OTP Embed** and save. Turn on "Enable LoopD2C cart drawer" and "Show Checkout button".
>
> **Logging in (OTP)**
> 3. On the storefront, click the account icon. Enter the test number **<REVIEW_OTP_PHONE without +91>** (country India) and, when asked for the code, **<REVIEW_OTP_CODE>**. This test number works on development stores only and sends no SMS. Any other Indian mobile number receives a real code.
>
> **Cart, prepaid discount and COD**
> 4. In the app, open **Prepaid offer & COD**, tick "Enable prepaid discount", set 10 %, and save. Saving publishes the discount function and the payment customization.
> 5. Add a product to the cart. The LoopD2C cart drawer opens and shows the prepaid offer. Click **Checkout**.
> 6. At Shopify Checkout, choose a card payment (Bogus Gateway: card 1) to see the prepaid discount applied. Choosing Cash on Delivery removes the discount; COD is hidden for carts your COD rules exclude.
>
> **Promotions**
> 7. In **Promotions**, create a cart offer (for example: subtotal ≥ ₹999 → selected product at ₹1). Add products to reach the threshold; the offer appears in the drawer and is applied at checkout.
>
> **GST invoice**
> 8. In **GST Settings**, enter a business name, address and GSTIN (any correctly formatted test GSTIN, e.g. 27AAAAA0000A1Z5). Open any order in the Shopify admin → **More actions → GST Invoice** to view and print it (A4 or A5).
>
> **Customer account, exchanges, reviews**
> 9. On the storefront, signed in with the test number, open the account page (add the "LoopD2C Dashboard" block to a page, or use the account icon): orders, exchange / cancellation requests and store credit are listed there. Exchange requests appear in the app under **Exchanges**.
> 10. **Reviews**: product reviews can be submitted from the product page block "LoopD2C Product Reviews" (add it in the theme editor on the product template) and moderated in the app.
>
> **Optional modules (need the merchant's own accounts, not required for review)**
> - Delhivery shipments, tracking and reverse pickups need a Delhivery API token.
> - WhatsApp notifications need the merchant's own WhatsApp Business account and approved templates.
>
> **Billing**: the Professional plan is charged through Shopify Billing. Development stores get test charges.
>
> **Uninstall**: removes the store's access token immediately; store data is deleted when Shopify sends `shop/redact` (48 hours later).

**Screencast** (required): 3–5 minutes on `loopd2c-review`, following the
steps above: install → embed → OTP login → cart drawer → checkout with
prepaid discount → GST invoice → account page. English narration or captions.

---

## Done before submission

- Usage billing: usage line capped at ₹1,000 / US$12 per 30 days, 14-day trial.
- Reviewer OTP: `REVIEW_OTP_PHONE` and `REVIEW_OTP_CODE` set on the Vercel
  project; keep them set after publication (requirement 4.5.5).
- Website: pricing page and WhatsApp checkout recovery match this listing.
- Platform: expiring offline tokens, `[network_access]` declaration, IP
  allowlist, Admin/Storefront API 2026-04, App Bridge first in `<head>`.
