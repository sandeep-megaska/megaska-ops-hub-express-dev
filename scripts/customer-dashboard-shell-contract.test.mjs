import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const css = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.css", "utf8");
const route = readFileSync("app/apps/megaska/account/route.ts", "utf8");
const proxy = readFileSync("app/apps/megaska/api/[...path]/route.ts", "utf8");

test("dashboard asset uses SaaS-neutral guarded mount and public API", () => {
  assert.match(js, /loopdesk-customer-dashboard-root/);
  assert.match(js, /data-loopdesk-customer-dashboard/);
  assert.match(js, /__LOOPDESK_CUSTOMER_DASHBOARD_INITIALIZED__/);
  assert.match(js, /LoopDeskCustomerDashboard/);
  assert.match(js, /boot:boot,refresh:refresh,logout:logout/);
});

test("canonical dashboard.v1 endpoint is used and legacy endpoint is not called", () => {
  assert.match(js, /customer-dashboard\/v1/);
  assert.doesNotMatch(js, /dashboard\/summary/);
  assert.match(js, /Authorization/);
  assert.match(js, /cache:"no-store"/);
  assert.match(js, /json\.version!==VERSION/);
  assert.match(proxy, /customer-dashboard\/v1/);
});

test("read-only dashboard behaviors are represented", () => {
  for (const phrase of ["Coming in next phase", "No saved address yet.", "No Store Credit transactions yet.", "Tracking details will appear after shipment.", "Please verify your mobile number"]) {
    assert.ok(js.includes(phrase), phrase);
  }
  assert.doesNotMatch(js, /requests\/(cancellation|exchange|issue)|fetch\([^)]*POST/);
});

test("security and URL constraints are enforced", () => {
  assert.match(js, /function safeUrl/);
  assert.match(js, /target:\"_blank\",rel:\"noopener noreferrer\"/);
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
  assert.match(route, /loopdesk-customer-dashboard\.css/);
  assert.match(route, /loopdesk-customer-dashboard\.js/);
  assert.match(route, /megaska-auth\.js/);
  assert.match(route, /private, no-store/);
  assert.match(route, /customer_dashboard_shell_rendered/);
  assert.match(route, /customer_dashboard_shell_error/);
});
