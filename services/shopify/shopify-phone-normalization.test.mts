import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalE164, normalizeShopifyPhone, shopifyPhoneSearchVariants } from "./shopify-phone-normalization.ts";

test("accepts canonical E.164 without changing its country", () => {
  assert.deepEqual(normalizeShopifyPhone({ phone: "+9656046445" }), { ok: true, phoneE164: "+9656046445", countryCode: "KW", source: "already_e164" });
  assert.equal(isCanonicalE164("+919539180257"), true);
  assert.equal(isCanonicalE164("009656046445"), false);
});

test("normalizes local and 00-prefixed Kuwait formatting only with country context", () => {
  for (const phone of ["6046445", "+9656046445", "009656046445"]) {
    const result = normalizeShopifyPhone({ phone, countryCode: "KW" });
    assert.equal(result.ok && result.phoneE164, "+9656046445");
  }
  assert.deepEqual(normalizeShopifyPhone({ phone: "6046445" }), { ok: false, reason: "COUNTRY_REQUIRED" });
});

test("India compatibility variants never leak into non-India queries", () => {
  assert.deepEqual(shopifyPhoneSearchVariants("+9656046445"), ["+9656046445"]);
  assert.deepEqual(shopifyPhoneSearchVariants("+919539180257"), ["+919539180257", "9539180257", "919539180257", "00919539180257"]);
});
