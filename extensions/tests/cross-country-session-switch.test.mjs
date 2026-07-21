import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const auth = readFileSync(new URL("../megaska-otp/assets/megaska-auth.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../megaska-otp/assets/loopdesk-customer-dashboard.js", import.meta.url), "utf8");

test("OTP success replaces browser storage before publishing the new identity", () => {
  assert.match(auth, /if \(token\) \{[\s\S]*?clearSessionToken\(\);[\s\S]*?setSessionToken\(token\);/);
  assert.match(auth, /identityReplaced:\s*session\.authenticated\s*&&\s*identityReplacementPending/);
  assert.match(auth, /customerProfileId:\s*session\.customer\?\.id/);
});

test("dashboard aborts an old identity request and refetches after session replacement", () => {
  const handler = dashboard.slice(dashboard.indexOf("function handleAuthStateChanged"), dashboard.indexOf("function resolveLogoutRedirect"));
  assert.match(handler, /detail\.identityReplaced/);
  assert.match(handler, /abortDashboardRequest\(\)/);
  assert.match(handler, /clearCustomer\(\)/);
  assert.match(handler, /handleAuthenticatedState\(\)/);
});
