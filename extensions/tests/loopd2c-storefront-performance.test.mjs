import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`../megaska-otp-src/${name}`, import.meta.url), "utf8");
const embed = fs.readFileSync(new URL("../megaska-otp/blocks/megaska-otp-embed.liquid", import.meta.url), "utf8");

// Fake DOM just big enough for isIgnorableMutation.
function fakeDom() {
  const head = { nodeName: "HEAD", nodeType: 1, contains: (node) => node.inHead === true };
  const body = { nodeName: "BODY", nodeType: 1 };
  const el = (nodeName, inHead = false) => ({ nodeName, nodeType: 1, inHead });
  const text = { nodeName: "#text", nodeType: 3 };
  return { document: { head }, head, body, el, text };
}

function loadFilter(source, pattern) {
  const fn = source.match(pattern);
  assert.ok(fn, "isIgnorableMutation not found");
  const dom = fakeDom();
  const context = { document: dom.document };
  vm.runInNewContext(`${fn[0]}; this.isIgnorableMutation = isIgnorableMutation;`, context);
  return { ignorable: context.isIgnorableMutation, ...dom };
}

const sources = {
  "loopdesk-cart-drawer.js": [read("loopdesk-cart-drawer.js"), /function isIgnorableMutation\(mutation\) \{[\s\S]*?\n {2}\}\n/],
  "loopd2c-otp.js": [read("loopd2c-otp.js"), /function isIgnorableMutation\(mutation\) \{[\s\S]*?\n\}\n/],
};

for (const [name, [source, pattern]] of Object.entries(sources)) {
  test(`${name}: Shopify's prefetch links and head changes don't trigger a page re-scan`, () => {
    const { ignorable, head, body, el, text } = loadFilter(source, pattern);
    assert.equal(ignorable({ type: "childList", target: head, addedNodes: [el("LINK", true)], removedNodes: [] }), true, "prefetch link in <head>");
    assert.equal(ignorable({ type: "childList", target: body, addedNodes: [el("SCRIPT")], removedNodes: [el("STYLE")] }), true, "scripts and styles in <body>");
    assert.equal(ignorable({ type: "childList", target: body, addedNodes: [el("DIV")], removedNodes: [] }), false, "new markup is re-scanned");
    assert.equal(ignorable({ type: "childList", target: body, addedNodes: [el("SCRIPT"), el("A")], removedNodes: [] }), false, "mixed batch is re-scanned");
    assert.equal(ignorable({ type: "childList", target: body, addedNodes: [text], removedNodes: [] }), false, "text changes are re-scanned");
    assert.equal(ignorable({ type: "attributes", target: body, addedNodes: [], removedNodes: [] }), false, "attribute changes are re-scanned");
  });
}

test("the bag's two page observers and the OTP account observer use the filter", () => {
  const drawer = read("loopdesk-cart-drawer.js");
  assert.equal((drawer.match(/if \(isIgnorableMutation\(mutation\) \|\| isInsideLoopDeskDrawer\(mutation\.target\)\) return false;/g) || []).length, 2);
  const otp = read("loopd2c-otp.js");
  const observer = otp.slice(otp.indexOf("accountFallbackObserver = new MutationObserver("), otp.indexOf("accountFallbackObserver.observe("));
  assert.match(observer, /if \(mutations\.every\(isIgnorableMutation\)\) return;/);
  assert.doesNotMatch(observer, /hasVisibleNativeDesktopAccountEntry\(\)/, "no layout read per mutation");
  const buyNow = read("loopdesk-buy-now-bridge.js");
  assert.match(buyNow, /n\.nodeType === 1 && !\/\^\(LINK\|SCRIPT\|STYLE\|META\|NOSCRIPT\)\$\/\.test\(n\.nodeName\) && n\.parentNode !== document\.head/);
});

