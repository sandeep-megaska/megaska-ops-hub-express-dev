import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TRIGGER_VARIANT_GID = 'gid://shopify/ProductVariant/51396701061418';
const REWARD_PRODUCT_GID = 'gid://shopify/Product/9958145327402';
const REWARD_VARIANT_GID = 'gid://shopify/ProductVariant/50870717907242';

const rule = {
  id: 'config-4-4a-loopdesk-native-shopify-uat',
  enabled: true,
  status: 'active',
  display: { placement: 'drawer' },
  reward: { productGid: REWARD_PRODUCT_GID, variantGid: REWARD_VARIANT_GID, quantity: 1 },
  limits: { maxQuantityPerCart: 1 },
  eligibility: { triggers: [{ type: 'cart_contains_variant', variantGid: TRIGGER_VARIANT_GID }] }
};

const synchronizedConfig = { enabled: true, publication: { synchronized: true, activeAutomaticDiscount: true, productCapability: true } };
const unsynchronizedConfig = { enabled: true, publication: { synchronized: false, activeAutomaticDiscount: true, productCapability: true } };

function tail(value) { return String(value || '').split('/').pop(); }
function sameShopifyId(left, right) { return Boolean(left && right && (String(left) === String(right) || tail(left) === tail(right))); }
function cartContainsVariant(cart, variantGid) { return (cart.items || []).some((item) => sameShopifyId(item.variant_id, variantGid) || sameShopifyId(item.id, variantGid)); }
function rewardLine(cart, rewardVariantGid) { return (cart.items || []).find((item) => sameShopifyId(item.variant_id, rewardVariantGid) || sameShopifyId(item.id, rewardVariantGid)) || null; }
function discountAllocations(line) { return line?.line_level_discount_allocations || line?.discounts || line?.discount_allocations || []; }
function allocationAmount(allocation) { return Number(allocation?.amount || allocation?.value || allocation?.amountCents || allocation?.valueCents || 0) || 0; }
function shopifyDiscountObserved(line) {
  if (!line) return false;
  const original = Number(line.original_line_price);
  const finalPrice = Number(line.final_line_price);
  return (Number.isFinite(original) && Number.isFinite(finalPrice) && finalPrice < original) || discountAllocations(line).some((allocation) => allocationAmount(allocation) > 0);
}
function remainingQuantity(cart, testRule) {
  const max = Math.max(1, Number(testRule.limits?.maxQuantityPerCart) || 1);
  const existing = (cart.items || []).reduce((total, item) => total + (sameShopifyId(item.variant_id, testRule.reward.variantGid) ? Math.max(0, Number(item.quantity) || 0) : 0), 0);
  return Math.max(0, max - existing);
}
function isEligible(cart) { return cartContainsVariant(cart, TRIGGER_VARIANT_GID); }
function classify(cart, testRule = rule, config = synchronizedConfig, retrying = false) {
  const synchronized = Boolean(config.publication?.synchronized === true && config.publication?.activeAutomaticDiscount === true && config.publication?.productCapability !== false);
  if (!config.enabled || !testRule || testRule.enabled !== true || testRule.status !== 'active' || !testRule.reward?.variantGid || !synchronized) return 'unavailable';
  const line = rewardLine(cart, testRule.reward.variantGid);
  if (line && shopifyDiscountObserved(line)) return 'applied_by_shopify';
  const remaining = remainingQuantity(cart, testRule);
  if (line && remaining <= 0) return 'quantity_cap_reached';
  if (!line && remaining <= 0) return 'quantity_cap_reached';
  if (!isEligible(cart) && !line) return 'unavailable';
  if (!line) return 'eligible_not_added';
  return retrying ? 'added_pending_shopify' : 'added_without_discount';
}

const triggerLine = { key: 'trigger', variant_id: 51396701061418, quantity: 1, original_line_price: 1000, final_line_price: 1000 };
const rewardNoDiscount = { key: 'reward', variant_id: 50870717907242, quantity: 1, original_line_price: 500, final_line_price: 500 };
const rewardDiscounted = { key: 'reward', variant_id: 50870717907242, quantity: 1, original_line_price: 500, final_line_price: 200, line_level_discount_allocations: [{ title: 'LoopDesk', amount: 300 }] };

