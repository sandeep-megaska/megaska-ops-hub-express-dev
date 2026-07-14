import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const src=readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js","utf8");
test("exchange dialog uses server config, idempotency, payment handoff, and dashboard refresh",()=>{assert.match(src,/openExchange/); assert.match(src,/actions\/EXCHANGE/); assert.match(src,/exchangePayload/); assert.match(src,/PAYMENT_REQUIRED/); assert.match(src,/loadDashboard\(true\)/); assert.doesNotMatch(src,/ACTIVE_EXCHANGE_STATUSES/); assert.doesNotMatch(src,/REVERSE_PICKUP_FEE_PAISE/);});


test("request timeline renders in order details and refreshes via canonical dashboard",()=>{assert.match(src,/function requestTimeline/); assert.match(src,/Request Timeline/); assert.match(src,/No requests have been created for this order/); assert.match(src,/item\.events/); assert.match(src,/loadDashboard\(true\)/); assert.doesNotMatch(src,/api\("\/request-timeline/);});
