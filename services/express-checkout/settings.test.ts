import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_COD_FEE_AMOUNT_PAISE, getExpressCheckoutSettings, parseCodFeeRupeesToPaise } from "./settings.ts";

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

test("admin settings route uses the strict COD fee parser", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../../app/api/admin/express-checkout/settings/route.ts", import.meta.url), "utf8");
  assert.match(route, /parseCodFeeRupeesToPaise\(body\.codFeeAmountRupees\)/);
  assert.doesNotMatch(route, /Math\.round\(amount \* 100\)/);
});
