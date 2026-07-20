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

test("working drawer sections remain on their existing render paths", () => {
  assert.match(source, /renderCartGoalProgress\(cart\)/);
  assert.match(source, /renderOffers\(cart\)/);
  assert.match(source, /elements\.subtotal\.textContent/);
  assert.match(source, /renderTrustBadges\("BELOW_TOTALS"\)/);
  assert.match(source, /renderTrustBadges\("BELOW_CHECKOUT_BUTTON"\)/);
  assert.match(source, /elements\.express\.hidden/);
  assert.doesNotMatch(source, /moduleRegistry\.(PROMOTIONS|COUPON|TRUST_BADGES|CART_GOAL_PROGRESS)\s*=\s*render/);
});
