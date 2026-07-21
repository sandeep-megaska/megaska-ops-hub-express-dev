/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalCustomerResolver } from "./canonical-customer-resolver.ts";

function repository(seed: any[] = []) {
  const rows = seed.map((row) => ({ phoneE164: null, phoneVerifiedAt: null, email: null, shopifyCustomerId: null, ...row }));
  let serial = Promise.resolve();
  const repo = {
    runInIdentityTransaction: (_shopId: string, operation: (tx: any) => Promise<any>) => {
      const result = serial.then(() => operation({}));
      serial = result.then(() => undefined, () => undefined);
      return result;
    },
    findIdentityCandidates: async (_tx: any, input: any) => rows.filter((row) => row.shopId === input.shopId).flatMap((row) => {
      const matchedBy = [];
      const storedId = row.shopifyCustomerId?.replace("gid://shopify/Customer/", "");
      if (input.shopifyCustomerId && storedId === input.shopifyCustomerId) matchedBy.push("SHOPIFY_CUSTOMER_ID");
      if (input.usePhone && input.phoneE164 === row.phoneE164 && row.phoneVerifiedAt) matchedBy.push("VERIFIED_PHONE");
      return matchedBy.length ? [{ customerProfile: row, matchedBy }] : [];
    }),
    createCustomerProfile: async (_tx: any, data: any) => {
      const row = { id: `profile-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row); return row;
    },
    updateCustomerProfile: async (_tx: any, shopId: string, id: string, data: any) => {
      const row = rows.find((item) => item.shopId === shopId && item.id === id); Object.assign(row, data); return row;
    },
    recordIdentityConflict: async () => undefined,
  };
  return { rows, resolver: new CanonicalCustomerResolver(repo as any, () => undefined) };
}

test("numeric storage and an incoming customer GID resolve to the existing tenant profile", async () => {
  const state = repository([{ id: "otp-profile", shopId: "shop-a", shopifyCustomerId: "10359580655914" }]);
  const result = await state.resolver.resolveFromShopifyOrder({ shopId: "shop-a", shopifyCustomerId: "gid://shopify/Customer/10359580655914" });
  assert.equal(result.customerProfile?.id, "otp-profile");
  assert.equal(result.outcome, "MATCHED");
  assert.equal(state.rows.length, 1);
});

test("transitional GID storage is reused and rewritten canonically", async () => {
  const state = repository([{ id: "legacy-profile", shopId: "shop-a", shopifyCustomerId: "gid://shopify/Customer/123" }]);
  const result = await state.resolver.resolveFromCustomerSync({ shopId: "shop-a", shopifyCustomerId: "123" });
  assert.equal(result.customerProfile?.id, "legacy-profile");
  assert.equal(result.customerProfile?.shopifyCustomerId, "123");
  assert.equal(state.rows.length, 1);
});

test("equivalent concurrent forms create one profile while tenant isolation permits another", async () => {
  const state = repository();
  const [numeric, gid] = await Promise.all([
    state.resolver.resolveFromCustomerSync({ shopId: "shop-a", shopifyCustomerId: "123" }),
    state.resolver.resolveFromShopifyOrder({ shopId: "shop-a", shopifyCustomerId: "gid://shopify/Customer/123" }),
  ]);
  const other = await state.resolver.resolveFromCustomerSync({ shopId: "shop-b", shopifyCustomerId: "123" });
  assert.equal(numeric.customerProfile?.id, gid.customerProfile?.id);
  assert.notEqual(other.customerProfile?.id, numeric.customerProfile?.id);
  assert.equal(state.rows.length, 2);
});

test("verified phone links a profile but an unverified phone never merges", async () => {
  const verifiedAt = new Date();
  const trusted = repository([{ id: "phone-profile", shopId: "shop-a", phoneE164: "+919876543210", phoneVerifiedAt: verifiedAt }]);
  const linked = await trusted.resolver.resolveFromCustomerSync({ shopId: "shop-a", shopifyCustomerId: "123", phone: "+919876543210", phoneVerified: true });
  assert.equal(linked.customerProfile?.id, "phone-profile");
  assert.equal(linked.customerProfile?.shopifyCustomerId, "123");

  const untrusted = repository([{ id: "unverified", shopId: "shop-a", phoneE164: "+919876543210" }]);
  const created = await untrusted.resolver.resolveFromCustomerSync({ shopId: "shop-a", shopifyCustomerId: "456", phone: "+919876543210" });
  assert.notEqual(created.customerProfile?.id, "unverified");
});

test("wrong resource types are rejected before any profile is created", async () => {
  const state = repository();
  await assert.rejects(() => state.resolver.resolveFromShopifyOrder({ shopId: "shop-a", shopifyCustomerId: "gid://shopify/Order/123" }), /canonical or verified/);
  assert.equal(state.rows.length, 0);
});

test("shop plus exact canonical E.164 is the customer identity boundary", async () => {
  const state = repository();
  const india = await state.resolver.resolveFromOTP({ shopId: "shop-a", phoneE164: "+919539180257" });
  const indiaAgain = await state.resolver.resolveFromOTP({ shopId: "shop-a", phoneE164: "+919539180257" });
  const kuwait = await state.resolver.resolveFromOTP({ shopId: "shop-a", phoneE164: "+9656046445" });
  const sameTrailingDigits = await state.resolver.resolveFromOTP({ shopId: "shop-a", phoneE164: "+916046445" });
  const otherShop = await state.resolver.resolveFromOTP({ shopId: "shop-b", phoneE164: "+919539180257" });
  assert.equal(india.customerProfile?.id, indiaAgain.customerProfile?.id);
  assert.notEqual(india.customerProfile?.id, kuwait.customerProfile?.id);
  assert.notEqual(kuwait.customerProfile?.id, sameTrailingDigits.customerProfile?.id);
  assert.notEqual(india.customerProfile?.id, otherShop.customerProfile?.id);
});

test("identity resolver rejects ambiguous local input rather than guessing India", async () => {
  const state = repository();
  await assert.rejects(() => state.resolver.resolveFromOTP({ shopId: "shop-a", phoneE164: "6046445" }), /canonical E\.164/);
});
