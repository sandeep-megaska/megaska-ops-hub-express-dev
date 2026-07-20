import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const drawerPath = new URL("../megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url);
const source = fs.readFileSync(drawerPath, "utf8");

function moduleApi(modules, sessionStorage) {
  const window = {
    location: { origin: "https://shop.example" },
    Shopify: { shop: "shop.example" },
    LoopDeskConfig: { enabled: false, cart_intelligence_config: { cartDrawerModules: { schemaVersion: 1, modules } } },
    console: { debug() {} },
    sessionStorage,
  };
  vm.runInNewContext(source, { window, URL, Intl, console: window.console });
  return window.LoopDeskCartDrawerModules;
}

const bannerModule = (settings = {}, overrides = {}) => ({
  key: "DYNAMIC_BANNER", enabled: true, slot: "BEFORE_CART_LINES", sortOrder: 10,
  settings: { message: "Free returns this week", style: "INFO", alignment: "CENTER", showIcon: true, visibility: { emptyCart: true, cartWithItems: true }, ...settings },
  ...overrides,
});

const savingsModule = (settings = {}, overrides = {}) => ({
  key: "SAVINGS_SUMMARY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 20,
  settings: { title: "You Saved", showTotalSavings: true, showOfferSavings: true, showCouponSavings: true, showCompareAtSavings: true, hideZeroRows: true, ...settings },
  ...overrides,
});
const promotionLine = (original = 1000, finalPrice = 600) => ({ quantity: 1, original_price: original, original_line_price: original, final_line_price: finalPrice, properties: { _loopdesk_promotion_rule_id: "offer-1" } });
const retailLine = (compareAt = 1000, selling = 800, quantity = 1) => ({ quantity, compare_at_price: compareAt, original_price: selling, original_line_price: selling * quantity, final_line_price: selling * quantity, properties: {} });
const cart = (...items) => ({ item_count: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), currency: "INR", items });
const renderSavings = (items, settings = {}, context = {}) => moduleApi([savingsModule(settings)]).renderCartDrawerSlot("BEFORE_TOTALS", { cart: cart(...items), money: value => `M${value}`, ...context });

test("disabled modules and modules without renderers are ignored", () => {
  const api = moduleApi([
    { key: "LOYALTY", enabled: false, slot: "BEFORE_TOTALS", sortOrder: 1 },
    { key: "UPSELLS", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 2 },
  ]);
  api.registerRenderer("LOYALTY", () => "loyalty");
  assert.equal(api.renderCartDrawerSlot("BEFORE_TOTALS", {}), "");
});

test("slot rendering is stable by order then module key", () => {
  const api = moduleApi([
    { key: "LOYALTY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 20 },
    { key: "BUNDLES", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 10 },
    { key: "UPSELLS", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 10 },
  ]);
  ["LOYALTY", "BUNDLES", "UPSELLS"].forEach((key) => api.registerRenderer(key, () => key + ","));
  assert.equal(api.renderCartDrawerSlot("BEFORE_TOTALS", {}), "BUNDLES,UPSELLS,LOYALTY,");
});

test("a throwing renderer does not block a later renderer", () => {
  const api = moduleApi([
    { key: "BUNDLES", enabled: true, slot: "AFTER_TOTALS", sortOrder: 1 },
    { key: "LOYALTY", enabled: true, slot: "AFTER_TOTALS", sortOrder: 2 },
  ]);
  api.registerRenderer("BUNDLES", () => { throw new Error("optional failure"); });
  api.registerRenderer("LOYALTY", () => "later");
  assert.equal(api.renderCartDrawerSlot("AFTER_TOTALS", {}), "later");
});

test("dynamic banner renders escaped text once in its configured slot", () => {
  const api = moduleApi([bannerModule({ message: '<script>alert("x")</script>' })]);
  const html = api.renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } });
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.equal(api.renderCartDrawerSlot("AFTER_CART_LINES", { cart: { item_count: 1 } }), "");
  assert.equal((html.match(/loopdesk-cart-banner loopdesk/g) || []).length, 1);
});

