# Fixed COD Advance Module

Fixed COD Advance is an isolated Partial COD payment module. When enabled, the module quotes and collects a fixed online advance through Razorpay and records the remaining COD balance for delivery collection.

## Data model

- `CodAdvanceSettings` stores per-shop enablement, fixed advance amount, optional min/max order thresholds, currency, and policy text.
- `CodAdvanceIntent` stores each checkout/cart payment intent, calculated advance amount, COD balance, Razorpay payment link fields, payment status, optional customer profile, and optional Shopify order link fields.
- `CodAdvanceStatus` values are `CREATED`, `PAYMENT_PENDING`, `ADVANCE_PAID`, `ORDER_LINKED`, `FAILED`, `EXPIRED`, and `CANCELLED`.

## Admin

Settings are available at `/admin/cod-advance` and persisted through:

- `GET /api/admin/cod-advance/settings`
- `POST /api/admin/cod-advance/settings`

Amounts entered in the admin UI are rupees and stored as paise.

## Customer/API flow

1. Quote eligibility with `GET /api/cod-advance/intents?orderAmountPaise=100000`.
2. Create an intent with `POST /api/cod-advance/intents` and `orderAmountPaise`.
3. Create or reuse the Razorpay payment link with `POST /api/cod-advance/intents/{id}/payment-link`.
4. Add these Shopify note attributes during checkout/order creation when the advance has been paid:
   - `megaska_cod_advance_intent_id`
   - `megaska_cod_advance_paid=true`

The intent calculation is always:

`codBalanceAmountPaise = orderAmountPaise - advanceAmountPaise`

The API rejects orders where the fixed advance is greater than the order amount.

## Razorpay

The module uses `services/cod-advance/razorpay.ts` and the existing Razorpay environment variables:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

The existing Razorpay webhook first checks exchange `RequestPayment` records. Only when none is found does it check `CodAdvanceIntent`, preserving exchange behavior.

## Shopify order linking

The orders/create webhook links a paid COD advance intent when both note attributes are present. This linking only updates the COD advance intent and writes logs/audit events; it does not interfere with order identity, wallet reservation, GST, refund, or exchange behavior.

## Audit events

The module writes these `AuditEvent.eventType` values:

- `cod_advance.settings.updated`
- `cod_advance.intent.created`
- `cod_advance.payment_link.created`
- `cod_advance.payment.paid`
- `cod_advance.intent.order_linked`
