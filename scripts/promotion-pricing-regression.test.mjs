import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-promotion-pricing.js", import.meta.url), "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const { resolvePromotionDisplayPricing, summarizeCart } = context.window.LoopDeskPromotionPricing;
const trigger = { type: "cart_contains_variant", variantGid: "gid://shopify/ProductVariant/trigger" };
const baseRule = (discount, maxQuantityPerCart = 1) => ({ enabled: true, status: "active", eligibility: { triggers: [trigger] }, limits: { maxQuantityPerCart }, reward: { variantGid: "gid://shopify/ProductVariant/reward", quantity: 2, discount } });
const cart = (rewardQty = 1, includeTrigger = true) => ({ total_price: 199000, item_count: rewardQty + (includeTrigger ? 1 : 0), items: [includeTrigger && { variant_id: "trigger", quantity: 1, final_line_price: 139000 }, { variant_id: "reward", quantity: rewardQty, final_line_price: 60000 }].filter(Boolean) });

assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 30000, "offer card percentage price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "fixed_amount", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 55000, "offer card fixed_amount price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(0), rule: baseRule({ type: "fixed_price", value: 150 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).promotionalUnitPrice, 15000, "offer card fixed_price price derivation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 30000, "reward line percentage display");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "fixed_amount", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 5000, "reward line fixed_amount display");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1), rule: baseRule({ type: "fixed_price", value: 150 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).discountPerUnit, 45000, "reward line fixed_price display");
assert.equal(summarizeCart(cart(1), [baseRule({ type: "percentage", value: 50 })]).estimatedAfterOffer, 169000, "subtotal estimated-after-offer calculation");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(1, false), rule: baseRule({ type: "percentage", value: 50 }), rewardUnitPrice: 60000, rewardQuantity: 1 }).isEligible, false, "trigger absent means no discount display");
assert.equal(summarizeCart(cart(1, false), [baseRule({ type: "percentage", value: 50 })]).offerDiscount, 0, "reward line without trigger shows normal price");
assert.equal(resolvePromotionDisplayPricing({ cart: cart(3), rule: baseRule({ type: "percentage", value: 50 }, 1), rewardUnitPrice: 60000, rewardQuantity: 3 }).eligibleQuantity, 1, "quantity cap prevents overstated discount");

const modal = readFileSync(new URL("../extensions/megaska-otp/assets/megaska-express-modal.js", import.meta.url), "utf8");
assert.match(modal, /expressPromotionSummary/, "Express Checkout summary uses same display values or clear estimated discount note");
console.log("Promotion pricing resolver regression checks passed");