test("dynamic banner supports safe links and omits unsafe links without hiding text", () => {
  for (const linkUrl of ["https://example.com", "/sale", "mailto:help@example.com", "tel:+15551234"]) {
    const html = moduleApi([bannerModule({ linkLabel: "Learn <more>", linkUrl })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } });
    assert.match(html, /href=/); assert.match(html, /Learn &lt;more&gt;/);
  }
  for (const linkUrl of ["javascript:alert(1)", "data:text/html,bad"]) {
    const html = moduleApi([bannerModule({ linkLabel: "Bad", linkUrl })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } });
    assert.match(html, /Free returns/); assert.doesNotMatch(html, /href=/);
  }
});

test("dynamic banner respects enabled, message, visibility, icon, and dismissal controls", () => {
  assert.equal(moduleApi([bannerModule({}, { enabled: false })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), "");
  assert.equal(moduleApi([bannerModule({ message: "   " })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), "");
  assert.equal(moduleApi([bannerModule({ visibility: { emptyCart: false, cartWithItems: true } })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 0 } }), "");
  assert.match(moduleApi([bannerModule({ visibility: { emptyCart: true, cartWithItems: false } })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 0 } }), /Free returns/);
  assert.equal(moduleApi([bannerModule({ visibility: { emptyCart: true, cartWithItems: false } })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), "");
  assert.doesNotMatch(moduleApi([bannerModule({ showIcon: false })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), /banner__icon/);
  assert.doesNotMatch(moduleApi([bannerModule({ dismissible: false })]).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), /data-loopdesk-cart-banner-dismiss/);
});

test("session dismissal survives rerender, changed content returns, and storage failure is safe", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const api = moduleApi([bannerModule({ dismissible: true })], storage);
  const html = api.renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } });
  const key = html.match(/data-loopdesk-cart-banner-dismiss="([^"]+)/)[1];
  storage.setItem(key, "1");
  assert.equal(api.renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), "");
  assert.match(moduleApi([bannerModule({ dismissible: true, message: "Changed" })], storage).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), /Changed/);
  const failing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.match(moduleApi([bannerModule({ dismissible: true })], failing).renderCartDrawerSlot("BEFORE_CART_LINES", { cart: { item_count: 1 } }), /Free returns/);
});

test("savings summary is disabled for empty carts and zero savings", () => {
  assert.equal(moduleApi([savingsModule({}, { enabled: false })]).renderCartDrawerSlot("BEFORE_TOTALS", { cart: cart() }), "");
  assert.equal(renderSavings([], {}), "");
  assert.equal(renderSavings([retailLine(700, 800)]), "");
});

test("savings builder keeps offer, confirmed coupon, and retail layers separate", () => {
  const api = moduleApi([]);
  const values = api.buildCartSavingsSummary({ cart: cart(promotionLine(1000, 600), retailLine(1000, 800, 2)), couponState: { status: "CONFIRMED", confirmedDiscountMinor: 150 } });
  assert.deepEqual({ ...values }, { offerSavingsMinor: 400, couponSavingsMinor: 150, compareAtSavingsMinor: 400, totalSavingsMinor: 950 });
  assert.equal(api.buildCartSavingsSummary({ cart: cart(promotionLine()), couponState: { status: "PENDING", confirmedDiscountMinor: 999 } }).couponSavingsMinor, 0);
});

test("savings renderer supports each category and every category combination", () => {
  const cases = [
    [[promotionLine()], {}, ["Offer savings", "M400"]],
    [[retailLine()], {}, ["Retail savings", "M200"]],
    [[retailLine(800, 800)], { couponState: { confirmed: true, confirmedDiscountMinor: 150 } }, ["Coupon savings", "M150"]],
    [[promotionLine()], { couponState: { status: "APPLIED", confirmedDiscountMinor: 150 } }, ["Offer savings", "Coupon savings", "M550"]],
    [[promotionLine(), retailLine()], {}, ["Offer savings", "Retail savings", "M600"]],
    [[retailLine()], { couponState: { status: "CONFIRMED", confirmedDiscountMinor: 150 } }, ["Coupon savings", "Retail savings", "M350"]],
    [[promotionLine(), retailLine()], { couponState: { status: "CONFIRMED", confirmedDiscountMinor: 150 } }, ["Offer savings", "Coupon savings", "Retail savings", "M750"]],
  ];
  cases.forEach(([items, context, expected]) => { const html = renderSavings(items, {}, context); expected.forEach(value => assert.match(html, new RegExp(value))); });
});

