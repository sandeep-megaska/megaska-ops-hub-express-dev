import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const css = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.css", "utf8");
const route = readFileSync("app/apps/megaska/account/route.ts", "utf8");
const proxy = readFileSync("app/apps/megaska/api/[...path]/route.ts", "utf8");
const assetRoute = readFileSync("app/apps/megaska/account/assets/[asset]/route.ts", "utf8");
const otpJs = readFileSync("extensions/megaska-otp/assets/megaska-otp.js", "utf8");
const otpCss = readFileSync("extensions/megaska-otp/assets/megaska-otp.css", "utf8");

test("dashboard asset uses SaaS-neutral guarded mount and public API", () => {
  assert.match(route, /loopdesk-customer-dashboard-root/);
  assert.match(js, /data-loopdesk-customer-dashboard/);
  assert.match(route, /LoopDeskCustomerDashboardConfig/);
});

test("canonical dashboard.v1 endpoint is used and legacy endpoint is not called", () => {
  assert.match(js, /customer-dashboard\/v1/);
  assert.doesNotMatch(js, /dashboard\/summary/);
  assert.match(js, /credentials:"include"/);
  assert.match(proxy, /customer-dashboard\/v1/);
});

test("read-only dashboard behaviors are represented", () => {
  for (const phrase of ["No default address saved.", "Store Credit", "Tracking will appear when available."]) {
    assert.ok(js.includes(phrase), phrase);
  }
  assert.doesNotMatch(js, /requestOtp\(|verifyOtp\(/);
});

test("security and URL constraints are enforced", () => {
  assert.match(js, /function safeUrl/);
  assert.match(js, /target:\"_blank\",rel:\"noopener\"/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
  assert.doesNotMatch(js, /https:\/\/megaska-ops-hub-exs1\.vercel\.app/);
  assert.doesNotMatch(route, /accessToken|Authorization|Bearer/);
});

test("CSS is theme isolated with prefixed classes and variables", () => {
  assert.match(css, /--ld-account-bg/);
  const classNames = [...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]).filter((name) => !name.startsWith("myshopify"));
  assert.ok(classNames.length > 20);
  for (const name of classNames) assert.ok(name.startsWith("ld-account-"), name);
});

test("App Proxy account route emits shell, config, assets and no-store headers", () => {
  assert.match(route, /requireStorefrontShopFromAppProxy/);
  assert.match(route, /loopdesk-customer-dashboard-root/);
  assert.match(route, /LoopDeskCustomerDashboardConfig/);
  assert.match(route, /megaska-otp\.css/);
  assert.match(route, /loopdesk-customer-dashboard\.css/);
  assert.match(route, /megaska-auth\.js["\\] defer><\/script><script src=["\\]\/apps\/megaska\/account\/assets\/megaska-otp\.js["\\] defer><\/script><script src=["\\]\/apps\/megaska\/account\/assets\/loopdesk-customer-dashboard\.js/);
  assert.doesNotMatch(route, /\/account\/login/);
  assert.doesNotMatch(route, /\/pages\/megaska-dashboard/);
  assert.match(route, /private, no-store/);
  assert.match(route, /customer_dashboard_shell_rendered/);
  assert.match(route, /customer_dashboard_shell_error/);
});


test("App Proxy account asset route serves strict OTP allowlist with content types", () => {
  assert.match(assetRoute, /"megaska-otp\.js": "application\/javascript; charset=utf-8"/);
  assert.match(assetRoute, /"megaska-otp\.css": "text\/css; charset=utf-8"/);
  assert.match(assetRoute, /basename\(asset \|\| ""\)/);
  assert.match(assetRoute, /if \(!contentType\) return new NextResponse\("Not found", \{ status: 404 \}\)/);
  assert.match(assetRoute, /extensions", "megaska-otp", "assets", name/);
  assert.match(assetRoute, /Cache-Control": "public, max-age=31536000, immutable"/);
  assert.match(assetRoute, /X-Content-Type-Options": "nosniff"/);
});

test("canonical OTP extension assets are present for app-owned serving", () => {
  assert.match(otpJs, /data-megaska-open-login/);
  assert.match(otpCss, /megaska-otp/);
});

test("dashboard handles unauthenticated app-owned login through OTP contract", () => {
  assert.match(js, /data-megaska-open-login/);
  assert.match(js, /data-account-destination/);
  assert.match(js, /\/apps\/megaska\/account/);
  assert.match(js, /e\.status === 401/);
  assert.match(js, /renderLoading\(\)/);
  assert.match(js, /megaska:auth-state-changed/);
  assert.match(js, /loadDashboard\(true\)/);
  assert.match(js, /setTimeout\(function\(\)\{loadDashboard\(\);\},250\)/);
  assert.doesNotMatch(js, /requestOtp\(/);
  assert.doesNotMatch(js, /verifyOtp\(/);
  assert.doesNotMatch(js, /\/account\/login/);
});
