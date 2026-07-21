import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../megaska-otp/assets/megaska-otp.js", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} should be present before ${nextName}`);
  return source.slice(start, end);
}

test("native account interception is delegated and limited to entry routes", () => {
  const pathGuard = functionSource("isShopifyNativeAccountPath", "isNativeAccountIntentElement");
  const intentGuard = functionSource("isNativeAccountIntentElement", "getAccountTriggerActionElement");
  const clickBinding = functionSource("bindGlobalClickInterceptor", "bindSubmitDebugListener");

  assert.match(pathGuard, /normalizedPath === "\/account"/);
  assert.match(pathGuard, /normalizedPath === "\/account\/login"/);
  assert.match(pathGuard, /normalizedPath === "\/account\/register"/);
  assert.doesNotMatch(pathGuard, /logout|addresses|orders/);
  assert.match(intentGuard, /url\.origin === window\.location\.origin/);
  assert.match(clickBinding, /document\.addEventListener\([\s\S]*"click"/);
  assert.match(clickBinding, /isUsableAccountEntryTrigger\(accountTrigger\)/);
});

test("native desktop entry suppresses the delayed, idempotent fallback", () => {
  const reconciliation = functionSource("ensureAccountEntryFallbacks", "ensureDesktopAccountFallback");
  const scheduling = functionSource("scheduleAccountFallbackReconciliation", "bindAuthStateSync");

  assert.match(reconciliation, /hasVisibleNativeDesktopAccountEntry\(\)/);
  assert.match(reconciliation, /existingDesktopFallback[\s\S]*remove\(\)/);
  assert.match(reconciliation, /else \{\s*ensureDesktopAccountFallback\(\)/);
  assert.match(scheduling, /ACCOUNT_FALLBACK_DISCOVERY_DELAY_MS - elapsed/);
  assert.match(source, /if \(document\.getElementById\(ACCOUNT_FALLBACK_DESKTOP_ID\)\) return;/);
  assert.match(source, /new MutationObserver/);
});

test("account routing uses OTP pending intent and the LoopDesk dashboard resolver", () => {
  const handler = functionSource("handleAccountTriggerClick", "ensureMegaskaAuthenticatedBeforeCheckout");

  assert.match(handler, /hardBlockEvent\(event\)/);
  assert.match(handler, /resolveAccountDestinationUrl\(triggerEl\)/);
  assert.match(handler, /type: "account-redirect"/);
  assert.match(handler, /openModal\("account-intercept"\)/);
  assert.match(handler, /window\.location\.assign\(accountDestination\)/);
  assert.doesNotMatch(handler, /MegaskaExpressCheckout|openExpress|express-checkout/i);
  assert.match(source, /const DEFAULT_MEGASKA_DASHBOARD_URL = "\/apps\/megaska\/account"/);
});
