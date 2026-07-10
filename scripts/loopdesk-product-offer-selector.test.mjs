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
const productRule = { id: 'product-rule', enabled: true, status: 'active', priority: 2, display: { placement: 'drawer', badge: 'Deal' }, eligibility: { triggers: [{ type: 'cart_contains_product', productGid: 'gid://shopify/Product/999' }] }, limits: { maxQuantityPerCart: 2 }, reward: { productGid, variantSelectionMode: 'product', quantity: 1, product: { handle: 'runtime-tee', title: 'Runtime Tee', imageUrl: 'tee.jpg' } } };
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


// UI-3B browser same-origin catalogue loading
function makeHarness({ rule = productRule, rewardProducts = {}, rewardProductStatuses = {}, fetchImpl } = {}) {
  const ctx = {
    console,
    setTimeout(fn) { return fn(); },
    clearTimeout() {},
    URL,
    Intl,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ items: [], item_count: 0, currency: 'USD' }) })),
    document: context.document,
    location: context.location,
    Shopify: context.Shopify,
    LoopDeskConfig: {
      enabled: true,
      promotion_rules_config: {
        enabled: true,
        maxVisibleOffers: 5,
        publication: { synchronized: true, activeAutomaticDiscount: true, productCapability: true },
        rewardProducts,
        rewardProductStatuses,
        rules: [rule]
      }
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx);
  return { ctx, hooks: ctx.__LoopDeskCartDrawerTestHooks };
}

const ajaxProduct = {
  id: 100,
  handle: 'runtime-tee',
  title: 'Runtime Tee Browser',
  featured_image: 'runtime.jpg',
  options: [{ name: 'Title', values: ['Default Title'] }],
  variants: [{ id: 200, title: 'Default Title', available: true, option1: 'Default Title', price: 1234, compare_at_price: 1500 }]
};

let productFetches = [];
let deferredResolve;
const deferred = new Promise(resolve => { deferredResolve = resolve; });
const one = makeHarness({
  rewardProductStatuses: { [productGid]: 'query_failed' },
  fetchImpl: async (url, init) => {
    productFetches.push({ url, init });
    await deferred;
    return { ok: true, status: 200, json: async () => ajaxProduct };
  }
});
assert.equal(one.hooks.getEligiblePromotionRules(cart, 'drawer', new Date()).length, 1);
const loadingHtmlA = one.hooks.renderPromotionOffers(cart);
const loadingHtmlB = one.hooks.renderPromotionOffers(cart);
assert.match(loadingHtmlA, /Loading offer options/);
assert.equal(productFetches.length, 1);
assert.equal(productFetches[0].url, '/products/runtime-tee.js');
assert.equal(productFetches[0].init.credentials, 'same-origin');
assert.equal(productFetches[0].init.cache, 'no-store');
assert.equal(productFetches[0].init.headers.Accept, 'application/json');
assert.equal(productFetches[0].init.headers.Authorization, undefined);
assert.equal(productFetches[0].init.headers['X-Shopify-Storefront-Access-Token'], undefined);
deferredResolve();
await one.hooks.state.rewardProductLoadPromiseByGid[productGid];
const loaded = one.hooks.promotionRewardProduct(productRule.reward);
assert.equal(loaded.title, 'Runtime Tee Browser');
assert.equal(loaded.numericProductId, '100');
assert.equal(loaded.variants[0].numericVariantId, '200');
assert.equal(loaded.variants[0].price.amount, '12.34');
assert.equal(loaded.variants[0].price.currencyCode, 'USD');
assert.equal(one.hooks.promotionRewardProductStatus(productRule.reward), 'ready');
assert.match(one.hooks.renderPromotionOffers(cart), /Runtime Tee Browser/);
assert.doesNotMatch(loadingHtmlB, /https:\/\//);

const mismatch = makeHarness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...ajaxProduct, id: 101 }) }) });
await mismatch.hooks.loadPromotionRewardProduct(productRule.reward);
assert.equal(mismatch.hooks.promotionRewardProductStatus(productRule.reward), 'failed');
assert.equal(mismatch.hooks.promotionRewardProduct(productRule.reward), null);
assert.match(mismatch.hooks.renderPromotionOffers(cart), /Retry loading offer/);

