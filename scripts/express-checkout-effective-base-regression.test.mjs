import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const intentRoute = readFileSync(new URL("../app/api/express/checkout/intents/route.ts", import.meta.url), "utf8");
const discountRoute = readFileSync(new URL("../app/api/express/checkout/intents/[id]/discount/route.ts", import.meta.url), "utf8");
const modal = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

assert.match(intentRoute, /function effectiveSubtotalFromHandoff\(cartSnapshot: unknown, body: Record<string, unknown>\) \{[\s\S]*validLoopDeskOfferPricing\(snapshot\?\.loopdeskOfferPricing\)[\s\S]*validLoopDeskOfferPricing\(body\.loopdeskOfferPricing\)[\s\S]*handoff \? handoff\.loopdeskOfferAdjustedTotalAmountPaise : null;/, "intent creation should derive the Express Checkout base from the drawer/bag handoff when present");
assert.match(intentRoute, /if \(effectiveSubtotalAmountPaise !== null\) \{[\s\S]*paiseValues\.subtotalAmountPaise = effectiveSubtotalAmountPaise;[\s\S]*\}/, "intent creation should persist the effective offer-adjusted base amount");
assert.match(intentRoute, /paiseValues\.totalAmountPaise = Math\.max\([\s\S]*paiseValues\.subtotalAmountPaise \+ paiseValues\.shippingAmountPaise \+ paiseValues\.codFeeAmountPaise - paiseValues\.discountAmountPaise/, "intent creation should recalculate payable from the coupon-aware intent pipeline without double-subtracting the drawer offer");

assert.match(discountRoute, /function couponBaseAmountPaise\(intent: \{ subtotalAmountPaise: number; cartSnapshot\?: Prisma\.JsonValue \| null \}\) \{[\s\S]*validLoopDeskOfferPricing\(snapshot\?\.loopdeskOfferPricing\)[\s\S]*handoff \? handoff\.loopdeskOfferAdjustedTotalAmountPaise : intent\.subtotalAmountPaise;/, "discount route should calculate coupons from the effective handoff base when present");
assert.match(discountRoute, /code === "MEGA15"[\s\S]*Math\.round\(input\.subtotalAmountPaise \* 0\.15\)/, "MEGA15 should remain a backend-calculated 15% coupon instead of trusting a zero client amount");
assert.match(discountRoute, /subtotalAmountPaise: couponBaseAmountPaise\(editable\.intent\),[\s\S]*discountAmountPaise: calculatedDiscount\.discountAmountPaise,[\s\S]*totalAmountPaise/, "applying a coupon should persist the effective base, non-zero discount, and final payable together");
assert.match(discountRoute, /couponBaseAmountPaise\(intent\) \+ intent\.shippingAmountPaise \+ intent\.codFeeAmountPaise - discountAmountPaise/, "discount removal and recalculation should use the same effective base amount");

assert.match(modal, /expressDisplaySubtotalPaise\(intent\)[\s\S]*loopdeskOfferBaseSubtotalAmountPaise/, "order summary should show the raw Shopify subtotal while the intent subtotal remains the effective coupon base");
assert.match(modal, /expressPromotionSummary\(intent\)[\s\S]*LoopDesk offer discount/, "order summary should show the LoopDesk offer separately from coupon discounts");
assert.match(modal, /discountSummary\(intent\)[\s\S]*intent\.discountAmountPaise/, "order summary should show coupon discounts from the coupon-aware intent state");

console.log("Express Checkout effective coupon base regression checks passed");
