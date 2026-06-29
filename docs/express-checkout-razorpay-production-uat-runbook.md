# EX-4.19.4 Razorpay Production UAT Checklist & Operational Runbook

Use this runbook for a controlled live Razorpay UAT on the production Shopify store. Keep Cash on Delivery (COD) available throughout UAT and avoid checkout runtime changes unless a production-blocking defect is found.

## 1. Pre-UAT environment checks

Complete every check before starting a prepaid transaction.

- **Razorpay live keys configured**: confirm production has live `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`; the key ID shown to the browser must be live mode, not `rzp_test_*`.
- **Shopify active shop token valid**: open the app admin for the production shop and confirm admin API calls succeed without re-authentication or access-token errors.
- **`write_draft_orders` scope present**: verify the installed app scopes include `write_draft_orders`, because prepaid finalization creates and completes a Shopify draft order.
- **App Proxy working**: from the production storefront, confirm `/apps/megaska/checkout` loads the Express Checkout shell and proxied API calls use `/apps/megaska/api`.
- **Active shop resolved to production**: confirm server logs and API responses identify the production shop domain; stop UAT if the active shop is missing, a DEV placeholder, or a non-production test shop.
- **COD baseline still working**: place one low-value COD order before prepaid UAT and verify Shopify order creation, customer-facing success state, and internal intent/order link records.
- **Operational observers ready**: keep production application logs, database access, Shopify Admin, and Razorpay Dashboard open with timestamps synchronized.

## 2. UAT test cases

Record the intent ID, cart token, customer phone/email, timestamp, and tester for every case.

| Case | Steps | Expected result |
| --- | --- | --- |
| PREPAID success | Start Express Checkout, choose PREPAID, pay through Razorpay live checkout, and wait for success. | Intent reaches a completed order state; Razorpay payment is captured/authorized as expected; Shopify order exists once; customer sees the created order reference. |
| Duplicate verification callback | After a successful payment, replay the same verify request from browser devtools or a controlled API client if safe. | The duplicate request must not create a second Shopify draft/order or second order link; response may be conflict/idempotent but data remains single-order. |
| Payment popup close/cancel | Choose PREPAID, open Razorpay, close the popup before payment. | Intent remains retryable and no Shopify draft/order is created; customer sees retry guidance; COD remains selectable. |
| Wrong signature rejection, if testable | In a controlled client/API replay, submit the real Razorpay order/payment IDs with an altered signature. | Verification fails with signature error; payment record is marked failed or retains safe state; no Shopify order is created. Do not run this if it risks confusing a real paid customer flow. |
| Expired intent block | Use an intent past `expiresAt` or force a staging-equivalent expired production test record approved by ops. | Razorpay order creation/verification is blocked with the checkout-session-expired message; no draft/order is created. |
| Retry existing Razorpay order | Start PREPAID to create a Razorpay order, close the popup, then click Pay Now again for the same intent. | Existing Razorpay order is reused when still valid; there is still only one payment row for the Razorpay order and no duplicate Shopify order. |
| COD regression | After prepaid tests, place another low-value COD order. | COD still creates exactly one Shopify order and remains unaffected by prepaid Razorpay paths. |

## 3. Data verification checklist

Verify these data points after each test in the database, logs, Shopify Admin, and Razorpay Dashboard:

- `ExpressCheckoutIntent.status`: expected terminal state is `ORDER_COMPLETED` for successful PREPAID/COD; cancellation, expiry, and failed-signature cases must not look completed.
- `ExpressCheckoutIntent.selectedPaymentMethod`: `PREPAID` for Razorpay tests and `COD` for COD baseline/regression.
- `ExpressCheckoutPayment.razorpayOrderId`: present for PREPAID order creation and matches Razorpay Dashboard.
- `ExpressCheckoutPayment.razorpayPaymentId`: present only after a successful Razorpay payment/verification and matches Razorpay Dashboard.
- `ExpressCheckoutOrderLink.draftOrderId` / `draftOrderName`: present when Shopify draft creation succeeds.
- `ExpressCheckoutOrderLink.shopifyOrderId` / `shopifyOrderName`: present exactly once after successful finalization and matches Shopify Admin.
- `completedAt`: if exposed by operational queries or dashboards, confirm it is set only after order completion; otherwise use order-link `createdAt` plus intent `updatedAt` as the completion timestamp proxy.
- `paymentSucceededAt`: if exposed by operational queries or dashboards, confirm it is set only after successful Razorpay verification; otherwise use the successful `ExpressCheckoutPayment.updatedAt` timestamp as the payment-success proxy.
- Logs: capture request IDs and entries for Razorpay order create, Razorpay verify, Shopify draft create/complete, state transitions, and any error `code`/`stage` values.

## 4. Failure handling

- **Razorpay success but Shopify finalization failed**
  - Treat as paid but not fulfilled. Do not ask the customer to pay again.
  - Capture Razorpay payment ID, Razorpay order ID, intent ID, customer contact, and error stage (`ORDER_FINALIZATION` / `SHOPIFY_FINALIZATION_FAILED`).
  - Manually create or complete the Shopify order only after confirming no existing `ExpressCheckoutOrderLink.shopifyOrderId` exists.
  - If manual recovery is impossible, refund or hold per finance policy and notify support.
- **Shopify draft created but payment failed**
  - Confirm no successful Razorpay payment exists for the intent before acting.
  - Leave the draft uncompleted or cancel/delete it according to Shopify ops policy.
  - Keep the customer on retry/COD path; do not mark the intent completed.
- **Webhook/callback mismatch**
  - Prefer verified callback/payment lookup data for customer-facing finalization.
  - Compare Razorpay Dashboard payment status with local `razorpayOrderId`, `razorpayPaymentId`, amount, currency, and signature-validation logs.
  - Escalate mismatches with raw event/request IDs; do not manually complete an order until amount and payment identity match.
- **Duplicate order prevention**
  - Before any manual recovery, search by intent ID, Razorpay order ID, Razorpay payment ID, draft order ID, and customer/cart timestamp.
  - Use the existing order link as the source of truth. Never create a second Shopify order for a paid intent that already has `shopifyOrderId`.

## 5. Rollback and safety controls

- Disable only the PREPAID/Razorpay option if prepaid UAT exposes a production issue; keep COD active whenever possible.
- Keep the Express Checkout and Shopify checkout available unless a critical issue creates duplicate orders, wrong amounts, or broad customer-impacting failures.
- If a hard stop is required, remove/hide the storefront entry point or disable the relevant module/config flag rather than changing runtime code during UAT.
- Announce rollback status to support, operations, and finance with the exact stop time, impacted intent/payment IDs, and customer-recovery owner.
- After rollback, run one COD smoke test and confirm no new Razorpay orders are being created from the storefront.

## Sign-off template

- Production shop domain:
- UAT window (UTC/IST):
- Razorpay key mode confirmed by:
- Shopify scope/token confirmed by:
- COD pre-check order:
- PREPAID success intent/payment/order:
- Negative test evidence links:
- COD regression order:
- Open issues / recovery owners:
- Go/no-go decision:
