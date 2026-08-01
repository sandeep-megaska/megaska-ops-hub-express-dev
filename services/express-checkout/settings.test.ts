import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COD_FEE_AMOUNT_PAISE, getExpressCheckoutSettings, parseCodFeeRupeesToPaise, parsePercentValue } from "./settings.ts";

function db(config: unknown) {
  return { shopModuleConfig: { findUnique: async () => config == null ? null : { config } } };
}

test("default COD fee is 0", async () => {
  assert.equal(DEFAULT_COD_FEE_AMOUNT_PAISE, 0);
  const settings = await getExpressCheckoutSettings("shop-1", { db: db(null) });
  assert.equal(settings.codFeeAmountPaise, 0);
});

test("empty COD fee input saves as 0", () => {
  assert.equal(parseCodFeeRupeesToPaise(""), 0);
  assert.equal(parseCodFeeRupeesToPaise(null), 0);
  assert.equal(parseCodFeeRupeesToPaise(undefined), 0);
});

test("valid COD fee rupee values convert exactly to paise", () => {
  assert.equal(parseCodFeeRupeesToPaise("0"), 0);
  assert.equal(parseCodFeeRupeesToPaise("25"), 2500);
  assert.equal(parseCodFeeRupeesToPaise("49.5"), 4950);
  assert.equal(parseCodFeeRupeesToPaise("49.50"), 4950);
  assert.equal(parseCodFeeRupeesToPaise("100"), 10000);
});

test("invalid COD fee rupee values are rejected", () => {
  assert.equal(parseCodFeeRupeesToPaise("-1"), null);
  assert.equal(parseCodFeeRupeesToPaise("abc"), null);
  assert.equal(parseCodFeeRupeesToPaise("1.234"), null);
  assert.equal(parseCodFeeRupeesToPaise(Number.NaN), null);
  assert.equal(parseCodFeeRupeesToPaise(Number.POSITIVE_INFINITY), null);
});

test("existing saved merchant COD fee values still load correctly", async () => {
  const settings = await getExpressCheckoutSettings("shop-1", { db: db({ codFeeAmountPaise: 4950 }) });
  assert.equal(settings.codFeeAmountPaise, 4950);
});

test("prepaid discount defaults to disabled when unset", async () => {
  const settings = await getExpressCheckoutSettings("shop-1", { db: db(null) });
  assert.equal(settings.prepaidDiscount.enabled, false);
  assert.equal(settings.prepaidDiscount.type, "PERCENTAGE");
  assert.equal(settings.prepaidDiscount.value, 0);
  assert.equal(settings.prepaidDiscount.maxPaise, null);
  assert.equal(settings.prepaidDiscount.minSubtotalPaise, null);
});

test("saved prepaid discount config loads as a structured offer", async () => {
  const settings = await getExpressCheckoutSettings("shop-1", { db: db({ prepaidDiscountEnabled: true, prepaidDiscountType: "PERCENTAGE", prepaidDiscountValue: 15, prepaidDiscountMaxPaise: 20000, prepaidDiscountMinSubtotalPaise: 50000, prepaidOfferMessage: "🎉 {percent} off when you pay online" }) });
  assert.deepEqual(settings.prepaidDiscount, { enabled: true, type: "PERCENTAGE", value: 15, maxPaise: 20000, minSubtotalPaise: 50000, offerMessage: "🎉 {percent} off when you pay online" });
});

test("prepaid offer message defaults to null and is trimmed and length-capped", async () => {
  const unset = await getExpressCheckoutSettings("shop-1", { db: db({ prepaidDiscountEnabled: true, prepaidDiscountValue: 15 }) });
  assert.equal(unset.prepaidDiscount.offerMessage, null);
  const trimmed = await getExpressCheckoutSettings("shop-1", { db: db({ prepaidDiscountEnabled: true, prepaidDiscountValue: 15, prepaidOfferMessage: "  hello  " }) });
  assert.equal(trimmed.prepaidDiscount.offerMessage, "hello");
  const long = await getExpressCheckoutSettings("shop-1", { db: db({ prepaidDiscountEnabled: true, prepaidDiscountValue: 15, prepaidOfferMessage: "x".repeat(500) }) });
  assert.equal(long.prepaidDiscount.offerMessage?.length, 160);
});

test("prepaid discount stays disabled when the value is zero even if the flag is on", async () => {
  const settings = await getExpressCheckoutSettings("shop-1", { db: db({ prepaidDiscountEnabled: true, prepaidDiscountValue: 0 }) });
  assert.equal(settings.prepaidDiscount.enabled, false);
});

test("percentage parser accepts 0-100 with up to two decimals and rejects the rest", () => {
  assert.equal(parsePercentValue(""), 0);
  assert.equal(parsePercentValue("15"), 15);
  assert.equal(parsePercentValue("12.5"), 12.5);
  assert.equal(parsePercentValue("100"), 100);
  assert.equal(parsePercentValue("100.01"), null);
  assert.equal(parsePercentValue("-5"), null);
  assert.equal(parsePercentValue("abc"), null);
});

test("admin settings route uses the strict COD fee parser", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../../app/api/admin/express-checkout/settings/route.ts", import.meta.url), "utf8");
  assert.match(route, /parseCodFeeRupeesToPaise\(body\.codFeeAmountRupees\)/);
  assert.doesNotMatch(route, /Math\.round\(amount \* 100\)/);
});
