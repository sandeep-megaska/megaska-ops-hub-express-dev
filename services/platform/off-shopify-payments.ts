// Payments and refunds that happen outside Shopify: Razorpay payment links for
// exchange fees, UPI / bank payouts for COD refunds, and store credit issued as
// app wallet credit or Shopify gift cards.
//
// Shopify App Store requirements 1.1.2 (use Shopify Checkout) and 1.1.15 (refund
// only through the original payment processor) don't allow these in a public app,
// so they are OFF for the public LoopD2C app and stay ON only for the original
// store-specific app until that store moves over. The client ID decides, so no
// deployment setting has to change; LOOPD2C_OFF_SHOPIFY_PAYMENTS=1/0 overrides it.
//
// No imports, so any module (server or test) can use it.

/** Client ID of the original store-specific LoopD2C app. Client IDs are public. */
const LEGACY_APP_CLIENT_IDS = new Set(["91b6af8eff2be76428980364cad07a57"]);

export const OFF_SHOPIFY_PAYMENTS_UNAVAILABLE =
  "Not available in LoopD2C: payments and refunds go through Shopify. Handle this order in the Shopify admin.";

export function offShopifyPaymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const override = String(env.LOOPD2C_OFF_SHOPIFY_PAYMENTS ?? "").trim();
  if (override === "1") return true;
  if (override === "0") return false;
  return LEGACY_APP_CLIENT_IDS.has(String(env.SHOPIFY_API_KEY ?? "").trim());
}

export class OffShopifyPaymentsDisabledError extends Error {
  constructor(message = OFF_SHOPIFY_PAYMENTS_UNAVAILABLE) {
    super(message);
    this.name = "OffShopifyPaymentsDisabledError";
  }
}

export function assertOffShopifyPaymentsEnabled() {
  if (!offShopifyPaymentsEnabled()) throw new OffShopifyPaymentsDisabledError();
}
