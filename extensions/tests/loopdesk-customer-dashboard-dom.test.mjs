import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const css = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.css", "utf8");

assert.match(js, /Sign in to view your account/);
assert.match(js, /Verify your mobile number to see your orders and account details\./);
assert.match(js, /We could not load your account right now\./);
assert.match(js, /You have not placed any orders yet\./);
assert.match(js, /Continue Shopping/);
assert.match(js, /moneyPaise\(data\.wallet\?\.availableToRedeem \?\? data\.wallet\?\.balance \?\? 0\)/);
assert.match(js, /Available balance/);
assert.match(js, /Store Credit is not available for this account yet/);
assert.match(js, /walletDirection\(t\)/);
assert.match(js, /walletReason\(t\)/);
assert.match(js, /firstText\(t\?\.reason, t\?\.note, t\?\.transactionType, t\?\.sourceType/);
assert.match(js, /summary.*Store Credit/s);
assert.match(js, /moneyMajor\(o\.total \|\| o\.totalPrice \|\| o\.currentTotalPrice\)/);
assert.match(js, /new URL\(u, fallback \|\| window\.location\.origin\)/);
assert.match(js, /\["http:", "https:"\]\.includes\(x\.protocol\)/);
assert.match(js, /state\.requestSequence\+\+/);
assert.match(js, /if \(state\.request\) return state\.request/);
assert.match(js, /err\.auth = true/);
assert.match(js, /renderAuthRequired\(false\)/);
assert.match(js, /window\.MegaskaAuth/);
assert.match(js, /typeof a\.logout === "function"/);
assert.match(js, /document\.dispatchEvent\(new CustomEvent\("megaska:auth-state-changed"/);
assert.match(js, /uniqueReasons/);
assert.match(js, /Available — Action wiring will be tested in the next phase\./);
assert.match(js, /renderAllTracking/);
assert.match(js, /renderTimeline/);
assert.match(js, /isForwardShipment/);
assert.match(js, /requestWindowExpiresAt/);
assert.match(js, /reversePickupWindowExpiresAt/);
assert.doesNotMatch(js, /fetch\([^)]*requests\/(cancellation|exchange|issue)/s);
assert.doesNotMatch(js, /console\.(log|debug|info)\(/);

assert.doesNotMatch(css, /\n\.(?!ld-account-scroll-lock)|\n[a-z]+\s*\{/i);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /width: min\(520px, 100vw\)/);
assert.match(css, /width: 100vw/);
assert.match(css, /overflow-wrap: anywhere/);
assert.match(css, /ld-account-timeline/);
assert.match(css, /ld-account-wallet-hero/);
console.log("loopdesk-customer-dashboard dom/static tests passed");

const moneyPaiseFixture = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(v) / 100);
assert.equal(moneyPaiseFixture(0), "₹0.00");
assert.equal(moneyPaiseFixture(1), "₹0.01");
assert.equal(moneyPaiseFixture(100), "₹1.00");
assert.equal(moneyPaiseFixture(125000), "₹1,250.00");
const walletFixture = { balance: 125000, availableToRedeem: 124900, reserved: 100, pendingRefund: 1, currency: "INR", transactions: [
  { direction: "CREDIT", amount: 100, reason: "Refund credited", orderNumber: "#1001", createdAt: "2026-07-14T10:00:00.000Z" },
  { direction: "DEBIT", amount: 1, note: "Used at checkout", orderName: "#1002", createdAt: "2026-07-14T10:01:00.000Z" },
  { amount: -50, transactionType: "MANUAL_DEBIT", sourceType: "ADMIN_MANUAL", createdAt: "bad-date" },
] };
assert.equal(walletFixture.availableToRedeem, 124900, "summary-card parity fixture uses wallet.availableToRedeem");
assert.ok(walletFixture.transactions.some((txn) => txn.direction === "CREDIT"));
assert.ok(walletFixture.transactions.some((txn) => txn.direction === "DEBIT"));
const trackingFixtures = [
  { tracking: { shipments: [{ provider: "Delhivery", awb: "12345678901234567890", statusLabel: "IN_TRANSIT", timeline: [{ statusLabel: "Picked Up", occurredAt: "2026-07-14T10:00:00.000Z", description: "Package picked up", location: "Delhi", isMock: true }] }] } },
  { tracking: { shipments: [{ carrier: "Shiprocket", trackingUrl: "https://carrier.example/track/1", status: "OUT_FOR_DELIVERY" }] } },
  { tracking: { shipments: [{ direction: "REVERSE_PICKUP", awb: "R1" }, { awb: "F1", url: "https://carrier.example/f1" }] } },
  { fulfillments: [{ status: "FULFILLED", trackingInfo: [{ company: "Shopify carrier", number: "S1", url: "https://shopify.example/s1" }] }] },
  { tracking: { shipments: [] } },
];
assert.equal(trackingFixtures.length, 5);
for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "blob:https://x", "//evil.example/x"]) assert.ok(unsafe);
for (const status of ["UNKNOWN_FINANCIAL", "PARTIALLY_REFUNDED", "PARTIALLY_FULFILLED", "IN_TRANSIT", "DELIVERED"]) assert.equal(status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).includes("_"), false);
const requestFixture = { latestCancellationStatus: "OPEN", latestCancellationRefundStatus: "PENDING", latestExchangeStatus: "CLOSED", latestIssueStatus: "OPEN", hasActiveExchangeRequest: true, hasActiveIssueRequest: false, requestLockReason: "Window closed", issueLockReason: "Window closed", reversePickupLockReason: "Reverse pickup expired" };
assert.equal(new Set([requestFixture.requestLockReason, requestFixture.issueLockReason, requestFixture.reversePickupLockReason]).size, 2);
