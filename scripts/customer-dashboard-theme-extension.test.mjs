import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const launcherBlock = "extensions/megaska-otp/blocks/loopdesk-account-launcher.liquid";
const dashboardBlock = "extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid";
const launcherJsPath = "extensions/megaska-otp/assets/loopdesk-account-launcher.js";
const dashboardJsPath = "extensions/megaska-otp/assets/loopdesk-customer-dashboard.js";
const legacyPath = "extensions/megaska-otp/assets/megaska-auth.js";
const launcher = readFileSync(launcherJsPath, "utf8");
const launcherLiquid = readFileSync(launcherBlock, "utf8");
const dashboardLiquid = readFileSync(dashboardBlock, "utf8");
const dashboard = readFileSync(dashboardJsPath, "utf8");
const legacy = readFileSync(legacyPath, "utf8");

test("extension block and asset files exist", () => {
  for (const file of [launcherBlock, dashboardBlock, launcherJsPath, "extensions/megaska-otp/assets/loopdesk-account-launcher.css"]) assert.ok(existsSync(file), file);
});

test("launcher uses LoopDesk auth state and OTP login handoff, not Shopify customer state", () => {
  assert.match(launcher, /window\.MegaskaAuth/);
  assert.match(launcher, /getSessionToken|getToken|getSession|fetchSession/);
  assert.match(launcher, /openLogin|openOtpModal|openAuthModal|login/);
  assert.doesNotMatch(launcher + launcherLiquid, /customer\.logged_in|Shopify\.customer|\/account\/login/);
});

test("launcher navigation preserves safe return paths and configurable app proxy dashboard URL", () => {
  assert.match(launcherLiquid, /"dashboardUrl":\{\{ dashboard_url \| json \}\}/);
  assert.match(launcher, /isSafeReturnPath/);
  assert.match(launcher, /origin!==window\.location\.origin/);
  assert.match(launcher, /returnUrl/);
  assert.match(launcher, /window\.location\.assign\(cfg\.dashboardUrl\)/);
});

test("dashboard mount emits required root, JSON config, canonical assets, and no legacy API", () => {
  assert.match(dashboardLiquid, /id="\{\{ mount_id \}\}" data-loopdesk-customer-dashboard/);
  assert.match(dashboardLiquid, /type="application\/json" data-loopdesk-customer-dashboard-config/);
  assert.match(dashboardLiquid, /loopdesk-customer-dashboard\.css/);
  assert.match(dashboardLiquid, /loopdesk-customer-dashboard\.js/);
  assert.match(dashboardLiquid, /customer-dashboard\/v1/);
  assert.doesNotMatch(dashboardLiquid, /dashboard\/summary/);
});

test("security contract avoids secrets, hardcoded origins, request submissions, and unsafe script settings", () => {
  for (const source of [launcher, launcherLiquid, dashboardLiquid, dashboard]) {
    assert.doesNotMatch(source, /vercel\.app|myshopify\.com|accessToken|shopifyAccessToken|Bearer.*\{\{/i);
    assert.doesNotMatch(source, /requests\/(cancellation|exchange|issue)|method:\s*["']POST["']/);
  }
});

test("theme isolation, accessibility, and preview contracts are present", () => {
  assert.match(launcherLiquid, /ld-account-launcher/);
  assert.match(dashboardLiquid, /ld-account-mount/);
  assert.match(launcherLiquid, /aria-busy|aria-live|aria-label/);
  assert.match(dashboardLiquid, /data-loopdesk-theme-editor-preview/);
  assert.match(dashboard, /Shopify&&window\.Shopify\.designMode/);
});

test("duplicate initialization and duplicate dashboard mounts are guarded", () => {
  assert.match(launcher, /__LOOPDESK_ACCOUNT_LAUNCHER_INITIALIZED__/);
  assert.match(dashboard, /__LOOPDESK_CUSTOMER_DASHBOARD_INITIALIZED__/);
  assert.match(dashboard, /data-loopdesk-dashboard-duplicate/);
});

test("dashboard asset reads JSON config and performs one canonical fetch per load", () => {
  assert.match(dashboard, /data-loopdesk-customer-dashboard-config/);
  const fetches = [...dashboard.matchAll(/fetch\(/g)].length;
  assert.equal(fetches, 1);
  assert.match(dashboard, /apiUrl/);
});

test("legacy dashboard asset remains present and legacy summary API compatibility remains", () => {
  assert.match(legacy, /fetchDashboardSummary/);
  assert.match(legacy, /\/dashboard\/summary/);
});