const fixtures = [
  ['qualifying item only', { items: [triggerLine] }, 'eligible_not_added'],
  ['reward added with no discount yet', { items: [triggerLine, rewardNoDiscount] }, 'added_without_discount', { ...rule, limits: { maxQuantityPerCart: 2 } }],
  ['reward line discounted by Shopify', { items: [triggerLine, rewardDiscounted] }, 'applied_by_shopify'],
  ['multiple discount allocations', { items: [triggerLine, { ...rewardNoDiscount, line_level_discount_allocations: [{ title: 'A', amount: 100 }, { title: 'B', amount: 200 }] }] }, 'applied_by_shopify'],
  ['quantity cap reached', { items: [triggerLine, rewardNoDiscount] }, 'quantity_cap_reached'],
  ['publication unsynchronized', { items: [triggerLine] }, 'unavailable', rule, unsynchronizedConfig],
  ['reward line removed', { items: [triggerLine] }, 'eligible_not_added'],
  ['reward variant mismatch', { items: [triggerLine, { ...rewardDiscounted, variant_id: 11111111111111 }] }, 'eligible_not_added']
];

for (const [name, cart, expected, testRule = rule, config = synchronizedConfig] of fixtures) {
  assert.equal(classify(cart, testRule, config), expected, name);
}
assert.equal(classify({ items: [triggerLine, rewardNoDiscount] }, { ...rule, limits: { maxQuantityPerCart: 2 } }, synchronizedConfig, true), 'added_pending_shopify', 'retry state is pending');

const asset = readFileSync(new URL('../extensions/megaska-otp/assets/loopdesk-cart-drawer.js', import.meta.url), 'utf8');
const classifierSource = asset.match(/function classifyPromotionOfferExecution[\s\S]*?\n  }\n\n  function promotionUatDebugCartSnapshot/)?.[0] || '';
assert.ok(classifierSource, 'storefront classifier exists');
assert.equal(/expected|fixed final|fixedFinal|fixed_price|promotionalUnitPrice|promotionDiscountTotal/i.test(classifierSource), false, 'classifier does not use configured monetary discount helpers');
assert.equal(/original_line_price\s*[-+*/]|final_line_price\s*[-+*/]|expectedDiscount|discountAmount|fixedFinalPrice/i.test(classifierSource), false, 'classifier does not locally subtract, multiply, or derive discount amounts');

console.log('CONFIG-4.4A promotion execution UAT classifier fixtures passed');

const forbiddenLocalPricingReferences = [
  'resolvePromotionRewardVariantPrice',
  'parseDisplayMoney',
  'formatDisplayMoneyLike',
  'promotionPricingHelper',
  'centsFromDisplayMoney',
  'resolvePromotionOfferPriceDisplay'
];
for (const helperName of forbiddenLocalPricingReferences) {
  assert.equal(asset.includes(helperName), false, `${helperName} is not referenced in the cart drawer asset`);
}