test("the bag's diagnostic logs stay silent for shoppers", () => {
  const drawer = read("loopdesk-cart-drawer.js");
  assert.doesNotMatch(drawer, /debugLog(Once)?\([^;]*\}, true\);/, "no forced logs");
  const helper = drawer.match(/ {2}var CART_DEBUG_ENABLED = \(function \(\) \{[\s\S]*?\n {2}\}\)\(\);\n\n {2}function debugLog\(message, payload\) \{[\s\S]*?\n {2}\}/);
  assert.ok(helper, "debug helper");
  const run = (search, stored, flag) => {
    const logged = [];
    const context = { window: { LOOPDESK_CART_DRAWER_DEBUG: flag, console: { debug: (...args) => logged.push(args) }, location: { search }, localStorage: { getItem: () => stored } } };
    vm.runInNewContext(`${helper[0]}; debugLog("x", {}, true);`, context);
    return logged.length;
  };
  assert.equal(run("", null, undefined), 0, "silent by default, even when forced");
  assert.equal(run("?loopd2c_debug=1", null, undefined), 1);
  assert.equal(run("", "1", undefined), 1);
  assert.equal(run("", null, true), 1);
});

test("one runtime config request per page load", () => {
  assert.match(embed, /window\.LOOPD2C_RUNTIME_CONFIG_REQUEST = \{ at: Date\.now\(\), payload: runtimeConfigRequest \};/);
  assert.match(embed, /\.then\(function \(response\) \{ return response\.ok \? response\.json\(\) : null; \}\)\n {6}\.catch\(function \(\) \{ return null; \}\);/, "shared promise never rejects");
  const drawer = read("loopdesk-cart-drawer.js");
  assert.match(drawer, /var shared = state\.promotionRuntimeRefresh\.attempts === 1 \? recentRuntimeConfigRequest\(15000\) : null;/);
  const bridge = read("loopdesk-checkout-bridge.js");
  assert.match(bridge, /Date\.now\(\) - Number\(shared\.at \|\| 0\) < 60000 \? await shared\.payload : null;\n {6}if \(!payload \|\| !payload\.config\) \{/, "falls back to its own request");
});

test("the exchange hook loads once the page is idle", () => {
  assert.doesNotMatch(embed, /<script src="\/apps\/loopd2c\/loopd2c-exchange-hook\.js" defer><\/script>/);
  assert.match(embed, /script\.src = "\/apps\/loopd2c\/loopd2c-exchange-hook\.js";/);
  assert.match(embed, /window\.requestIdleCallback\(load, \{ timeout: 3000 \}\)/);
  assert.match(embed, /window\.addEventListener\("load", whenIdle, \{ once: true \}\);/);
});

test("checkout readiness reuses the page's runtime config and refetches when it is stale or failed", async () => {
  const bridge = read("loopdesk-checkout-bridge.js");
  const fn = bridge.match(/async function resolveExpressCheckoutReadiness\(\) \{[\s\S]*?\n\}\n/)[0];
  const run = async (shared) => {
    let fetches = 0;
    const window = {
      MEGASKA_SHOP_DOMAIN: "megaskastore.myshopify.com",
      LOOPD2C_RUNTIME_CONFIG_REQUEST: shared,
      fetch: async () => { fetches += 1; return { ok: true, json: async () => ({ config: { express_checkout: { enabled: true, ready: true, source: "fetch" } } }) }; },
    };
    const context = { window };
    vm.runInNewContext(`${fn}; this.resolve = resolveExpressCheckoutReadiness;`, context);
    return { readiness: await context.resolve(), fetches };
  };
  const fresh = await run({ at: Date.now(), payload: Promise.resolve({ config: { express_checkout: { enabled: true, ready: true, source: "shared" } } }) });
  assert.deepEqual([fresh.readiness.source, fresh.fetches], ["shared", 0]);
  const stale = await run({ at: Date.now() - 120000, payload: Promise.resolve({ config: {} }) });
  assert.deepEqual([stale.readiness.source, stale.fetches], ["fetch", 1]);
  const failed = await run({ at: Date.now(), payload: Promise.resolve(null) });
  assert.deepEqual([failed.readiness.source, failed.fetches], ["fetch", 1]);
  const none = await run(undefined);
  assert.deepEqual([none.readiness.source, none.fetches], ["fetch", 1]);
});
