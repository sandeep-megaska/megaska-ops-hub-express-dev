import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");

assert.match(source, /const cart = await readCart\(\);[\s\S]*const snapshot = cartSnapshot\(cart\);[\s\S]*state\.intent = Object\.assign\(\{\}, state\.intent \|\| \{\}, \{ cartSnapshot: snapshot/, "express checkout should render from the freshly fetched Shopify /cart.js snapshot before creating the intent");
assert.match(source, /state\.intent = Object\.assign\(\{\}, data\.intent \|\| \{\}, \{[\s\S]*cartSnapshot: Array\.isArray\(data\.intent\?\.cartSnapshot\?\.items\) && data\.intent\.cartSnapshot\.items\.length \? data\.intent\.cartSnapshot : snapshot/, "express checkout should preserve the live Shopify cart snapshot when the intent response has no reliable cart items");
assert.match(source, /function expressPromotionViewModel\(\) \{[\s\S]*const cart = state\.intent\?\.cartSnapshot \|\| \{\};[\s\S]*helper\.buildPromotionViewModel\(\{ cart, rules, currency:/, "express promotion VM should receive the same cart snapshot used by the rendered order summary");
assert.match(source, /key: item\?\.key \|\| "",[\s\S]*items, lineItems/, "express cart snapshot should keep Shopify line keys while preserving raw cart.js items");
assert.match(source, /cartItemCount: Array\.isArray\(cart\?\.items\) \? cart\.items\.length : 0,[\s\S]*rulesCount: rules\.length,[\s\S]*hasPromotion:/, "express promotion VM diagnostics should report cart item count, rules count, and promotion status when debug is enabled");

console.log("Megaska express modal promotion cart regression checks passed");