const functionNames = new Set([...asset.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]));
const calledPromotionHelpers = new Set([...asset.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
  .map((match) => match[1])
  .filter((name) => /Promotion|promotion/.test(name))
  .filter((name) => !['if', 'for', 'while', 'switch', 'function'].includes(name)));
for (const helperName of calledPromotionHelpers) {
  assert.ok(functionNames.has(helperName), `called promotion helper ${helperName} is defined`);
}

const renderPromotionOffersSource = asset.match(/function renderPromotionOffers\(cart\) {[\s\S]*?\n  }\n\n\n  function promotionViewModel/)?.[0]
  ?.replace(/\n\n\n  function promotionViewModel[\s\S]*$/, '');
assert.ok(renderPromotionOffersSource, 'renderPromotionOffers source is extractable');

function createRenderPromotionOffers({ display = {} } = {}) {
  const harness = new Function(`${renderPromotionOffersSource}
    return renderPromotionOffers;`);
  return harness.call({});
}

const renderHarness = new Function('rule', 'synchronizedConfig', 'TRIGGER_VARIANT_GID', 'REWARD_VARIANT_GID', 'triggerLine', 'rewardDiscounted', `
  const state = { offerAdding: false, offerError: '' };
  const config = { promotion_rules_config: { ...synchronizedConfig, rules: [rule], maxVisibleOffers: 1 } };
  function isPlainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
  function normalizePromotionConfig(value) { return value || { rules: [] }; }
  function sameShopifyId(left, right) { return Boolean(left && right && (String(left) === String(right) || String(left).split('/').pop() === String(right).split('/').pop())); }
  function resolvePromotionOfferVariantGid(reward) { return reward && (reward.variantGid || reward.variant_gid || reward.variantId || ''); }
  function promotionRewardLine(cart, rewardVariantGid) { return (cart.items || []).find((item) => sameShopifyId(item.variant_id, rewardVariantGid) || sameShopifyId(item.id, rewardVariantGid)) || null; }
  function cartLineDiscountAllocations(item) { return (item && (item.line_level_discount_allocations || item.discounts || item.discount_allocations)) || []; }
  function discountAllocationAmount(allocation) { return Number(allocation && (allocation.amount || allocation.value || allocation.amountCents || allocation.valueCents || 0)) || 0; }
  function lineShopifyDiscountObserved(item) {
    if (!item) return false;
    const original = Number(item.original_line_price);
    const finalPrice = Number(item.final_line_price);
    return (Number.isFinite(original) && Number.isFinite(finalPrice) && finalPrice < original) || cartLineDiscountAllocations(item).some((allocation) => discountAllocationAmount(allocation) > 0);
  }
  function promotionOfferRemainingQuantity(cart, testRule, rewardVariantGid) {
    const max = Math.max(1, Number(testRule.limits && testRule.limits.maxQuantityPerCart) || 1);
    const existing = (cart.items || []).reduce((total, item) => total + (sameShopifyId(item.variant_id, rewardVariantGid) ? Math.max(0, Number(item.quantity) || 0) : 0), 0);
    return Math.max(0, max - existing);
  }
  function isPromotionPublicationSynchronized() { return true; }
  function hasSynchronizedPromotionPublication() { return true; }
  function getEligiblePromotionRules(cart) { return (cart.items || []).some((item) => sameShopifyId(item.variant_id, TRIGGER_VARIANT_GID) || sameShopifyId(item.id, TRIGGER_VARIANT_GID)) ? [rule] : []; }
  function classifyPromotionOfferExecution(cart, testRule) {
    const rewardVariantGid = resolvePromotionOfferVariantGid(testRule.reward || {});
    const line = promotionRewardLine(cart, rewardVariantGid);
    if (line && lineShopifyDiscountObserved(line)) return 'applied_by_shopify';
    if (!line) return 'eligible_not_added';
    return 'added_without_discount';
  }
  function money(cents, currency) { return String(currency || 'INR') + ':' + cents; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ''); }
  ${renderPromotionOffersSource}
  return [
    renderPromotionOffers({ currency: 'INR', items: [triggerLine] }),
    renderPromotionOffers({ currency: 'INR', items: [triggerLine] }),
    renderPromotionOffers({ currency: 'INR', items: [triggerLine, rewardDiscounted] }),
    renderPromotionOffers({ currency: 'INR', items: [triggerLine] })
  ];
`);

const renderRuleWithDisplay = {
  ...rule,
  display: { placement: 'drawer', description: 'Get this item for a special price' },
  reward: { ...rule.reward, product: { title: 'Reward item' } }
};
const renderRuleMissingDisplay = { ...rule, display: {}, reward: { ...rule.reward, product: {} } };
const [triggerOnlyHtml, noRewardHtml, discountedHtml] = renderHarness(renderRuleWithDisplay, synchronizedConfig, TRIGGER_VARIANT_GID, REWARD_VARIANT_GID, triggerLine, rewardDiscounted);
assert.match(triggerOnlyHtml, /Get this item for a special price/, 'pre-add offer descriptive text renders');
assert.doesNotMatch(noRewardHtml, /Get it for/, 'no reward line does not present an applied Shopify final price');
assert.match(discountedHtml, /data-loopdesk-display-price-source="shopify_cart"/, 'discounted reward line uses Shopify cart as final price source');
assert.match(discountedHtml, /data-loopdesk-compare-price-source="shopify_cart"/, 'discounted reward line uses Shopify cart as compare price source');
assert.match(discountedHtml, /Usually INR:500/, 'discounted reward line renders Shopify original line price as compare price');
assert.doesNotThrow(() => renderHarness(renderRuleMissingDisplay, synchronizedConfig, TRIGGER_VARIANT_GID, REWARD_VARIANT_GID, triggerLine, rewardDiscounted), 'renderPromotionOffers tolerates missing optional display values');

console.log('CONFIG-4.4A promotion offer render regression assertions passed');
