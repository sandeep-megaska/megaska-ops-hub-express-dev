import assert from "node:assert/strict";
import test from "node:test";

const { reconcileGiftCardRedemption } = await import("./gift-card-reconcile.ts");

const BASE = { shopId: "shop_1", shopDomain: "shop.myshopify.com", customerProfileId: "cp_1", orderId: "gid://shopify/Order/1", orderNumber: "#1001" };

function account(overrides = {}) {
  return { id: "wa_1", currentBalance: 20000, currency: "INR", shopifyGiftCardId: "gid://shopify/GiftCard/1", unsyncedCreditPaise: 0, ...overrides };
}

function deps(overrides = {}) {
  const calls: any = { recorded: [] };
  const base = {
    loadAccount: async () => account(),
    readCardBalancePaise: async () => 20000,
    recordRedemption: async (p: any) => { calls.recorded.push(p); return { recorded: true, walletTransactionId: "wt_new" }; },
    ...overrides,
  };
  return { d: base, calls };
}

test("no customer id -> no_customer, no work", async () => {
  const { d } = deps();
  assert.deepEqual(await reconcileGiftCardRedemption({ ...BASE, customerProfileId: "" }, d), { status: "no_customer" });
});

test("account without a gift card -> no_card", async () => {
  const { d } = deps({ loadAccount: async () => account({ shopifyGiftCardId: null }) });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "no_card" });
});

test("unreadable card balance -> card_unreadable (retryable), no debit", async () => {
  const { d, calls } = deps({ readCardBalancePaise: async () => null });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "card_unreadable" });
  assert.equal(calls.recorded.length, 0);
});

test("card balance equals ledger -> in_sync, no debit", async () => {
  const { d, calls } = deps({ readCardBalancePaise: async () => 20000 });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "in_sync" });
  assert.equal(calls.recorded.length, 0);
});

test("card balance above ledger -> card_ahead (never inflates the ledger)", async () => {
  const { d, calls } = deps({ readCardBalancePaise: async () => 25000 });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "card_ahead", ledgerPaise: 20000, cardPaise: 25000 });
  assert.equal(calls.recorded.length, 0);
});

test("card below ledger with no pending credits -> records the redemption debit for the gap", async () => {
  const { d, calls } = deps({ readCardBalancePaise: async () => 12000 });
  const res = await reconcileGiftCardRedemption(BASE, d);
  assert.deepEqual(res, { status: "redemption_recorded", amountPaise: 8000, walletTransactionId: "wt_new" });
  assert.equal(calls.recorded.length, 1);
  assert.equal(calls.recorded[0].amountPaise, 8000);
  assert.equal(calls.recorded[0].orderId, BASE.orderId);
});

test("gap fully explained by an unsynced credit (projection lag) -> in_sync, NO false debit", async () => {
  // ledger 20000, card 12000, but 8000 of credit hasn't been mirrored to the card yet.
  const { d, calls } = deps({ loadAccount: async () => account({ unsyncedCreditPaise: 8000 }), readCardBalancePaise: async () => 12000 });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "in_sync" });
  assert.equal(calls.recorded.length, 0);
});

test("gap larger than the unsynced credit -> books only the true redemption portion", async () => {
  // ledger 20000, card 9000 -> gap 11000; 3000 is pending credit, so redemption is 8000.
  const { d, calls } = deps({ loadAccount: async () => account({ unsyncedCreditPaise: 3000 }), readCardBalancePaise: async () => 9000 });
  const res = await reconcileGiftCardRedemption(BASE, d);
  assert.deepEqual(res, { status: "redemption_recorded", amountPaise: 8000, walletTransactionId: "wt_new" });
  assert.equal(calls.recorded[0].amountPaise, 8000);
});

test("a redelivered webhook whose debit already exists -> duplicate", async () => {
  const { d } = deps({ readCardBalancePaise: async () => 12000, recordRedemption: async () => ({ recorded: false, duplicate: true, walletTransactionId: null }) });
  assert.deepEqual(await reconcileGiftCardRedemption(BASE, d), { status: "duplicate" });
});
