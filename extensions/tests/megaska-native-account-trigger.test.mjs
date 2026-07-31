import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../megaska-otp/assets/loopd2c-otp.js", import.meta.url),
  "utf8"
);

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} should be present before ${nextName}`);
  return source.slice(start, end);
}

class RuntimeAnchor {
  constructor(attributes) {
    this.attributes = new Map(Object.entries(attributes));
    this.listeners = new Map();
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  closest(selector) {
    return this.matches(selector) ? this : null;
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const candidate = part.trim();
      if (candidate === "a") return true;
      if (candidate === "button" || candidate === "[role='button']") return false;
      if (candidate.startsWith("#")) return this.getAttribute("id") === candidate.slice(1);
      const attribute = candidate.match(/^\[([^\]]+)\]$/)?.[1];
      return attribute ? this.hasAttribute(attribute) : false;
    });
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async click() {
    const event = {
      target: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.propagationStopped = true; },
    };
    await this.listeners.get("click")?.(event);
    return event;
  }
}

function buildAccountTriggerGuard() {
  const guardSource = source.slice(
    source.indexOf("function getAccountTriggerActionElement("),
    source.indexOf("function resolveAccountDestinationUrl(")
  );
  return new Function(
    "window",
    "DEFAULT_MEGASKA_DASHBOARD_URL",
    "resolveAccountDestinationUrl",
    `${guardSource}; return isUsableAccountEntryTrigger;`
  )(
    { location: { origin: "https://shop.example" } },
    "/apps/loopd2c/account",
    () => "/apps/loopd2c/account"
  );
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

// ACCOUNT-UNIVERSAL-1: merchants can supply an escape-hatch CSS selector for
// themes whose account icon markup doesn't match any known naming
// convention, icon glyph text counts as a positive signal for icon-only
// triggers, and the whole feature can be disabled per merchant.
test("account detection supports a custom selector, icon glyphs, and an enable flag", () => {
  const clickBinding = functionSource("bindGlobalClickInterceptor", "bindSubmitDebugListener");

  assert.match(clickBinding, /isAccountDashboardRedirectEnabled\(\) \? findAccountTrigger\(event\) : null/);
  assert.match(source, /function getAccountCustomTriggerSelector\(\)[\s\S]*try \{[\s\S]*document\.querySelectorAll\(trimmed\);[\s\S]*return trimmed;[\s\S]*catch \{[\s\S]*return "";/);
  assert.match(source, /function isAccountDashboardRedirectEnabled\(\)[\s\S]*dashboardRedirectEnabled;[\s\S]*return value !== false;/);
  assert.match(source, /function accountIconGlyphText\(element\)[\s\S]*querySelectorAll\("use"\)[\s\S]*getAttribute\("href"\) \|\| [\s\S]*getAttribute\("xlink:href"\)/);
  assert.match(source, /function findAccountTrigger\(event\)[\s\S]*const customSelector = getAccountCustomTriggerSelector\(\);[\s\S]*target\.closest\(customSelector\)/);
  assert.match(source, /merchantConfigDestination = String\(window\?\.LoopDeskConfig\?\.account\?\.dashboardPath \|\| ""\)\.trim\(\)/);
  assert.match(source, /if \(isAccountDashboardRedirectEnabled\(\)\) \{\s*observeDesktopAccountContainer\(\);\s*bindAccountFallbackObserver\(\);/);
});

// ACCOUNT-UNIVERSAL-2: themes whose header markup doesn't match any of the
// hardcoded DESKTOP_ACCOUNT_CONTAINER_SELECTORS (e.g. custom-element header
// architectures like <header-actions>) must still get a fallback icon, by
// deriving the insertion container from a reliably-detected cart/search icon.
test("desktop account fallback derives its container structurally when no known theme container matches", () => {
  const containerResolution = functionSource("getStructuralAccountContainer", "getDesktopAccountContainer");
  assert.match(containerResolution, /HEADER_ICON_REFERENCE_SELECTORS\[kind\]/);
  assert.match(containerResolution, /isInMobileContext\(candidate\)/);
  assert.match(containerResolution, /getAccountTriggerActionElement\(candidate\)/);
  assert.match(source, /return getStructuralAccountContainer\(\);\s*\}/);
});

test("native desktop entry suppresses the delayed, idempotent fallback", () => {
  const reconciliation = functionSource("ensureAccountEntryFallbacks", "ensureDesktopAccountFallback");
  const scheduling = functionSource("scheduleAccountFallbackReconciliation", "bindAuthStateSync");

  assert.match(reconciliation, /hasVisibleNativeDesktopAccountEntry\(\)/);
  assert.match(reconciliation, /existingDesktopFallback[\s\S]*remove\(\)/);
  assert.match(reconciliation, /else \{\s*ensureDesktopAccountFallback\(\)/);
  assert.match(scheduling, /ACCOUNT_FALLBACK_DISCOVERY_DELAY_MS - elapsed/);
  assert.match(source, /const existingFallback = document\.getElementById\(ACCOUNT_FALLBACK_DESKTOP_ID\)/);
  assert.match(source, /if \(existingFallback\)[\s\S]*return;/);
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
  assert.match(source, /const DEFAULT_MEGASKA_DASHBOARD_URL = "\/apps\/loopd2c\/account"/);
});

test("desktop LoopDesk fallback dispatches to OTP before navigation and routes authenticated customers", async () => {
  const isUsableAccountEntryTrigger = buildAccountTriggerGuard();
  const fallback = new RuntimeAnchor({
    id: "megaska-account-fallback-desktop",
    href: "/apps/loopd2c/account",
    "data-megaska-open-login": "1",
    "data-megaska-fallback-account": "desktop",
    "aria-label": "My account",
  });
  assert.equal(isUsableAccountEntryTrigger(fallback), true);

  let authenticated = false;
  let handlerCalls = 0;
  let pendingAction = null;
  const modalSources = [];
  const navigations = [];
  const handlerSource = functionSource(
    "handleAccountTriggerClick",
    "ensureMegaskaAuthenticatedBeforeCheckout"
  );
  const handleAccountTriggerClick = new Function(
    "hardBlockEvent",
    "getMegaskaCheckoutGateState",
    "resolveAccountDestinationUrl",
    "setPendingAction",
    "openModal",
    "handlePromptFallback",
    "hideAccountMenu",
    "window",
    `async ${handlerSource.replace(/async\s*$/, "")}; return handleAccountTriggerClick;`
  )(
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    async () => ({ authenticated, verifiedPhonePresent: authenticated }),
    () => "/apps/loopd2c/account",
    (action) => { pendingAction = action; },
    (modalSource) => { modalSources.push(modalSource); },
    async () => {},
    () => {},
    { location: { assign: (destination) => navigations.push(destination) } }
  );

  fallback.addEventListener("click", async (event) => {
    if (!isUsableAccountEntryTrigger(fallback)) return;
    handlerCalls += 1;
    await handleAccountTriggerClick(event, fallback);
  });

  const guestClick = await fallback.click();
  assert.equal(handlerCalls, 1, "the delegated account handler should be reached");
  assert.equal(guestClick.defaultPrevented, true);
  assert.deepEqual(modalSources, ["account-intercept"]);
  assert.equal(pendingAction.type, "account-redirect");
  assert.equal(pendingAction.accountDestination, "/apps/loopd2c/account");
  assert.deepEqual(navigations, [], "guest navigation must wait for OTP verification");

  authenticated = true;
  await fallback.click();
  assert.equal(handlerCalls, 2);
  assert.deepEqual(modalSources, ["account-intercept"], "OTP must not reopen for a session");
  assert.deepEqual(navigations, ["/apps/loopd2c/account"]);
});

test("LoopDesk-owned destinations reject logout, cross-origin, and unrelated proxy routes", () => {
  const isUsableAccountEntryTrigger = buildAccountTriggerGuard();
  const ownedAnchor = (href) => new RuntimeAnchor({
    href,
    "data-megaska-open-login": "1",
    "data-megaska-fallback-account": "desktop",
  });

  assert.equal(isUsableAccountEntryTrigger(ownedAnchor("/account/logout")), false);
  assert.equal(isUsableAccountEntryTrigger(ownedAnchor("https://attacker.example/apps/loopd2c/account")), false);
  assert.equal(isUsableAccountEntryTrigger(ownedAnchor("/apps/loopd2c/unrelated")), false);
  assert.equal(isUsableAccountEntryTrigger(ownedAnchor("javascript:alert(1)")), false);

  const accountCode = `${functionSource("isSafeLoopDeskAccountDestination", "isUsableAccountEntryTrigger")}\n${functionSource("handleAccountTriggerClick", "ensureMegaskaAuthenticatedBeforeCheckout")}`;
  assert.doesNotMatch(accountCode, /MegaskaExpressCheckout|openExpress|express-checkout/i);
});
