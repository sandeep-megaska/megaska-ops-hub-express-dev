import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const src=readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js","utf8");
test("exchange dialog uses server config, idempotency, payment handoff, and dashboard refresh",()=>{assert.match(src,/openExchange/); assert.match(src,/actions\/EXCHANGE/); assert.match(src,/exchangePayload/); assert.match(src,/PAYMENT_REQUIRED/); assert.match(src,/loadDashboard\(true\)/); assert.doesNotMatch(src,/ACTIVE_EXCHANGE_STATUSES/); assert.doesNotMatch(src,/REVERSE_PICKUP_FEE_PAISE/);});


test("request timeline renders in order details and refreshes via canonical dashboard",()=>{assert.match(src,/function requestTimeline/); assert.match(src,/Request Timeline/); assert.match(src,/No requests have been created for this order/); assert.match(src,/item\.events/); assert.match(src,/loadDashboard\(true\)/); assert.doesNotMatch(src,/api\("\/request-timeline/);});

test("dashboard 401 enters auth-required state and opens existing OTP without redirecting",()=>{assert.match(src,/authRequired:false/); assert.match(src,/function renderAuthRequired/); assert.match(src,/e\.status === 401/); assert.match(src,/state\.authRequired = true/); assert.match(src,/triggerExistingOtpLogin\(\)/); assert.match(src,/data-megaska-open-login/); assert.doesNotMatch(src,/\/account\/login/);});

test("dashboard request orchestration prevents auth pending loops and stale overwrites",()=>{assert.match(src,/dashboardRequest:null/); assert.match(src,/if \(state\.dashboardRequest\) return state\.dashboardRequest/); assert.match(src,/requestSeq/); assert.match(src,/seq !== state\.requestSeq/); assert.match(src,/finally\(function \(\) \{/); assert.doesNotMatch(src,/setInterval\(/);});

test("OTP auth success starts one dashboard refresh and ignores duplicate close events",()=>{assert.match(src,/megaska:auth-state-changed/); assert.match(src,/lastAuthRefreshAt/); assert.match(src,/now-state\.lastAuthRefreshAt<100\|\|state\.dashboardRequest/); assert.match(src,/loadDashboard\(true\)/);});

test("order-card action reasons are normalized and deduplicated without mutating eligibility",()=>{assert.match(src,/function normalizeReason/); assert.match(src,/function uniqueActionReasons/); assert.match(src,/typeof reason==="string"/); assert.match(src,/replace\(\/\\s\+\/g," "\)/); assert.match(src,/!out\.some/); assert.match(src,/reason\.trim\(\)/); assert.match(src,/ld-account-lock-reason/); assert.doesNotMatch(src,/delete a\.exchange/); assert.doesNotMatch(src,/delete a\.issue/);});
