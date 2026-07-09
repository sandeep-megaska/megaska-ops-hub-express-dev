import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

assert.match(source, /const cart = await readCart\(\);[\s\S]*const snapshot = cartSnapshot\(cart\);[\s\S]*state\.intent = Object\.assign\(\{\}, state\.intent \|\| \{\}, \{ cartSnapshot: snapshot/, "express checkout should render from the freshly fetched Shopify /cart.js snapshot before creating the intent");
assert.match(source, /state\.intent = Object\.assign\(\{\}, data\.intent \|\| \{\}, \{[\s\S]*cartSnapshot: Array\.isArray\(data\.intent\?\.cartSnapshot\?\.items\) && data\.intent\.cartSnapshot\.items\.length \? data\.intent\.cartSnapshot : snapshot/, "express checkout should preserve the live Shopify cart snapshot when the intent response has no reliable cart items");
assert.match(source, /function expressPromotionViewModel\(\) \{[\s\S]*const cart = state\.intent\?\.cartSnapshot \|\| \{\};[\s\S]*helper\.buildPromotionViewModel\(\{ cart, rules, currency:/, "express promotion VM should receive the same cart snapshot used by the rendered order summary");
assert.match(source, /key: item\?\.key \|\| "",[\s\S]*items, lineItems/, "express cart snapshot should keep Shopify line keys while preserving raw cart.js items");
assert.match(source, /cartItemCount: Array\.isArray\(cart\?\.items\) \? cart\.items\.length : 0,[\s\S]*rulesCount: rules\.length,[\s\S]*hasPromotion:/, "express promotion VM diagnostics should report cart item count, rules count, and promotion status when debug is enabled");


assert.match(source, /function expressCartOfferDiscountPaise\(\) \{[\s\S]*expressPromotionViewModel\(\)\?\.totals[\s\S]*promotionDiscountTotal/, "expressCartOfferDiscountPaise should read promotionDiscountTotal from the Promotion View Model");
assert.match(source, /function expressCouponAwarePayablePaise\(\) \{[\s\S]*state\.intent\?\.totalAmountPaise/, "expressCouponAwarePayablePaise should read the existing coupon-aware intent totalAmountPaise source");
assert.match(source, /function expressFinalPayablePaise\(\) \{[\s\S]*expressCouponAwarePayablePaise\(\) - expressCartOfferDiscountPaise\(\)/, "expressFinalPayablePaise should subtract cart offer discount from coupon-aware payable");
assert.match(source, /<p><span>Subtotal<\/span><strong>\$\{priceHydrating \? "Calculating\.\.\." : money\(intent\.subtotalAmountPaise, intent\.currency\)\}<\/strong><\/p>\$\{discountSummary\(intent\)\}\$\{expressPromotionSummary\(intent\)\}/, "order summary should keep the existing coupon discountSummary line before the LoopDesk offer line");
assert.match(source, /LoopDesk offer discount/, "order summary should render the LoopDesk offer discount separately");
assert.match(source, /function remainingBasePayablePaise\(\) \{ return Math\.max\(0, expressFinalPayablePaise\(\) - storeCreditAppliedPaise\(\)\); \}/, "store credit base payable should use the final payable after cart offer discount");
assert.match(source, /<span>Total Payable<\/span><strong>\$\{totalAmount\}<\/strong>/, "footer Total Payable should use the shared totalAmount derived from payableAmount");
assert.match(source, /megaska-express-payment-amount">\$\{escapeHtml\(totalLabel\)\}<\/span>/, "payment method labels should use payableAmount labels");
assert.match(source, /razorpay-order`, \{ method: "POST", body: \{ amountPaise: remainingBasePayablePaise\(\) \} \}\)/, "Razorpay order creation should request the final remaining payable amount");
assert.match(source, /const checkout = Object\.assign\(\{\}, data\.checkout \|\| \{\}, \{ amountPaise: remainingBasePayablePaise\(\) \}\)/, "Razorpay inline checkout payload should use the final remaining payable amount");
assert.match(source, /\/order`, \{ method: "POST", body: \{ amountPaise: remainingBasePayablePaise\(\) \} \}\)/, "COD and order creation should use the final remaining payable amount");
assert.match(source, /state\.discountMessage = `\$\{String\(applied\.code \|\| code\)\.toUpperCase\(\)\} is already applied\.`/, "coupon success/already-applied message logic should remain present");
assert.doesNotMatch(source, /Estimated offer discount shown for transparency|Total payable is unchanged in Express Checkout|until checkout enforcement\/payment integration is enabled/, "old estimated-only cart offer copy should be absent");

console.log("Megaska express modal promotion cart regression checks passed");
