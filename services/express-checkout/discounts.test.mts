import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tmp = mkdtempSync(join(tmpdir(), "express-discounts-"));
const serviceDir = new URL("./", import.meta.url);

function copyForNode(filename: string) {
  const source = readFileSync(new URL(filename, serviceDir), "utf8")
    .replaceAll('"./discounts"', '"./discounts.mts"')
    .replaceAll('"./legacy-coupon-adapter"', '"./legacy-coupon-adapter.mts"')
    .replace(/import type \{ Prisma \} from "\.\.\/\.\.\/generated\/prisma";\n/, "type Prisma = { InputJsonObject: Record<string, unknown>; InputJsonValue: unknown };\n");
  const target = join(tmp, filename.replace(/\.ts$/, ".mts"));
  writeFileSync(target, source);
  return target;
}

copyForNode("discounts.ts");
copyForNode("legacy-coupon-adapter.ts");
copyForNode("coupon-resolver.ts");

const { calculateExpressCheckoutDiscount } = await import(`${join(tmp, "discounts.mts")}`);
const { resolveExpressCheckoutCoupon } = await import(`${join(tmp, "coupon-resolver.mts")}`);

const percentageDefinition = {
  code: "SAVE",
  title: "Save",
  type: "PERCENTAGE" as const,
  value: 15,
  valueUnit: "PERCENT" as const,
  source: "UPSTREAM_VALIDATED" as const,
};

test("generic percentage definition discounts the coupon base", () => {
  assert.equal(calculateExpressCheckoutDiscount({ definition: percentageDefinition, couponBaseAmountPaise: 169000 })?.discountAmountPaise, 25350);
});

test("generic fixed amount definition discounts by paise value", () => {
  assert.equal(calculateExpressCheckoutDiscount({ definition: { ...percentageDefinition, type: "FIXED_AMOUNT", value: 20000, valueUnit: "PAISE" }, couponBaseAmountPaise: 169000 })?.discountAmountPaise, 20000);
});

test("fixed amount discount is capped at the coupon base", () => {
  assert.equal(calculateExpressCheckoutDiscount({ definition: { ...percentageDefinition, type: "FIXED_AMOUNT", value: 20000, valueUnit: "PAISE" }, couponBaseAmountPaise: 10000 })?.discountAmountPaise, 10000);
});

test("percentage discount respects maximum cap", () => {
  assert.equal(calculateExpressCheckoutDiscount({ definition: { ...percentageDefinition, value: 20, maximumDiscountPaise: 25000 }, couponBaseAmountPaise: 200000 })?.discountAmountPaise, 25000);
});

test("generic calculator contains no legacy coupon string", () => {
  assert.doesNotMatch(readFileSync(new URL("./discounts.ts", import.meta.url), "utf8"), /MEGA15/);
});

test("two shops may resolve the same code differently from explicit configuration", async () => {
  const shopA = await resolveExpressCheckoutCoupon({ shopId: "shop-a", code: "SAVE", cartSnapshot: { expressCheckoutDiscountDefinitions: [{ code: "SAVE", title: "Save 10%", type: "PERCENTAGE", value: 10, valueUnit: "PERCENT" }] } });
  const shopB = await resolveExpressCheckoutCoupon({ shopId: "shop-b", code: "SAVE", cartSnapshot: { expressCheckoutDiscountDefinitions: [{ code: "SAVE", title: "Save ₹200", type: "FIXED_AMOUNT", value: 20000, valueUnit: "PAISE" }] } });

  assert.equal(calculateExpressCheckoutDiscount({ definition: shopA!, couponBaseAmountPaise: 169000 })?.discountAmountPaise, 16900);
  assert.equal(calculateExpressCheckoutDiscount({ definition: shopB!, couponBaseAmountPaise: 169000 })?.discountAmountPaise, 20000);
});

test("unknown unresolved coupon is rejected", async () => {
  assert.equal(await resolveExpressCheckoutCoupon({ shopId: "shop-a", shopDomain: "example.myshopify.com", code: "UNKNOWN", cartSnapshot: {} }), null);
});

test("Megaska compatibility resolves legacy code outside the calculator", async () => {
  const definition = await resolveExpressCheckoutCoupon({ shopId: "shop-a", shopDomain: "megaska.myshopify.com", code: "MEGA15" });

  assert.equal(definition?.source, "LEGACY_COMPATIBILITY");
  assert.equal(calculateExpressCheckoutDiscount({ definition: definition!, couponBaseAmountPaise: 169000 })?.discountAmountPaise, 25350);
});
