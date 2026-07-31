import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const launcher = readFileSync("extensions/megaska-otp/blocks/loopdesk-account-launcher.liquid", "utf8");
const inline = readFileSync("extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid", "utf8");
const launcherJs = readFileSync("extensions/megaska-otp/assets/loopdesk-account-launcher.js", "utf8");

assert.match(launcher, /data-loopdesk-account-launcher/);
assert.match(launcher, /logged_out_label/);
assert.match(launcher, /logged_in_label/);
assert.match(launcher, /configured_dashboard_url/);
assert.match(launcher, /configured_dashboard_url == blank/);
assert.match(launcher, /obsolete_dashboard_path = '\/apps\/loopd2c\/dashboard'/);
assert.ok(launcher.includes("configured_dashboard_path = configured_dashboard_url | split: '?' | first | split: '#' | first"));
assert.match(launcher, /permanent_shop_https_origin = 'https:\/\/' \| append: shop\.permanent_domain/);
assert.match(launcher, /display_shop_https_origin = 'https:\/\/' \| append: shop\.domain/);
assert.match(launcher, /data-dashboard-url="\{\{ dashboard_url \| escape \}\}"/);
assert.doesNotMatch(launcher, /configured_dashboard_url contains/);
assert.doesNotMatch(launcher, /\bcustomer\b/);
assert.doesNotMatch(launcher, /token/i);
assert.match(launcherJs, /MegaskaAuth/);
assert.match(launcherJs, /megaska_session_token/);
assert.match(launcherJs, /openLogin/);
assert.match(launcherJs, /resolveDashboardUrl/);
assert.match(launcherJs, /window\.location\.href = dashboardUrl/);
assert.match(launcherJs, /window\.open\(dashboardUrl, "_blank", "noopener"\)/);
assert.doesNotMatch(launcherJs, /dashboard\/summary/);
assert.doesNotMatch(launcherJs, /window\.location\.href = el\.dataset\.dashboardUrl/);
assert.doesNotMatch(launcherJs, /window\.open\(el\.dataset\.dashboardUrl/);

function createElement({ dashboardUrl = "", sameTab = "true" } = {}) {
  let clickHandler;
  return {
    dataset: {
      dashboardUrl,
      sameTab,
      loggedInLabel: "My Account",
      loggedOutLabel: "Login",
    },
    classList: { toggle() {} },
    querySelector() { return { textContent: "" }; },
    addEventListener(type, handler) {
      if (type === "click") clickHandler = handler;
    },
    click() {
      clickHandler?.({ preventDefault() {} });
    },
  };
}

function runLauncher({ element, token = "token" } = {}) {
  const listeners = new Map();
  const opened = [];
  const fallbackClick = { clicked: false, click() { this.clicked = true; } };
  const context = {
    URL,
    localStorage: { getItem() { return token; } },
    window: {
      location: { origin: "https://shop.example", href: "https://shop.example/" },
      open(...args) { opened.push(args); },
      MegaskaAuth: {
        getSessionToken() { return token; },
        openLogin() { fallbackClick.clicked = true; },
      },
    },
    document: {
      readyState: "loading",
      addEventListener(type, handler) { listeners.set(type, handler); },
      querySelectorAll(selector) { return selector === "[data-loopdesk-account-launcher]" && element ? [element] : []; },
      querySelector(selector) { return selector === "[data-megaska-open-login]" ? fallbackClick : null; },
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  vm.runInNewContext(launcherJs, context);
  listeners.get("DOMContentLoaded")?.();
  return { context, opened, fallbackClick };
}

{
  const { context } = runLauncher({ token: "" });
  const resolve = context.window.LoopDeskAccountLauncher.resolveDashboardUrl;
  assert.equal(resolve(undefined), "/apps/loopd2c/account", "no configured value falls back");
  assert.equal(resolve("/apps/loopd2c/account"), "/apps/loopd2c/account", "account route is unchanged");
  assert.equal(resolve("/apps/loopd2c/dashboard"), "/apps/loopd2c/account", "obsolete relative route is corrected");
  assert.equal(resolve("https://shop.example/apps/loopd2c/dashboard"), "/apps/loopd2c/account", "absolute same-store obsolete route is corrected");
  assert.equal(resolve("/pages/my-account"), "/pages/my-account", "valid theme page route is preserved");
  assert.equal(resolve("https://evil.example/apps/loopd2c/account"), "/apps/loopd2c/account", "external URLs are rejected");
  assert.equal(resolve("//evil.example/apps/loopd2c/account"), "/apps/loopd2c/account", "protocol-relative URLs are rejected");
  assert.equal(resolve("   "), "/apps/loopd2c/account", "blank URL falls back");
}

{
  const element = createElement({ dashboardUrl: "/pages/my-account", sameTab: "true" });
  const { context } = runLauncher({ element, token: "token" });
  element.click();
  assert.equal(context.window.location.href, "/pages/my-account", "logged-in same-tab account-icon click navigates");
}

{
  const element = createElement({ dashboardUrl: "/apps/loopd2c/account", sameTab: "true" });
  const { fallbackClick } = runLauncher({ element, token: "" });
  element.click();
  assert.equal(fallbackClick.clicked, true, "logged-out account-icon click opens OTP");
}

{
  const element = createElement({ dashboardUrl: "/apps/loopd2c/dashboard", sameTab: "false" });
  const { opened } = runLauncher({ element, token: "token" });
  element.click();
  assert.deepEqual(opened[0], ["/apps/loopd2c/account", "_blank", "noopener"], "new-tab navigation uses corrected route");
}

{
  const element = createElement({ dashboardUrl: "", sameTab: "true" });
  const { context } = runLauncher({ element, token: "token" });
  element.click();
  assert.equal(context.window.location.href, "/apps/loopd2c/account", "mobile fallback account link uses fallback route");
}

{
  const element = createElement({ dashboardUrl: "/apps/loopd2c/dashboard", sameTab: "true" });
  const { context } = runLauncher({ element, token: "token" });
  element.click();
  assert.equal(context.window.location.href, "/apps/loopd2c/account", "existing saved Shopify obsolete route is corrected");
}

assert.match(inline, /data-loopdesk-customer-dashboard/);
assert.match(inline, /loopdesk-customer-dashboard-config/);
assert.match(inline, /\/apps\/loopd2c\/api\/dashboard\/summary/);
assert.match(inline, /request\.design_mode/);
assert.match(inline, /Verified customers will see their profile, orders, Store Credit, tracking, and request statuses here\./);
assert.match(inline, /loopdesk-customer-dashboard\.css/);
assert.match(inline, /loopdesk-customer-dashboard\.js/);
assert.doesNotMatch(inline, /sessionToken|accessToken|customer\.id|vercel\.app/);

console.log("customer-dashboard-theme-extension tests passed");
