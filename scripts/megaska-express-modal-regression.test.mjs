import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

assert.match(source, /const cart = await readCart\(\);[\s\S]*const snapshot = cartSnapshot\(cart\);[\s\S]*state\.intent = Object\.assign\(\{\}, state\.intent \|\| \{\}, \{ cartSnapshot: snapshot/, "express checkout should render from the freshly fetched Shopify /cart.js snapshot before creating the intent");
assert.match(source, /state\.intent = Object\.assign\(\{\}, data\.intent \|\| \{\}, \{[\s\S]*cartSnapshot: Array\.isArray\(data\.intent\?\.cartSnapshot\?\.items\) && data\.intent\.cartSnapshot\.items\.length \? data\.intent\.cartSnapshot : snapshot/, "express checkout should preserve the live Shopify cart snapshot when the intent response has no reliable cart items");
assert.match(source, /function expressPromotionViewModel\(\) \{[\s\S]*const cart = state\.intent\?\.cartSnapshot \|\| \{\};[\s\S]*helper\.buildPromotionViewModel\(\{ cart, rules, currency:/, "express promotion VM should receive the same cart snapshot used by the rendered order summary");
assert.match(source, /key: item\?\.key \|\| "",[\s\S]*items, lineItems/, "express cart snapshot should keep Shopify line keys while preserving raw cart.js items");
assert.match(source, /cartItemCount: Array\.isArray\(cart\?\.items\) \? cart\.items\.length : 0,[\s\S]*rulesCount: rules\.length,[\s\S]*hasPromotion:/, "express promotion VM diagnostics should report cart item count, rules count, and promotion status when debug is enabled");

assert.match(source, /function expressPromotionDiscountPaise\(\) \{[\s\S]*promotionDiscountTotal[\s\S]*function expressBasePayablePaise\(\) \{[\s\S]*state\.intent\?\.totalAmountPaise[\s\S]*function expressFinalPayablePaise\(\) \{[\s\S]*expressBasePayablePaise\(\) - expressPromotionDiscountPaise\(\)/, "express checkout should expose one promotion-aware final payable resolver based on base intent total minus Promotion View Model promotionDiscountTotal");
assert.equal((source.match(/function expressFinalPayablePaise\(/g) || []).length, 1, "express checkout should define exactly one promotion-aware final payable resolver");
assert.match(source, /function remainingBasePayablePaise\(\) \{ return Math\.max\(0, expressFinalPayablePaise\(\) - storeCreditAppliedPaise\(\)\); \}/, "store credit remaining payable should start from the promotion-aware final payable");
assert.match(source, /function payableAmount\(method\) \{[\s\S]*remainingBasePayablePaise\(\)[\s\S]*\}/, "payment amount resolver should use the promotion-aware remaining payable");
assert.match(source, /Total Payable<\/span><strong>\$\{totalAmount\}<\/strong>/, "footer Total Payable should render the promotion-aware totalAmount value");
assert.match(source, /const totalLabel = state\.hydration\.intent !== "ready" \? "Calculating\.\.\." : money\(payableAmount\(method\.backendMethod\), state\.intent\?\.currency\)/, "payment method amount labels should use the payable amount resolver");
assert.match(source, /razorpay-order`, \{ method: "POST", body: \{ amountPaise: payableAmount\("PREPAID"\), promotionDiscountPaise: expressPromotionDiscountPaise\(\) \} \}\)/, "Razorpay order payload should use the promotion-aware payable resolver");
assert.match(source, /const basePayload = \{ order_id: checkout\.razorpayOrderId, amount: payableAmount\("PREPAID"\)/, "inline Razorpay payment payload should use the promotion-aware payable resolver");
assert.match(source, /\/order`, \{ method: "POST", body: \{ amountPaise: payableAmount\(paymentMethod\), promotionDiscountPaise: expressPromotionDiscountPaise\(\) \} \}\)/, "COD/order payload should use the promotion-aware payable resolver");
assert.doesNotMatch(source, /Total payable is unchanged|Estimated offer discount shown for transparency|until checkout enforcement\/payment integration is enabled/, "outdated estimated-only offer copy should be absent");

console.log("Megaska express modal promotion cart regression checks passed");
