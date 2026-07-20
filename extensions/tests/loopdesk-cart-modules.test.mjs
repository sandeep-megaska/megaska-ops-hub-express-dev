import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const drawerPath = new URL("../megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url);
const source = fs.readFileSync(drawerPath, "utf8");
const drawerCssPath = new URL("../megaska-otp/assets/loopdesk-cart-drawer.css", import.meta.url);
const drawerCss = fs.readFileSync(drawerCssPath, "utf8");

test("drawer CSS keeps the wider panel and scrollbar-free scrolling viewport safe", () => {
  assert.match(drawerCss, /\.loopdesk-cart-drawer\s*\{[^}]*width:\s*min\(520px, 100vw\);[^}]*max-width:\s*100vw;/s);
  assert.match(drawerCss, /\.loopdesk-cart-drawer__body\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*-ms-overflow-style:\s*none;/s);
  assert.doesNotMatch(drawerCss, /\.loopdesk-cart-drawer__body\s*\{[^}]*overflow-y:\s*hidden;/s);
  assert.match(drawerCss, /\.loopdesk-cart-drawer__body::\-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*width:\s*0;[^}]*height:\s*0;/s);
  assert.match(drawerCss, /@media \(max-width:\s*640px\)[\s\S]*?\.loopdesk-cart-drawer\s*\{[^}]*width:\s*100vw;[^}]*max-width:\s*100vw;/);
});

test("drawer CSS uses wrapping layouts instead of horizontal trust badge scrolling", () => {
  assert.match(drawerCss, /\.loopdesk-cart-drawer__trust-badges\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.match(drawerCss, /\.loopdesk-cart-drawer__trust-badge span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.doesNotMatch(drawerCss, /\.loopdesk-cart-drawer__trust-badges--row\s*\{[^}]*(?:overflow-x:\s*auto|display:\s*flex)/s);
  assert.match(drawerCss, /\.loopdesk-cart-drawer__title\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(drawerCss, /\.loopdesk-cart-savings__title\s*\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere;/s);
  assert.match(drawerCss, /\.loopdesk-cart-drawer__express,[\s\S]*?\.loopdesk-cart-drawer__view-cart\s*\{[^}]*width:\s*100%;/);
});

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

test("savings builder consumes only the canonical authoritative pricing model", () => {
  const pricing = { isAuthoritative: true, productPromotionSavings: 400, orderPromotionSavings: 300, couponSavings: 150, totalSavings: 850, breakdownComplete: true };
  const values = moduleApi([]).buildCartSavingsSummary({ cart: cart(promotionLine()), pricing });
  assert.deepEqual({ ...values }, { offerSavingsMinor: 400, orderSavingsMinor: 300, couponSavingsMinor: 150, compareAtSavingsMinor: 0, totalSavingsMinor: 850, breakdownComplete: true });
});

test("savings renderer displays a reconciled category split", () => {
  const pricing = { isAuthoritative: true, productPromotionSavings: 400, orderPromotionSavings: 300, couponSavings: 150, totalSavings: 850, breakdownComplete: true };
  const html = renderSavings([promotionLine()], {}, { pricing });
  for (const value of ["Product savings", "Tier discount", "Coupon discount", "M850"]) assert.match(html, new RegExp(value));
  assert.doesNotMatch(html, /Retail savings/);
});

test("savings renderer falls back to Shopify combined discount when allocations are incomplete", () => {
  const pricing = { isAuthoritative: true, productPromotionSavings: 0, orderPromotionSavings: 0, couponSavings: 0, totalSavings: 720, breakdownComplete: false };
  const html = renderSavings([promotionLine()], {}, { pricing });
  assert.match(html, /Total discount/);
  assert.match(html, /M720/);
  assert.doesNotMatch(html, /Product savings|Tier discount|Coupon discount/);
});

test("local coupon and compare-at estimates cannot alter authoritative savings", () => {
  const pricing = { isAuthoritative: true, productPromotionSavings: 0, orderPromotionSavings: 0, couponSavings: 0, totalSavings: 0, breakdownComplete: true };
  const values = moduleApi([]).buildCartSavingsSummary({ cart: cart(retailLine()), couponState: { status: "CONFIRMED", confirmedDiscountMinor: 999 }, pricing });
  assert.equal(values.totalSavingsMinor, 0);
  assert.equal(renderSavings([retailLine()], {}, { pricing }), "");
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
