import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`../megaska-otp-src/${name}`, import.meta.url), "utf8");
const otp = read("loopd2c-otp.js");

// The merchant setting that decides whether checkout needs OTP login.
function loadGate(config) {
  const start = otp.indexOf("  let checkoutInterceptionEnabled = true;");
  const end = otp.indexOf("\n  }\n", otp.indexOf("function checkoutGateOn()")) + 5;
  assert.ok(start > 0 && end > start, "gate helpers not found");
  const context = { window: { LoopDeskConfig: config } };
  vm.runInNewContext(`${otp.slice(start, end)}; this.read = () => checkoutInterceptionEnabled; this.apply = applyMerchantCheckoutGate;`, context);
  return context;
}

test("the OTP gate stays on until the merchant's setting explicitly turns it off", () => {
  for (const config of [undefined, {}, { checkout: {} }, { checkout: { otpGateEnabled: true } }]) {
    const gate = loadGate(config);
    gate.apply();
    assert.equal(gate.read(), true, JSON.stringify(config));
  }
  const off = loadGate({ checkout: { otpGateEnabled: false } });
  off.apply();
  assert.equal(off.read(), false);
});

test("the embed's copy of the setting wins over a LoopDeskConfig the bag script rebuilt", () => {
  const start = otp.indexOf("  let checkoutInterceptionEnabled = true;");
  const end = otp.indexOf("\n  }\n", otp.indexOf("function checkoutGateOn()")) + 5;
  const context = { window: { LOOPD2C_OTP_GATE: false, LoopDeskConfig: { checkout: { showSecureBadge: true } } } };
  vm.runInNewContext(`${otp.slice(start, end)}; applyMerchantCheckoutGate(); this.read = () => checkoutInterceptionEnabled;`, context);
  assert.equal(context.read(), false);
  const embed = fs.readFileSync(new URL("../megaska-otp/blocks/megaska-otp-embed.liquid", import.meta.url), "utf8");
  assert.match(embed, /window\.LOOPD2C_OTP_GATE = payload\.config\.checkout\.otpGateEnabled;/);
  const drawer = read("loopdesk-cart-drawer.js");
  assert.match(drawer, /typeof checkout\.otpGateEnabled === "boolean" \? \{ otpGateEnabled: checkout\.otpGateEnabled \} : \{\}/);
});

test("the gate is re-read when the runtime config arrives and when interception starts", () => {
  assert.match(otp, /addEventListener\("loopdesk:runtime-config-ready", \(event\) => \{\n {4}applyMerchantCheckoutGate\(\);/);
  assert.match(otp, /checkoutInterceptionEnabled = opts\.enabled !== false;\n {4}applyMerchantCheckoutGate\(\);/);
});

test("with the gate off, the bag's checkout goes straight to Shopify Checkout for signed-out shoppers", () => {
  const body = otp.slice(otp.indexOf("async function beginGatedShopifyCheckout("), otp.indexOf("async function handleCheckoutTriggerClick("));
  assert.match(body, /if \(!checkoutGateOn\(\)\) \{\n {6}window\.location\.assign\("\/checkout"\);\n {6}return true;/);
  assert.ok(body.indexOf("gateState.authenticated && gateState.verifiedPhonePresent") < body.indexOf("!checkoutGateOn()"), "signed-in shoppers keep the prefilled hand-off");
});

test("every checkout decision re-reads the merchant setting", () => {
  assert.equal((otp.match(/if \(!checkoutInterceptionEnabled\)/g) || []).length, 0);
  assert.ok((otp.match(/if \(!checkoutGateOn\(\)\)/g) || []).length >= 4);
});

// Diagnostic logs (which included phone numbers and cart tokens) are off for shoppers.
// (loopdesk-cart-drawer.js has its own debugLog, gated by LOOPDESK_CART_DRAWER_DEBUG.)
for (const name of ["loopd2c-auth.js", "loopd2c-otp.js"]) {
  test(`${name} logs only when debugging is switched on`, () => {
    const source = read(name);
    assert.equal((source.match(/console\.(log|info|debug)\(/g) || []).length, 0, "no direct info logs");
    assert.equal((source.match(/[\w$.]debugLog\(/g) || []).length, 0, "debugLog is only ever called bare");
    const helper = source.match(/(?:const|var) debugLog = \(function \(\) \{[\s\S]*?\n {2}\}\)\(\);/);
    assert.ok(helper, "debugLog helper at the top of the file");
    const run = (search, stored) => {
      const logged = [];
      const context = {
        console: { log: (...args) => logged.push(args) },
        window: { location: { search }, localStorage: { getItem: (key) => (key === "loopd2c_debug" ? stored : null) } },
      };
      vm.runInNewContext(`${helper[0]}; debugLog("[x]", { phone: "+919876543210" });`, context);
      return logged.length;
    };
    assert.equal(run("", null), 0, "silent by default");
    assert.equal(run("?loopd2c_debug=1", null), 1, "on with ?loopd2c_debug=1");
    assert.equal(run("", "1"), 1, "on with localStorage.loopd2c_debug");
    const throwing = { console: { log() { throw new Error("should not log"); } }, window: { location: { search: "" }, get localStorage() { throw new Error("blocked"); } } };
    assert.doesNotThrow(() => vm.runInNewContext(`${helper[0]}; debugLog("x");`, throwing), "blocked storage stays silent");
  });
}
