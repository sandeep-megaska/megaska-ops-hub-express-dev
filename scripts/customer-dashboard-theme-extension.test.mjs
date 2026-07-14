import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync("extensions/megaska-otp/blocks/loopdesk-account-launcher.liquid", "utf8");
const inline = readFileSync("extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid", "utf8");
const launcherJs = readFileSync("extensions/megaska-otp/assets/loopdesk-account-launcher.js", "utf8");

assert.match(launcher, /data-loopdesk-account-launcher/);
assert.match(launcher, /logged_out_label/);
assert.match(launcher, /logged_in_label/);
assert.match(launcher, /dashboard_url/);
assert.doesNotMatch(launcher, /\bcustomer\b/);
assert.doesNotMatch(launcher, /token/i);
assert.match(launcherJs, /MegaskaAuth/);
assert.match(launcherJs, /megaska_session_token/);
assert.match(launcherJs, /openLogin/);
assert.match(launcherJs, /window\.location\.href/);
assert.doesNotMatch(launcherJs, /dashboard\/summary/);

assert.match(inline, /data-loopdesk-customer-dashboard/);
assert.match(inline, /loopdesk-customer-dashboard-config/);
assert.match(inline, /\/apps\/megaska\/api\/dashboard\/summary/);
assert.match(inline, /request\.design_mode/);
assert.match(inline, /Verified customers will see their profile, orders, Store Credit, tracking, and request statuses here\./);
assert.match(inline, /loopdesk-customer-dashboard\.css/);
assert.match(inline, /loopdesk-customer-dashboard\.js/);
assert.doesNotMatch(inline, /sessionToken|accessToken|customer\.id|vercel\.app/);

console.log("customer-dashboard-theme-extension tests passed");
