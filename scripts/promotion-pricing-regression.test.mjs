import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-promotion-pricing.js", import.meta.url), "utf8");
const context = { window: {}, Intl };
vm.createContext(context);
vm.runInContext(source, context);
const { resolvePromotionDisplayPricing, summarizeCart, buildPromotionViewModel, sameShopifyId } = context.window.LoopDeskPromotionPricing;
const trigger = { type: "cart_contains_variant", variantGid: "gid://shopify/ProductVariant/trigger" };
const baseRule = (discount, maxQuantityPerCart = 1) => ({ id: "rule-1", name: "Half price add-on", enabled: true, status: "active", display: { badge: "Offer applied", heading: "Special add-on", ctaLabel: "Add offer" }, eligibility: { triggers: [trigger] }, limits: { maxQuantityPerCart }, reward: { variantGid: "gid://shopify/ProductVariant/reward", quantity: 2, discount, product: { title: "Reward", variantPrice: "600" } } });
const cart = (rewardQty = 1, includeTrigger = true) => ({ currency: "INR", total_price: 199000, item_count: rewardQty + (includeTrigger ? 1 : 0), items: [includeTrigger && { key: "trigger-key", variant_id: "trigger", quantity: 1, final_line_price: 139000 }, rewardQty && { key: "reward-key", variant_id: "reward", quantity: rewardQty, final_line_price: 60000 * rewardQty }].filter(Boolean) });

assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "fixed_price", value: 150 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 15000, "offer card fixed_price price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 30000, "offer card percentage price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "fixed_amount", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 55000, "offer card fixed_amount price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 30000, "reward line percentage display");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "fixed_amount", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 5000, "reward line fixed_amount display");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "fixed_price", value: 150 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 45000, "reward line fixed_price display");

const viewModel = buildPromotionViewModel({ cart: cart(1), rules: [baseRule({ type: "percentage", value: 50 })], currency: "INR" });
assert.equal(viewModel.offerCards[0].originalUnitPrice, 600, "offer card reads reward.product.variantPrice as currency amount");
assert.equal(viewModel.offerCards[0].promotionalUnitPrice, 300, "offer card percentage display uses currency amount units");
assert.equal(viewModel.offerCards[0].priceText, "₹300", "offer card formats discounted price from configured variant price");
assert.equal(viewModel.offerCards[0].originalPriceText, "₹600", "offer card formats original variant price");
assert.equal(viewModel.offerCards[0].canShowPriceBenefit, true, "offer card can show price benefit when variant price exists");
assert.equal(viewModel.offerCards[0].priceSource, "reward.product.variantPrice", "offer card records variant price source");
assert.equal(viewModel.offerCards[0].promotionalUnitPrice * 100, viewModel.cartLines.find((line) => line.isPromotionAdjusted).displayUnitPrice, "cart line percentage display matches offer card value after unit conversion");
for (const [label, discount] of [["fixed_amount", { type: "fixed_amount", value: 50 }], ["fixed_price", { type: "fixed_price", value: 150 }]]) {
  const model = buildPromotionViewModel({ cart: cart(1), rules: [baseRule(discount)], currency: "INR" });
  assert.equal(model.offerCards[0].promotionalUnitPrice * 100, model.cartLines.find((line) => line.isPromotionAdjusted).displayUnitPrice, `cart line ${label} display matches offer card value after unit conversion`);
}
assert.equal(viewModel.cartLines.find((line) => line.variantId === "trigger").isPromotionAdjusted, false, "trigger-only line is not discounted");
assert.equal(viewModel.totals.shopifySubtotal, 199000, "subtotal remains Shopify subtotal");
assert.equal(viewModel.totals.promotionDiscountTotal, 30000, "offer discount total is calculated");
assert.equal(viewModel.totals.estimatedAfterOffer, 169000, "estimated after offer is calculated correctly");
assert.equal(summarizeCart(cart(1), [baseRule({ type: "percentage", value: 50 })]).estimatedAfterOffer, 169000, "subtotal estimated-after-offer calculation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1, false), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).isEligible, false, "trigger absent means no discount display");
assert.equal(summarizeCart(cart(1, false), [baseRule({ type: "percentage", value: 50 })]).offerDiscount, 0, "reward line without trigger shows normal price");

const rewardVariantPathRule = { ...baseRule({ type: "percentage", value: 50 }), reward: { ...baseRule({ type: "percentage", value: 50 }).reward, product: { title: "Reward" }, variantPrice: "600.00" } };
assert.equal(buildPromotionViewModel({ cart: cart(0), rules: [rewardVariantPathRule], currency: "INR" }).offerCards[0].priceSource, "reward.variantPrice", "offer card reads reward.variantPrice fallback");
const topLevelPriceRule = { ...baseRule({ type: "percentage", value: 50 }), rewardProductVariantPrice: "600", reward: { ...baseRule({ type: "percentage", value: 50 }).reward, product: { title: "Reward" } } };
assert.equal(buildPromotionViewModel({ cart: cart(0), rules: [topLevelPriceRule], currency: "INR" }).offerCards[0].priceSource, "rewardProductVariantPrice", "offer card reads rewardProductVariantPrice fallback");
const legacyCompareRule = { ...baseRule({ type: "percentage", value: 50 }), display: { comparePriceDisplay: "₹600" }, reward: { ...baseRule({ type: "percentage", value: 50 }).reward, product: { title: "Reward" } } };
assert.equal(buildPromotionViewModel({ cart: cart(0), rules: [legacyCompareRule], currency: "INR" }).offerCards[0].priceSource, "legacy_compare", "offer card reads legacy compare fallback");
const missingPriceRule = { ...baseRule({ type: "percentage", value: 50 }), display: {}, reward: { ...baseRule({ type: "percentage", value: 50 }).reward, product: { title: "Reward" } } };
assert.equal(buildPromotionViewModel({ cart: cart(0), rules: [missingPriceRule], currency: "INR" }).offerCards[0].priceSource, "unavailable", "offer card diagnoses missing price");

const capped = buildPromotionViewModel({ cart: cart(3), rules: [baseRule({ type: "percentage", value: 50 }, 1)], currency: "INR" });
assert.equal(capped.cartLines.find((line) => line.isPromotionAdjusted).eligibleQuantity, 1, "quantity cap eligible quantity is one");
assert.equal(capped.totals.promotionDiscountTotal, 30000, "quantity cap discount total is correct");
assert.equal(sameShopifyId("gid://shopify/ProductVariant/123", "123"), true, "ID normalization GID vs numeric");
assert.equal(buildPromotionViewModel({ cart: cart(1), rules: [baseRule({ type: "percentage", value: 150 })], currency: "INR" }).totals.promotionDiscountTotal, 0, "invalid discount config produces no misleading display");

const modal = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");
assert.match(modal, /buildPromotionViewModel/, "Express Checkout summary uses shared Promotion View Model");
assert.doesNotMatch(modal, /Total payable is unchanged in Express Checkout until checkout enforcement\/payment integration is enabled/, "Express Checkout no longer shows estimated-only payable clarification");
console.log("Promotion pricing resolver regression checks passed");
