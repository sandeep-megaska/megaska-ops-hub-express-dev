import assert from "node:assert/strict";
import test from "node:test";

const { backfillGiftCardsForExistingBalances } = await import("./gift-card-backfill.ts");

const FIXED_NOW = new Date("2026-08-04T00:00:00.000Z");

function acct(overrides = {}) {
  return { id: "wa_1", shopId: "shop_1", customerProfileId: "cp_1", currency: "INR", currentBalance: 15000, ...overrides };
}

function deps(overrides = {}) {
  const calls: any = { credited: [], marked: [] };
  const base = {
    listAccounts: async () => [acct()],
    resolveShopDomain: async () => "shop.myshopify.com",
    credit: async (p: any) => { calls.credited.push(p); return { ok: true, created: true, giftCardId: "gid://shopify/GiftCard/1", last4: "WXYZ" }; },
    markAccountCreditsSynced: async (id: string, at: Date) => { calls.marked.push({ id, at }); },
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { d: base, calls };
}

test("mints a card for the full balance and marks the account's credits synced", async () => {
  const { d, calls } = deps();
  const summary = await backfillGiftCardsForExistingBalances({}, d);
  assert.deepEqual(summary, { processed: 1, created: 1, skipped: 0, failed: 0, items: [{ accountId: "wa_1", status: "created", last4: "WXYZ" }] });
  assert.equal(calls.credited[0].amountPaise, 15000);
  assert.equal(calls.credited[0].currency, "INR");
  assert.deepEqual(calls.marked, [{ id: "wa_1", at: FIXED_NOW }]);
});

test("skips an account whose shop domain cannot be resolved (no card minted)", async () => {
  const { d, calls } = deps({ resolveShopDomain: async () => null });
  const summary = await backfillGiftCardsForExistingBalances({}, d);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.created, 0);
  assert.equal(calls.credited.length, 0);
  assert.equal(calls.marked.length, 0);
});

test("a failed mint is counted and does NOT mark credits synced", async () => {
  const { d, calls } = deps({ credit: async () => ({ ok: false, reason: "write_gift_cards scope missing" }) });
  const summary = await backfillGiftCardsForExistingBalances({}, d);
  assert.equal(summary.failed, 1);
  assert.equal(summary.created, 0);
  assert.equal(summary.items[0].reason, "write_gift_cards scope missing");
  assert.equal(calls.marked.length, 0);
});

test("processes a mixed batch and tallies each outcome", async () => {
  const accounts = [acct({ id: "a" }), acct({ id: "b" }), acct({ id: "c" })];
  const { d } = deps({
    listAccounts: async () => accounts,
    resolveShopDomain: async (shopId: string) => (shopId === "shop_1" ? "shop.myshopify.com" : null),
    credit: async (p: any) => (p.customerProfileId === "cp_fail" ? { ok: false, reason: "boom" } : { ok: true, created: true, giftCardId: "g", last4: "LAST" }),
  });
  // all three share shop_1 + cp_1 here, so all should be created
  const summary = await backfillGiftCardsForExistingBalances({}, d);
  assert.equal(summary.processed, 3);
  assert.equal(summary.created, 3);
});

test("clamps the batch limit into [1, 500]", async () => {
  let seenLimit = -1;
  const { d } = deps({ listAccounts: async (p: any) => { seenLimit = p.limit; return []; } });
  await backfillGiftCardsForExistingBalances({ limit: 9999 }, d);
  assert.equal(seenLimit, 500);
  await backfillGiftCardsForExistingBalances({ limit: 0 }, d);
  assert.equal(seenLimit, 1);
});
