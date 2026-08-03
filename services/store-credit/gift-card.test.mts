import assert from "node:assert/strict";
import test from "node:test";

process.env.GIFT_CARD_ENCRYPTION_KEY = "test-gift-card-key-32-bytes-minimum!!";

const { creditCustomerGiftCard, readCustomerGiftCard, paiseToMajorString, majorStringToPaise } = await import("./gift-card.ts");
const { encryptGiftCardCode, decryptGiftCardCode, generateGiftCardCode } = await import("./gift-card-crypto.ts");

const BASE = { shopId: "shop_1", shopDomain: "shop.myshopify.com", customerProfileId: "cp_1" };

function accountStub(overrides = {}) {
  return { id: "wa_1", currency: "INR", shopifyGiftCardId: null, shopifyGiftCardLast4: null, giftCardCodeEnc: null, ...overrides };
}

test("paise <-> major conversion", () => {
  assert.equal(paiseToMajorString(15000), "150.00");
  assert.equal(paiseToMajorString(20850), "208.50");
  assert.equal(majorStringToPaise("208.50"), 20850);
  assert.equal(paiseToMajorString(-5), "0.00");
});

test("code crypto round-trips and generates an unambiguous formatted code", () => {
  const code = generateGiftCardCode();
  assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  const enc = encryptGiftCardCode(code);
  assert.ok(enc && enc.startsWith("v1:"));
  assert.equal(decryptGiftCardCode(enc), code);
  assert.equal(decryptGiftCardCode("garbage"), null);
});

test("first grant creates the gift card with a self-generated code and stores the ref", async () => {
  let createVars: any = null;
  const saved: any[] = [];
  const graphql = (async (query: string, variables: any) => {
    if (query.includes("giftCardCreate")) {
      createVars = variables;
      return { giftCardCreate: { giftCard: { id: "gid://shopify/GiftCard/1", lastCharacters: "WXYZ", balance: { amount: "150.00", currencyCode: "INR" } }, userErrors: [] } };
    }
    throw new Error("unexpected: " + query.slice(0, 40));
  }) as any;
  const res = await creditCustomerGiftCard({ ...BASE, amountPaise: 15000 }, {
    graphql,
    loadAccount: async () => accountStub(),
    saveGiftCardRef: async (p) => { saved.push(p); },
  });
  assert.deepEqual(res, { ok: true, created: true, giftCardId: "gid://shopify/GiftCard/1", last4: "WXYZ" });
  assert.equal(createVars.input.initialValue, "150.00");
  assert.match(String(createVars.input.code), /^[2-9A-HJ-NP-Z-]+$/, "must supply our own code");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].shopifyGiftCardId, "gid://shopify/GiftCard/1");
  // The stored code is encrypted and decrypts back to the supplied code.
  assert.equal(decryptGiftCardCode(saved[0].giftCardCodeEnc), String(createVars.input.code));
});

test("a later grant tops up the existing card (giftCardCredit, no create)", async () => {
  const calls: string[] = [];
  const graphql = (async (query: string, variables: any) => {
    if (query.includes("giftCardCredit")) {
      calls.push("credit");
      assert.equal(variables.id, "gid://shopify/GiftCard/9");
      assert.equal(variables.creditInput.creditAmount.amount, "50.00");
      return { giftCardCredit: { giftCardCreditTransaction: { amount: { amount: "50.00", currencyCode: "INR" } }, userErrors: [] } };
    }
    if (query.includes("giftCardCreate")) { calls.push("create"); }
    throw new Error("should not create");
  }) as any;
  const res = await creditCustomerGiftCard({ ...BASE, amountPaise: 5000 }, {
    graphql,
    loadAccount: async () => accountStub({ shopifyGiftCardId: "gid://shopify/GiftCard/9", shopifyGiftCardLast4: "ABCD" }),
    saveGiftCardRef: async () => { throw new Error("should not re-save on top-up"); },
  });
  assert.deepEqual(res, { ok: true, created: false, giftCardId: "gid://shopify/GiftCard/9", last4: "ABCD" });
  assert.deepEqual(calls, ["credit"]);
});

test("read returns present:false when the customer has no gift card yet", async () => {
  const res = await readCustomerGiftCard(BASE, { graphql: (async () => ({})) as any, loadAccount: async () => accountStub() });
  assert.deepEqual(res, { ok: true, present: false });
});

test("read returns the live balance + decrypted code for the dashboard", async () => {
  const code = generateGiftCardCode();
  const graphql = (async () => ({ giftCard: { id: "gid://shopify/GiftCard/5", lastCharacters: "LM45", balance: { amount: "342.00", currencyCode: "INR" } } })) as any;
  const res = await readCustomerGiftCard(BASE, {
    graphql,
    loadAccount: async () => accountStub({ shopifyGiftCardId: "gid://shopify/GiftCard/5", shopifyGiftCardLast4: "LM45", giftCardCodeEnc: encryptGiftCardCode(code) }),
  });
  assert.deepEqual(res, { ok: true, present: true, giftCardId: "gid://shopify/GiftCard/5", last4: "LM45", code, balancePaise: 34200 });
});

test("rejects non-positive amounts and surfaces userErrors", async () => {
  const zero = await creditCustomerGiftCard({ ...BASE, amountPaise: 0 }, { graphql: (async () => ({})) as any, loadAccount: async () => accountStub() });
  assert.deepEqual(zero, { ok: false, reason: "amount_must_be_positive" });

  const graphql = (async (query: string) => query.includes("giftCardCreate")
    ? { giftCardCreate: { giftCard: null, userErrors: [{ message: "boom" }] } }
    : {}) as any;
  const err = await creditCustomerGiftCard({ ...BASE, amountPaise: 100 }, { graphql, loadAccount: async () => accountStub(), saveGiftCardRef: async () => {} });
  assert.deepEqual(err, { ok: false, reason: "boom" });
});