test("savings renderer respects total, row visibility, and zero-row settings", () => {
  assert.doesNotMatch(renderSavings([promotionLine()], { showTotalSavings: false }), /loopdesk-cart-savings__total/);
  assert.doesNotMatch(renderSavings([promotionLine()], { showOfferSavings: false }), /Offer savings/);
  assert.doesNotMatch(renderSavings([retailLine()], { showCompareAtSavings: false }), /Retail savings/);
  assert.doesNotMatch(renderSavings([promotionLine()], {}, { couponState: { status: "PENDING" } }), /Coupon savings/);
  const zeros = renderSavings([promotionLine()], { hideZeroRows: false });
  assert.match(zeros, /Coupon savings/); assert.match(zeros, /Retail savings/);
  assert.equal(renderSavings([retailLine(700, 800)], { hideZeroRows: false }), "");
});

test("savings normalization clamps malformed values and respects quantity without double counting", () => {
  const api = moduleApi([]);
  assert.doesNotThrow(() => api.buildCartSavingsSummary({ cart: { items: [null, "bad", { quantity: NaN, compare_at_price: Infinity }] } }));
  const malformed = api.buildCartSavingsSummary({ cart: cart({ quantity: 1, original_line_price: -100, final_line_price: NaN, properties: { _loopdesk_promotion_rule_id: "x" } }), couponState: { confirmed: true, confirmedDiscountMinor: -5 } });
  assert.deepEqual({ ...malformed }, { offerSavingsMinor: 0, couponSavingsMinor: 0, compareAtSavingsMinor: 0, totalSavingsMinor: 0 });
  assert.equal(api.buildCartSavingsSummary({ cart: cart(retailLine(1000, 800, 3)) }).compareAtSavingsMinor, 600);
  assert.equal(api.buildCartSavingsSummary({ cart: cart(retailLine(700, 800, 3)) }).compareAtSavingsMinor, 0);
  const markedRetail = { ...retailLine(1000, 800), original_line_price: 800, final_line_price: 600, properties: { _loopdesk_promotion_rule_id: "x" } };
  assert.deepEqual({ ...api.buildCartSavingsSummary({ cart: cart(markedRetail) }) }, { offerSavingsMinor: 200, couponSavingsMinor: 0, compareAtSavingsMinor: 0, totalSavingsMinor: 200 });
});

test("savings summary uses configured slot/order once, escapes title, and coexists with banner", () => {
  const api = moduleApi([savingsModule({ title: '<img src=x onerror="bad">' }, { sortOrder: 10 }), bannerModule({ message: "Banner" }, { slot: "BEFORE_TOTALS", sortOrder: 20 })]);
  const html = api.renderCartDrawerSlot("BEFORE_TOTALS", { cart: cart(promotionLine()), money: value => `M${value}` });
  assert.ok(html.indexOf("loopdesk-cart-savings") < html.indexOf("loopdesk-cart-banner"));
  assert.equal((html.match(/<section class="loopdesk-cart-savings"/g) || []).length, 1);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.equal(api.renderCartDrawerSlot("AFTER_TOTALS", { cart: cart(promotionLine()) }), "");
});

test("working drawer sections remain on their existing render paths", () => {
  assert.match(source, /renderCartGoalProgress\(cart\)/);
  assert.match(source, /renderOffers\(cart\)/);
  assert.match(source, /elements\.subtotal\.textContent/);
  assert.match(source, /renderTrustBadges\("BELOW_TOTALS"\)/);
  assert.match(source, /renderTrustBadges\("BELOW_CHECKOUT_BUTTON"\)/);
  assert.match(source, /elements\.express\.hidden/);
  assert.doesNotMatch(source, /moduleRegistry\.(PROMOTIONS|COUPON|TRUST_BADGES|CART_GOAL_PROGRESS)\s*=\s*render/);
});