const missingHandleRule = { ...productRule, reward: { productGid, variantSelectionMode: 'product', quantity: 1, product: { title: 'Persisted title' } } };
const missingHandle = makeHarness({ rule: missingHandleRule });
missingHandle.hooks.renderPromotionOffers(cart);
await Promise.resolve();
assert.equal(missingHandle.hooks.promotionRewardProductStatus(missingHandleRule.reward), 'failed');
assert.match(missingHandle.hooks.renderPromotionOffers(cart), /Retry loading offer|Offer options could not be loaded/);

const notFound = makeHarness({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
await notFound.hooks.loadPromotionRewardProduct(productRule.reward);
assert.equal(notFound.hooks.promotionRewardProductStatus(productRule.reward), 'not_found');
assert.match(notFound.hooks.renderPromotionOffers(cart), /Offer product is no longer available/);

let retryCalls = 0;
const failure = makeHarness({ fetchImpl: async () => { retryCalls += 1; if (retryCalls === 1) throw new Error('network'); return { ok: true, status: 200, json: async () => ajaxProduct }; } });
await failure.hooks.loadPromotionRewardProduct(productRule.reward);
assert.equal(failure.hooks.promotionRewardProductStatus(productRule.reward), 'failed');
await failure.hooks.loadPromotionRewardProduct(productRule.reward, true);
assert.equal(retryCalls, 2);
assert.equal(failure.hooks.promotionRewardProductStatus(productRule.reward), 'ready');

const soldOut = makeHarness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ...ajaxProduct, variants: [{ ...ajaxProduct.variants[0], available: false }] }) }) });
await soldOut.hooks.loadPromotionRewardProduct(productRule.reward);
assert.equal(soldOut.hooks.promotionRewardProductStatus(productRule.reward), 'unavailable');
assert.match(soldOut.hooks.renderPromotionOffers(cart), /Sold out/);

const multiProduct = { ...ajaxProduct, options: [{ name: 'Size', values: ['S', 'M'] }], variants: [
  { id: 200, title: 'S', available: true, option1: 'S', price: 1000 },
  { id: 201, title: 'M', available: true, option1: 'M', price: 1100 }
] };
const multi = makeHarness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => multiProduct }) });
await multi.hooks.loadPromotionRewardProduct(productRule.reward);
multi.hooks.state.offerSelectorRuleId = 'product-rule';
assert.match(multi.hooks.renderPromotionOffers(cart), /Choose your options/);

let addCalls = [];
const direct = makeHarness({ rewardProducts: { [productGid]: rewardProduct }, rewardProductStatuses: { [productGid]: 'ready' }, fetchImpl: async (url, init) => { addCalls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ items: [], item_count: 0, currency: 'USD' }) }; } });
await direct.hooks.addPromotionOffer(200, 1, 'product-rule');
assert.equal(addCalls.some(c => c.url === '/cart.js'), true);
assert.deepEqual(JSON.parse(addCalls.find(c => c.url === '/cart/add.js').init.body), { items: [{ id: 200, quantity: 1 }] });

const unsynced = makeHarness({ rule: { ...productRule }, rewardProducts: { [productGid]: rewardProduct }, rewardProductStatuses: { [productGid]: 'ready' } });
unsynced.hooks.setConfig({ enabled: true, promotion_rules_config: { enabled: true, maxVisibleOffers: 5, publication: { synchronized: false, activeAutomaticDiscount: false, productCapability: true }, rewardProducts: { [productGid]: rewardProduct }, rewardProductStatuses: { [productGid]: 'ready' }, rules: [productRule] } });
assert.match(unsynced.hooks.renderPromotionOffers(cart), /discount sync/);
assert.equal(unsynced.hooks.getEligiblePromotionRules({ currency: 'USD', item_count: 0, items: [] }, 'drawer', new Date()).length, 0);
console.log('loopdesk browser reward product catalogue tests passed');

process.exit(0);
