import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const accountRoute = readFileSync("app/apps/megaska/account/route.ts", "utf8");
const assetRoute = readFileSync("app/apps/megaska/account/assets/[asset]/route.ts", "utf8");
const dashboardJs = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");

assert.match(accountRoute, /loopdesk-customer-dashboard-root/);
assert.match(accountRoute, /loopdesk-customer-dashboard-config/);
assert.match(accountRoute, /\/apps\/megaska\/api\/dashboard\/summary/);
assert.doesNotMatch(accountRoute, /vercel\.app|customer-account|sessionToken|accessToken|Admin token/i);
assert.ok(accountRoute.indexOf("megaska-auth.js") < accountRoute.indexOf("megaska-otp.js"));
assert.ok(accountRoute.indexOf("megaska-otp.js") < accountRoute.indexOf("loopdesk-customer-dashboard.js"));
assert.match(accountRoute, /Cache-Control.*no-store/s);

for (const asset of ["megaska-auth.js", "megaska-otp.js", "megaska-otp.css", "megaska_logo.png", "loopdesk-customer-dashboard.js", "loopdesk-customer-dashboard.css"]) {
  assert.match(assetRoute, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(assetRoute, /X-Content-Type-Options/);
assert.match(assetRoute, /nosniff/);
assert.match(assetRoute, /immutable/);
assert.match(assetRoute, /decodeURIComponent/);

assert.match(dashboardJs, /__LOOPDESK_CUSTOMER_DASHBOARD_INITIALIZED__/);
assert.match(dashboardJs, /LoopDeskCustomerDashboard\s*=\s*\{[^}]*boot,[^}]*refresh,[^}]*logout[^}]*\}/s);
assert.match(dashboardJs, /Authorization: `Bearer \$\{token\}`/);
assert.match(dashboardJs, /cache: "no-store"/);
assert.match(dashboardJs, /window\.MegaskaAuth\.getSessionToken|getSessionToken/);
assert.match(dashboardJs, /getToken/);
assert.match(dashboardJs, /getSession/);
assert.match(dashboardJs, /Please verify your mobile number to view your account/);
assert.match(dashboardJs, /data-megaska-open-login>Sign in/);
assert.doesNotMatch(dashboardJs, /openLogin|loginPromptOpen|MegaskaAuth\.openLogin|data-ld-login>Sign in/);
assert.match(dashboardJs, /megaska:auth-state-changed/);
assert.match(dashboardJs, /moneyMinor/);
assert.match(dashboardJs, /primaryShipment\(o\)/);
assert.match(dashboardJs, /shipmentsOf\(o\)/);
assert.match(dashboardJs, /safeUrl/);
assert.match(dashboardJs, /latestCancellationStatus/);
assert.match(dashboardJs, /exchangeProgress/);
assert.match(dashboardJs, /latestIssueStatus/);
assert.match(dashboardJs, /transactions/);
assert.doesNotMatch(dashboardJs, /dashboard\.v1|customer-dashboard\/v1|console\.log\(\"\[MEGASKA ACCOUNT\] dashboard data|megaska-ops-hub-exs1|requests\/(exchange|issue)/);
assert.match(dashboardJs, /requests\/cancellation/);
assert.match(dashboardJs, /Request cancellation/);

console.log("customer-dashboard-app-owned-ui tests passed");
