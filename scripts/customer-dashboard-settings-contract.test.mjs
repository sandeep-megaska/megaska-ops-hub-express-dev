import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const js = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
test("dashboard asset uses runtime settings and no custom CSS input", () => { assert.match(js, /--ld-account-primary/); assert.match(js, /showWallet/); assert.match(js, /initialOrderLimit/); assert.match(js, /Show more/); assert.doesNotMatch(js, /customCSS|customCss|innerHTML/); assert.doesNotMatch(js, /LoopDeskCustomerDashboardConfig[^;]*megaska_session_token/s); });
test("theme overrides cannot enable server-hidden modules", () => { assert.match(readFileSync("services/customer-dashboard/settings-shared.ts", "utf8"), /out\.sections\[k\] = Boolean\(out\.sections\[k\] && ts\[k\]\)/); });
