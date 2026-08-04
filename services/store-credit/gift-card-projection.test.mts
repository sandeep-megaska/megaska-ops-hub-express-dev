import assert from "node:assert/strict";
import test from "node:test";

const { projectCreditToGiftCard } = await import("./gift-card-projection.ts");

const FIXED_NOW = new Date("2026-08-04T00:00:00.000Z");

function txStub(overrides = {}) {
  return {
    id: "wt_1",
    shopId: "shop_1",
    customerProfileId: "cp_1",
    currency: "INR",
    direction: "CREDIT",
    amount: 15000,
    reason: "COD refund settled as Store Credit",
    giftCardSyncedAt: null,
    ...overrides,
  };
}

function deps(overrides = {}) {
  const calls: any = { credit: [], marked: [] };
  const base = {
    loadTransaction: async () => txStub(),
    resolveShopDomain: async () => "shop.myshopify.com",
    credit: async (p: any) => { calls.credit.push(p); return { ok: true, created: true, giftCardId: "gid://shopify/GiftCard/1", last4: "WXYZ" }; },
    markSynced: async (id: string, at: Date) => { calls.marked.push({ id, at }); },
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { d: base, calls };
}

test("skips a DEBIT ledger entry without touching the gift card", async () => {
  const { d, calls } = deps({ loadTransaction: async () => txStub({ direction: "DEBIT" }) });
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "skipped_not_credit" });
  assert.equal(calls.credit.length, 0);
  assert.equal(calls.marked.length, 0);
});

test("no-ops when the entry is already synced", async () => {
  const { d, calls } = deps({ loadTransaction: async () => txStub({ giftCardSyncedAt: FIXED_NOW }) });
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "already_synced" });
  assert.equal(calls.credit.length, 0);
  assert.equal(calls.marked.length, 0);
});

test("returns not_found when the transaction is missing", async () => {
  const { d } = deps({ loadTransaction: async () => null });
  const res = await projectCreditToGiftCard("missing", d);
  assert.deepEqual(res, { status: "not_found" });
});

test("skips (retryable) when the shop domain cannot be resolved", async () => {
  const { d, calls } = deps({ resolveShopDomain: async () => null });
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "skipped_no_shop_domain" });
  assert.equal(calls.credit.length, 0);
  assert.equal(calls.marked.length, 0);
});

test("first credit creates the card, passes paise + note, and stamps the marker", async () => {
  const { d, calls } = deps();
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "created", giftCardId: "gid://shopify/GiftCard/1", last4: "WXYZ" });
  assert.equal(calls.credit.length, 1);
  assert.deepEqual(calls.credit[0], {
    shopId: "shop_1",
    shopDomain: "shop.myshopify.com",
    customerProfileId: "cp_1",
    amountPaise: 15000,
    currency: "INR",
    note: "COD refund settled as Store Credit",
  });
  assert.deepEqual(calls.marked, [{ id: "wt_1", at: FIXED_NOW }]);
});

test("a later credit tops up the existing card and stamps the marker", async () => {
  const { d, calls } = deps({
    credit: async () => ({ ok: true, created: false, giftCardId: "gid://shopify/GiftCard/9", last4: "ABCD" }),
  });
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "topped_up", giftCardId: "gid://shopify/GiftCard/9", last4: "ABCD" });
  assert.deepEqual(calls.marked, [{ id: "wt_1", at: FIXED_NOW }]);
});

test("a failed credit does NOT stamp the marker, leaving it for retry", async () => {
  const { d, calls } = deps({ credit: async () => ({ ok: false, reason: "write_gift_cards scope missing" }) });
  const res = await projectCreditToGiftCard("wt_1", d);
  assert.deepEqual(res, { status: "failed", reason: "write_gift_cards scope missing" });
  assert.equal(calls.marked.length, 0);
});

test("falls back to a default note when the ledger entry has no reason", async () => {
  const { d, calls } = deps({ loadTransaction: async () => txStub({ reason: null }) });
  await projectCreditToGiftCard("wt_1", d);
  assert.equal(calls.credit[0].note, "LoopD2C store credit");
});
