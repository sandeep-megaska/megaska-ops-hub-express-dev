import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const src=readFileSync("app/api/customer-dashboard/v1/orders/[orderId]/actions/[actionType]/route.ts","utf8");
test("action config route supports exchange config securely",()=>{assert.match(src,/EXCHANGE_REASON_OPTIONS/); assert.match(src,/loadExchangeOrderLines/); assert.match(src,/currentExchangeFee/); assert.match(src,/Cache-Control", "private, no-store"/); assert.match(src,/customer_dashboard\.exchange\.form_viewed/);});
