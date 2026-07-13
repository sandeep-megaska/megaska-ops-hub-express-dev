import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { CustomerDashboardError } from "./errors.ts";
import { buildDashboardWalletDto, loadDashboardWalletSnapshot, normalizeDashboardWalletTransaction, resetDashboardWalletDependenciesForTest, setDashboardWalletDependenciesForTest } from "./wallet.ts";

const context = { shopId: "shop-1", shopDomain: "s.myshopify.com", customerProfileId: "cust-1", sessionId: "sess-1" };
afterEach(() => resetDashboardWalletDependenciesForTest());

test("disabled wallet returns null and does not load account", async () => {
  let called = false;
  setDashboardWalletDependenciesForTest({ getOrCreateWalletAccount: async () => { called = true; throw new Error("no"); } });
  assert.equal(await loadDashboardWalletSnapshot({ context, enabled: false }), null);
  assert.equal(called, false);
});

test("wallet account, transactions, reservations are scoped and available balance is reservation-aware", async () => {
  const calls = [];
  setDashboardWalletDependenciesForTest({
    getOrCreateWalletAccount: async (...args) => { calls.push(["account", args]); return { currentBalance: 1000, currency: "INR" }; },
    listWalletTransactions: async (...args) => { calls.push(["tx", args]); return [{ id: "tx-1", direction: "DEBIT", amount: 300, currency: "INR", transactionType: "CHECKOUT_REDEMPTION", orderNumber: null, createdAt: new Date("2026-01-01T00:00:00Z") }]; },
    queryRaw: async (query) => { calls.push(["reservation", query]); return [{ total: 700 }]; },
  });
  const snap = await loadDashboardWalletSnapshot({ context, enabled: true, transactionLimit: 7 });
  assert.equal(snap.balancePaise, 1000); assert.equal(snap.reservedPaise, 700); assert.equal(snap.availablePaise, 300);
  assert.deepEqual(calls[0][1], ["cust-1", "INR", { shopId: "shop-1" }]);
  assert.deepEqual(calls[1][1], ["cust-1", "INR", 7, { shopId: "shop-1" }]);
  const reservationSql = JSON.stringify(calls[2][1]);
  assert.match(reservationSql, /shopId/); assert.match(reservationSql, /customerProfileId/); assert.match(reservationSql, /status/); assert.match(reservationSql, /expiresAt/);
  assert.match(reservationSql, /shop-1/); assert.match(reservationSql, /cust-1/);
});

test("reserved amount normalizes safely and available balance never below zero", async () => {
  setDashboardWalletDependenciesForTest({ getOrCreateWalletAccount: async () => ({ currentBalance: 100 }), listWalletTransactions: async () => [], queryRaw: async () => [{ total: 500 }] });
  const snap = await loadDashboardWalletSnapshot({ context, enabled: true });
  assert.equal(snap.availablePaise, 0);
  setDashboardWalletDependenciesForTest({ getOrCreateWalletAccount: async () => ({ currentBalance: 100 }), listWalletTransactions: async () => [], queryRaw: async () => [{ total: -5 }] });
  assert.equal((await loadDashboardWalletSnapshot({ context, enabled: true })).reservedPaise, 0);
});

test("transaction normalization preserves direction, fallback reason, missing order, dates, and integer money", () => {
  const tx = normalizeDashboardWalletTransaction({ id: "1", direction: "weird", amount: 123, currency: "", adminNote: "Manual note", orderNumber: " ", createdAt: "2026-01-01T00:00:00Z" }, "INR");
  assert.equal(tx.direction, "CREDIT"); assert.equal(tx.reason, "Manual note"); assert.equal(tx.orderNumber, null); assert.equal(tx.amountPaise, 123);
  const dto = buildDashboardWalletDto({ enabled: true, currency: "INR", balancePaise: 100, reservedPaise: 1, availablePaise: 99, pendingRefundPaise: 0, transactions: [tx] });
  assert.equal(dto.transactions[0].createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(Number.isInteger(dto.balancePaise), true);
});

test("wallet failure throws typed dashboard unavailable and does not fabricate zero balance", async () => {
  setDashboardWalletDependenciesForTest({ getOrCreateWalletAccount: async () => { throw new Error("database down"); } });
  await assert.rejects(() => loadDashboardWalletSnapshot({ context, enabled: true }), (error) => error instanceof CustomerDashboardError && error.code === "DASHBOARD_UNAVAILABLE");
});
