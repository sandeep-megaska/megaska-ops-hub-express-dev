import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('extensions/megaska-otp/assets/loopdesk-cart-drawer.js', 'utf8');
const productGid = 'gid://shopify/Product/100';
const variantAGid = 'gid://shopify/ProductVariant/200';
const variantBGid = 'gid://shopify/ProductVariant/201';
const rewardProduct = {
  productGid,
  numericProductId: 100,
  title: 'Runtime Tee',
  availableForSale: true,
  featuredImage: { url: 'tee.jpg' },
  options: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Black', 'Blue'] }],
  variants: [
    { variantGid: variantAGid, numericVariantId: 200, title: 'S / Black', availableForSale: true, selectedOptions: [{ name: 'Size', value: 'S' }, { name: 'Colour', value: 'Black' }], price: { amount: '10.00', currencyCode: 'USD' } },
    { variantGid: variantBGid, numericVariantId: 201, title: 'M / Blue', availableForSale: false, selectedOptions: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Blue' }], price: { amount: '12.00', currencyCode: 'USD' } }
  ]
};
const variantRule = { id: 'variant-rule', enabled: true, status: 'active', priority: 1, display: { placement: 'drawer', badge: 'Deal' }, eligibility: { triggers: [{ type: 'always' }] }, limits: { maxQuantityPerCart: 1 }, reward: { productGid, variantGid: variantAGid, variantSelectionMode: 'variant', quantity: 1, product: { title: 'Legacy Tee' } } };
const productRule = { id: 'product-rule', enabled: true, status: 'active', priority: 2, display: { placement: 'drawer', badge: 'Deal' }, eligibility: { triggers: [{ type: 'cart_contains_product', productGid: 'gid://shopify/Product/999' }] }, limits: { maxQuantityPerCart: 2 }, reward: { productGid, variantSelectionMode: 'product', quantity: 1 } };
const context = {
  console,
  setTimeout(fn) { return fn(); },
  clearTimeout() {},
  URL,
  Intl,
  fetch: async () => ({ ok: true, json: async () => ({ items: [], item_count: 0, currency: 'USD' }) }),
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {}, classList: { add(){}, remove(){} } }
  },
  location: { origin: 'https://example.test', pathname: '/' },
  Shopify: { shop: 'example.myshopify.com' },
  LoopDeskConfig: {
    enabled: true,
    promotion_rules_config: {
      enabled: true,
      maxVisibleOffers: 5,
      publication: { synchronized: true, activeAutomaticDiscount: true, productCapability: true },
      rewardProducts: { [productGid]: rewardProduct },
      rewardProductStatuses: { [productGid]: 'ready' },
      rules: [variantRule, productRule]
    }
  }
};
context.window = context;
vm.runInNewContext(source, context);
const h = context.__LoopDeskCartDrawerTestHooks;
const cart = { currency: 'USD', item_count: 1, items: [{ product_id: 999, variant_id: 888, quantity: 1 }] };

assert.equal(h.promotionRewardSelectionMode(variantRule.reward), 'variant');
assert.equal(h.promotionRewardSelectionMode({ productGid, variantGid: variantAGid }), 'variant');
assert.equal(h.promotionRewardSelectionMode(productRule.reward), 'product');
assert.equal(h.promotionRewardProduct(productRule.reward).title, 'Runtime Tee');
assert.equal(h.availableRewardVariants(rewardProduct).length, 1);
assert.equal(h.resolveSelectedRewardVariant(rewardProduct, { Size: 'S' }), null);
assert.equal(h.resolveSelectedRewardVariant(rewardProduct, { Size: 'S', Colour: 'Black' }).numericVariantId, 200);
assert.equal(h.resolveSelectedRewardVariant(rewardProduct, { Size: 'M', Colour: 'Blue' }), null);
assert.equal(h.promotionRewardQuantityInCart({ items: [{ product_id: 100, variant_id: 200, quantity: 1 }, { product_id: 100, variant_id: 201, quantity: 2 }] }, productRule), 3);
assert.equal(h.promotionOfferRemainingQuantity({ items: [{ product_id: 100, variant_id: 200, quantity: 1 }] }, productRule), 1);
assert.equal(h.getEligiblePromotionRules(cart, 'drawer', new Date()).map(r => r.id).join(','), 'variant-rule,product-rule');
assert.match(h.renderPromotionOffers(cart), /data-loopdesk-offer-mode="product"/);
assert.match(h.renderPromotionOffers(cart), /Runtime Tee/);

h.setConfig({ enabled: true, promotion_rules_config: { enabled: true, maxVisibleOffers: 5, publication: { synchronized: true, activeAutomaticDiscount: true, productCapability: true }, rewardProducts: { [productGid]: { ...rewardProduct, variantsTruncated: true } }, rewardProductStatuses: { [productGid]: 'ready' }, rules: [productRule] } });
assert.equal(h.getEligiblePromotionRules(cart, 'drawer', new Date()).length, 1);
assert.match(h.renderPromotionOffers(cart), /too many variants/);

let calls = [];
context.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ items: [], item_count: 0, currency: 'USD' }) }; };
await h.addPromotionOffer(200, 1, 'product-rule');
assert.equal(calls.filter(c => c.url === '/cart/add.js').length, 1);
assert.deepEqual(JSON.parse(calls[0].init.body), { items: [{ id: 200, quantity: 1 }] });
assert.equal(calls.some(c => c.url === '/cart.js'), true);

const cappedRule = { ...productRule, limits: { maxQuantityPerCart: 1 } };
assert.equal(h.promotionOfferExecutionState({ items: [{ product_id: 100, variant_id: 200, original_line_price: 1000, final_line_price: 800, quantity: 1 }] }, cappedRule, { numericVariantId: 200 }), 'applied_by_shopify');
assert.equal(h.promotionOfferExecutionState({ items: [{ product_id: 100, variant_id: 200, original_line_price: 1000, final_line_price: 1000, quantity: 1 }] }, cappedRule, { numericVariantId: 200 }), 'added_without_confirmed_discount');
console.log('loopdesk product offer selector tests passed');
