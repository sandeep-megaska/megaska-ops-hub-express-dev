import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const asset = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-shopify-pricing.js", import.meta.url), "utf8");
const context = { window: {}, Intl, Date };
vm.createContext(context);
vm.runInContext(asset, context);
const { normalizeAjaxCartPricing } = context.window.LoopDeskShopifyPricing;

const baseLine = { key: "line-1", id: 1, variant_id: 11, product_id: 101, quantity: 1, title: "Base", original_line_price: 10000, final_line_price: 10000 };
const normalize = (cart) => normalizeAjaxCartPricing({ currency: "INR", token: "tok", item_count: 1, original_total_price: 10000, items_subtotal_price: 10000, total_discount: 0, total_price: 10000, items: [baseLine], ...cart });

assert.equal(normalize({}).finalTotal.amount, 10000, "no discount final total");
const loopdesk = normalize({ total_discount: 2500, total_price: 7500, items_subtotal_price: 7500, items: [{ ...baseLine, final_line_price: 7500, discounts: [{ title: "LoopDesk offer", amount: 2500 }] }] });
assert.equal(loopdesk.lines[0].discountAllocations[0].title, "LoopDesk offer", "native LoopDesk function allocation title");
assert.equal(loopdesk.lines[0].finalLineTotal.amount, 7500, "native LoopDesk function final line total");
const code = normalize({ total_discount: 1500, total_price: 8500, items_subtotal_price: 8500, cart_level_discount_applications: [{ title: "MEGA15", code: "MEGA15" }], items: [{ ...baseLine, final_line_price: 8500, discounts: [{ title: "MEGA15", amount: 1500 }] }] });
assert.equal(code.discountCodes[0].code, "MEGA15", "Shopify code label");
const combined = normalize({ total_discount: 4000, total_price: 6000, items_subtotal_price: 6000, cart_level_discount_applications: [{ code: "MEGA15" }], items: [{ ...baseLine, final_line_price: 6000, discounts: [{ title: "LoopDesk offer", amount: 2500 }, { title: "MEGA15", amount: 1500 }] }] });
assert.equal(combined.discountAllocations.length, 2, "combined discounts retain detailed allocations");
const missingDetail = normalize({ total_discount: 1000, total_price: 9000, items_subtotal_price: 9000, items: [{ ...baseLine, final_line_price: 9000 }] });
assert.equal(missingDetail.discountAllocations, null, "missing allocation detail falls back to aggregate totalDiscount");
const removed = normalize({ total_discount: 0, total_price: 10000, cart_level_discount_applications: [], items: [baseLine] });
assert.equal(removed.totalDiscount.amount, 0, "coupon removal clears total discount");
const multi = normalize({ item_count: 3, original_total_price: 30000, items_subtotal_price: 27000, total_discount: 3000, total_price: 27000, items: [baseLine, { ...baseLine, key: "line-2", variant_id: 22, quantity: 2, original_line_price: 20000, final_line_price: 17000, discounts: [{ title: "Bundle", amount: 3000 }] }] });
assert.equal(multi.lines.length, 2, "multiple cart lines");
assert.equal(multi.lines[1].quantity, 2, "multiple line quantity preserved");

const drawer = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url), "utf8");
assert.match(drawer, /fetch\("\/cart\.js"[\s\S]*state\.pricing = normalizeShopifyPricing\(cart\)/, "single cart read per refresh feeds pricing state");
assert.match(drawer, /renderLines\(cart, offerViewModel\) \+ renderPromotionOffers\(cart\)/, "rendering remains app-owned and does not require native cart-page markup");
console.log("Shopify pricing drawer regression checks passed");
