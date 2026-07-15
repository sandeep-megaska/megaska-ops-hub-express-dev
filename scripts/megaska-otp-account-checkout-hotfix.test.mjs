import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("extensions/megaska-otp/assets/megaska-otp.js", "utf8");
const launcher = readFileSync("extensions/megaska-otp/assets/loopdesk-account-launcher.js", "utf8");
const launcherLiquid = readFileSync("extensions/megaska-otp/blocks/loopdesk-account-launcher.liquid", "utf8");

const accountSelectors = source.match(/const ACCOUNT_TRIGGER_SELECTORS = \[([\s\S]*?)\n  \];/)?.[1] || "";
assert.match(accountSelectors, /\[data-megaska-open-login\]/, "explicit login trigger remains account intent");
assert.match(accountSelectors, /\[data-loopdesk-account-launcher\]/, "LoopDesk account launcher remains account intent");
assert.match(accountSelectors, /a\[href='\/account'\]/, "native /account link remains account intent");
assert.doesNotMatch(accountSelectors, /\[aria-label\*='account' i\]/, "generic account aria-label is not authoritative account intent");
assert.doesNotMatch(accountSelectors, /\[title\*='account' i\]/, "generic account title is not authoritative account intent");
assert.doesNotMatch(accountSelectors, /"\.icon-user"/, "unscoped .icon-user is not authoritative account intent");
assert.match(accountSelectors, /header \.iccl-user/, "theme visual account selector is constrained to header context");

const expressHelper = source.match(/function isExpressCheckoutIntent\(target\) \{([\s\S]*?)\n  \}/)?.[1] || "";
for (const selector of [
  "[data-megaska-express-checkout]",
  "[data-loopdesk-express-checkout]",
  "[data-express-checkout]",
  "[data-ld-express-checkout]",
  "[data-bag-action='checkout']",
  ".loopdesk-cart-drawer__express",
  "#megaska-place-order-btn",
]) {
  assert.ok(expressHelper.includes(selector), `express checkout helper includes ${selector}`);
}

const clickHandler = source.match(/document\.addEventListener\(\n      "click",\n      async \(event\) => \{([\s\S]*?)\n      \},\n      true\n    \);/)?.[1] || "";
const checkoutIndex = clickHandler.indexOf("const checkoutTrigger = inferCheckoutTriggerFromEvent(event)");
const addToCartIndex = clickHandler.indexOf("if (isAddToCartIntent(event.target))");
const expressIndex = clickHandler.indexOf("if (isExpressCheckoutIntent(event.target))");
const accountIndex = clickHandler.indexOf("const accountTrigger = findClosestMatchingElement(event, ACCOUNT_TRIGGER_SELECTORS)");
assert.ok(checkoutIndex > -1 && accountIndex > -1 && checkoutIndex < accountIndex, "checkout intent is resolved before account intent");
assert.ok(addToCartIndex > checkoutIndex && addToCartIndex < accountIndex, "add-to-cart bypass remains before account intent");
assert.ok(expressIndex > addToCartIndex && expressIndex < accountIndex, "express checkout is explicitly excluded before account intent");
assert.match(source, /if \(isExpressCheckoutIntent\(event\?\.target\) \|\| isCheckoutIntent\(event\?\.target\)\) \{\n    return;\n  \}/, "account handler has a checkout/express pending-action safeguard");
assert.match(source, /opts\.targetUrl \? \{ type: "navigate", url: opts\.targetUrl \}/, "checkout clicks create navigation continuation pending actions");
assert.match(source, /type: "account-redirect"/, "account redirect pending action still exists for account intents");
assert.match(source, /\[Megaska OTP\] account intent resolved/, "account intent diagnostic is present without customer data");

assert.match(source, /window\.__MEGASKA_OTP_GLOBAL_CLICK_BOUND__/, "global click listener uses a window-level duplicate binding guard");
assert.doesNotMatch(source, /let globalClickBound = false/, "module-local click guard is not the only duplicate guard");

assert.match(source, /OBSOLETE_MEGASKA_DASHBOARD_PATH = "\/apps\/megaska\/dashboard"/, "OTP runtime knows the obsolete dashboard route");
assert.match(source, /normalizedPath === OBSOLETE_MEGASKA_DASHBOARD_PATH/, "OTP account destination normalizes obsolete dashboard route");
assert.match(launcher, /OBSOLETE_DASHBOARD_PATH = "\/apps\/megaska\/dashboard"/, "account launcher normalizes obsolete dashboard route");
assert.match(launcherLiquid, /obsolete_dashboard_path = '\/apps\/megaska\/dashboard'/, "Liquid block normalizes stale configured dashboard route");

assert.match(source, /MegaskaOtpInternals/, "test/debug internals expose intent helpers");
assert.match(source, /isAddToCartIntent/, "add-to-cart intent helper remains available and unaffected");
assert.match(source, /ensureMegaskaAuthenticatedBeforeCheckout/, "normal Shopify checkout remains gated");

console.log("megaska OTP account/checkout hotfix tests passed");
