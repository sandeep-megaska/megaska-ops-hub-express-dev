import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const drawerPath = new URL("../megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url);
const source = fs.readFileSync(drawerPath, "utf8");

function moduleApi(modules) {
  const window = {
    location: { origin: "https://shop.example" },
    Shopify: { shop: "shop.example" },
    LoopDeskConfig: { enabled: false, cart_intelligence_config: { cartDrawerModules: { schemaVersion: 1, modules } } },
    console: { debug() {} },
  };
  vm.runInNewContext(source, { window, URL, Intl, console: window.console });
  return window.LoopDeskCartDrawerModules;
}

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

test("working drawer sections remain on their existing render paths", () => {
  assert.match(source, /renderFreeShippingProgress\(cart\)/);
  assert.match(source, /renderOffers\(cart\)/);
  assert.match(source, /elements\.subtotal\.textContent/);
  assert.match(source, /renderTrustBadges\("BELOW_TOTALS"\)/);
  assert.match(source, /renderTrustBadges\("BELOW_CHECKOUT_BUTTON"\)/);
  assert.match(source, /elements\.express\.hidden/);
  assert.doesNotMatch(source, /moduleRegistry\.(PROMOTIONS|COUPON|TRUST_BADGES|CART_GOAL_PROGRESS)\s*=\s*render/);
});
