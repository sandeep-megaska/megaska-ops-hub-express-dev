import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../loopdesk-cart-drawer.js', import.meta.url), 'utf8');

assert.match(source, /promotionRules: \[\]/, 'drawer state includes promotion rules');
assert.match(source, /eligibleOffers: \[\]/, 'drawer state includes eligible offers');
assert.match(source, /function evaluateEligibleOffers/, 'deterministic eligibility helper exists');
assert.match(source, /isMarkedPromotionLine\(item\)\) return sum;/, 'marked offer lines are excluded from trigger quantity');
assert.match(source, /shopifyProductGid\(item\.product_id\)/, 'eligibility compares parent Shopify product GIDs');
assert.match(source, /cartSubtotalExcludingPromotions/, 'subtotal threshold helper excludes promotion lines');
assert.match(source, /v && v\.available/, 'unavailable variants are filtered out of default eligibility');
assert.match(source, /data-loopdesk-offer-variant/, 'variant selection is wired per offer card');
assert.match(source, /markedLineCount\(rule, state\.cart\) >= Number\(rule\.reward/, 'maximum promotional quantity is enforced');
assert.match(source, /"_loopdesk_promotion_rule_id": rule\.ruleId/, 'cart add request uses exact rule marker key');
assert.match(source, /"_loopdesk_promotion_compilation_version": String\(rule\.compilationVersion\)/, 'cart add request uses exact compilation marker key');
assert.match(source, /id: Number\(numericVariantId\(variant\.variantId\)\)/, 'cart add request uses selected numeric variant ID');
assert.match(source, /return fetchCart\(\);/, 'successful offer add refreshes the authoritative Shopify cart');
assert.match(source, /catch\(function \(error\).*state\.promotionError/s, 'failed add records promotion error without replacing cart');
assert.match(source, /renderLines\(cart\) \+ renderPromotionOffers\(cart\)/, 'offer card renders inside existing drawer body');

console.log('loopdesk promotion drawer wiring static checks passed');
