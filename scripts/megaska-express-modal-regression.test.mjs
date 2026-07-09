import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

assert.match(source, /const cart = await readCart\(\);[\s\S]*const snapshot = cartSnapshot\(cart\);[\s\S]*state\.intent = Object\.assign\(\{\}, state\.intent \|\| \{\}, \{ cartSnapshot: snapshot/, "express checkout should render from the freshly fetched Shopify /cart.js snapshot before creating the intent");
assert.match(source, /state\.intent = preserveLoopDeskOfferPricingOnIntent\(Object\.assign\(\{\}, data\.intent \|\| \{\}, \{[\s\S]*cartSnapshot: Array\.isArray\(data\.intent\?\.cartSnapshot\?\.items\) && data\.intent\.cartSnapshot\.items\.length \? data\.intent\.cartSnapshot : snapshot/, "express checkout should preserve the live Shopify cart snapshot when the intent response has no reliable cart items");
assert.match(source, /function expressPromotionViewModel\(\) \{[\s\S]*const cart = state\.intent\?\.cartSnapshot \|\| \{\};[\s\S]*helper\.buildPromotionViewModel\(\{ cart, rules, currency:/, "express promotion VM should receive the same cart snapshot used by the rendered order summary");
assert.match(source, /key: item\?\.key \|\| "",[\s\S]*items, lineItems/, "express cart snapshot should keep Shopify line keys while preserving raw cart.js items");
assert.match(source, /cartItemCount: Array\.isArray\(cart\?\.items\) \? cart\.items\.length : 0,[\s\S]*rulesCount: rules\.length,[\s\S]*hasPromotion:/, "express promotion VM diagnostics should report cart item count, rules count, and promotion status when debug is enabled");

assert.match(source, /function validLoopDeskOfferPricing\(value\) \{[\s\S]*loopdeskOfferDiscountAmountPaise:[\s\S]*loopdeskOfferAdjustedTotalAmountPaise:[\s\S]*loopdeskOfferBaseSubtotalAmountPaise:/, "express checkout should validate and normalize the drawer offer handoff payload");
assert.match(source, /const loopdeskOfferPricing = validLoopDeskOfferPricing\(state\.loopdeskOfferPricing\);[\s\S]*\.\.\.\(loopdeskOfferPricing \? \{ loopdeskOfferPricing \} : \{\}\)/, "express checkout cart snapshot should preserve the offer handoff payload");
assert.match(source, /function expressBaseSubtotalPaise\(snapshot, cart\) \{[\s\S]*return handoff \? handoff\.loopdeskOfferAdjustedTotalAmountPaise : cartSubtotalPaise\(cart\);[\s\S]*\}/, "express checkout should use the offer-adjusted total as the base subtotal when valid");
assert.match(source, /const baseSubtotalAmountPaise = expressBaseSubtotalPaise\(snapshot, cart\);[\s\S]*subtotalAmountPaise: baseSubtotalAmountPaise,[\s\S]*totalAmountPaise: initialTotalAmountPaise/, "intent creation should receive the offer-adjusted base amount instead of the raw Shopify subtotal");
assert.match(source, /You saved \$\{money\(intent\.discountAmountPaise, intent\.currency\)\}/, "coupon success message should continue to display the coupon saved amount from the coupon-aware intent");
assert.match(source, /function remainingBasePayablePaise\(\) \{ return Math\.max\(0, Number\(state\.intent\?\.totalAmountPaise \|\| 0\) - storeCreditAppliedPaise\(\)\); \}/, "footer and payment labels should keep using the existing payable pipeline");
assert.doesNotMatch(source, /payableAmount[\s\S]*loopdeskOfferDiscountAmountPaise/, "payment method layer must not subtract the LoopDesk offer discount a second time");
assert.doesNotMatch(source, /Total payable is unchanged in Express Checkout until checkout enforcement\/payment integration is enabled/, "old misleading estimated-only Express Checkout text should be absent");

assert.match(source, /function preserveLoopDeskOfferPricingOnIntent\(nextIntent, fallbackIntent\) \{[\s\S]*fallbackIntent\?\.cartSnapshot\?\.loopdeskOfferPricing[\s\S]*state\.loopdeskOfferPricing[\s\S]*loopdeskOfferPricing: handoff/, "intent refresh and modal re-render should preserve LoopDesk drawer offer pricing when API payloads omit it");
assert.match(source, /function expressPromotionSummary\(intent\) \{[\s\S]*LoopDesk offer discount[\s\S]*discountSummary\(intent\)/, "order summary should include both LoopDesk offer and coupon discount rows");

console.log("Megaska express modal promotion cart regression checks passed");
