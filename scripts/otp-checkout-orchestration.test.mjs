import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-checkout-bridge.js", import.meta.url), "utf8");

function body(name, nextName) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\s*\\}\\n\\s*(?:async )?function ${nextName}`));
  assert.ok(match, `${name} should be present before ${nextName}`);
  return match[0];
}

test("LoopDesk Express Checkout stores intent and authenticates before readiness", () => {
  const handler = body("openDrawerOtp", "continueExpressCheckout") + body("continueExpressCheckout", "open");
  assert.match(source, /closest\(event\.target, '\[data-loopdesk-express-checkout\]'\)/);
  assert.match(source, /setPendingExpressCheckoutIntent\(source\);[\s\S]*if \(hasMegaskaSessionToken\(\)\)[\s\S]*continueExpressCheckout\(source\);[\s\S]*openDrawerOtp\(\)/);
  assert.doesNotMatch(source, /!isExpressCheckoutReady\(\)\) return;[\s\S]{0,300}openDrawerOtp/);
  assert.match(handler, /resolveExpressCheckoutReadiness\(\)/);
});

test("OTP success dispatches only the pending Express Checkout continuation", () => {
  assert.match(source, /var intent = getPendingIntent\(\);[\s\S]*intent\.type !== 'express_checkout'[\s\S]*hasMegaskaSessionToken\(\)[\s\S]*continueExpressCheckout\(intent\.source \+ '-auth-resume'\)/);
});

test("readiness is refreshed before either modal or Shopify fallback", () => {
  const continuation = body("continueExpressCheckout", "open");
  assert.match(source, /_loopdesk_checkout_readiness=/);
  assert.ok(continuation.indexOf("await resolveExpressCheckoutReadiness()") < continuation.indexOf("window.location.assign(FALLBACK_URL)"));
  assert.ok(continuation.indexOf("await resolveExpressCheckoutReadiness()") < continuation.indexOf("MegaskaExpressCheckout.open"));
  assert.match(continuation, /clearPendingIntent\(\);[\s\S]*window\.location\.assign\(FALLBACK_URL\)/);
});
