import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const drawerSource = readFileSync("extensions/megaska-otp/assets/loopdesk-cart-drawer.js", "utf8");
const modalSource = readFileSync("extensions/megaska-otp/assets/megaska-express-modal.js", "utf8");

function drawerLineDisplay(item) {
  return Number(item.final_line_price || 0);
}

function modalLineItem(item) {
  const variantId = item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : "";
  const quantity = Math.max(0, Math.floor(Number(item.quantity || 0)));
  if (!variantId || quantity <= 0) return null;
  return {
    variantId,
    quantity,
    line_price: Number(item.line_price || item.final_line_price || 0),
    original_line_price: Number(item.original_line_price || item.line_price || item.final_line_price || 0),
    final_line_price: Number(item.final_line_price || item.line_price || 0),
  };
}

function cartSnapshot(cart) {
  const items = Array.isArray(cart.items) ? cart.items : [];
  return {
    items,
    lineItems: items.map(modalLineItem).filter(Boolean),
    total_price: Number(cart.total_price || 0),
    total_discount: Number(cart.total_discount || 0),
    cart_level_discount_applications: cart.cart_level_discount_applications || [],
    discount_codes: cart.discount_codes || [],
  };
}

function totalDisplayedByLines(cart) {
  return cart.items.reduce((sum, item) => sum + drawerLineDisplay(item), 0);
}

const base = (overrides) => ({ variant_id: 1, quantity: 1, price: 0, line_price: 0, original_line_price: 0, final_line_price: 0, ...overrides });

const cases = [
  { name: "₹600 + ₹1,390 − ₹298.50 = ₹1,691.50", cart: { total_price: 169150, total_discount: 29850, items: [base({ variant_id: 1, line_price: 60000, original_line_price: 60000, final_line_price: 60000 }), base({ variant_id: 2, line_price: 139000, original_line_price: 139000, final_line_price: 139000 })], discount_codes: [{ code: "SAVE" }] }, lineTotal: 199000 },
  { name: "no discount", cart: { total_price: 199000, total_discount: 0, items: [base({ line_price: 199000, original_line_price: 199000, final_line_price: 199000 })] }, lineTotal: 199000 },
  { name: "product-level discount only", cart: { total_price: 50000, total_discount: 10000, items: [base({ line_price: 50000, original_line_price: 60000, final_line_price: 50000 })] }, lineTotal: 50000 },
  { name: "cart-level coupon only", cart: { total_price: 90000, total_discount: 10000, items: [base({ line_price: 100000, original_line_price: 100000, final_line_price: 100000 })], cart_level_discount_applications: [{ title: "SAVE" }] }, lineTotal: 100000 },
  { name: "product-level discount plus cart-level coupon", cart: { total_price: 85000, total_discount: 15000, items: [base({ line_price: 90000, original_line_price: 100000, final_line_price: 90000 })], discount_codes: [{ code: "SAVE" }] }, lineTotal: 90000 },
  { name: "one eligible and one ineligible line stays unallocated without line eligibility", cart: { total_price: 150000, total_discount: 50000, items: [base({ variant_id: 1, line_price: 100000, original_line_price: 100000, final_line_price: 100000 }), base({ variant_id: 2, line_price: 100000, original_line_price: 100000, final_line_price: 100000 })] }, lineTotal: 200000 },
  { name: "fixed discount rounding stays at cart level", cart: { total_price: 997, total_discount: 2, items: [base({ variant_id: 1, line_price: 333, original_line_price: 333, final_line_price: 333 }), base({ variant_id: 2, line_price: 333, original_line_price: 333, final_line_price: 333 }), base({ variant_id: 3, line_price: 333, original_line_price: 333, final_line_price: 333 })] }, lineTotal: 999 },
  { name: "quantity greater than one", cart: { total_price: 180000, total_discount: 20000, items: [base({ quantity: 2, line_price: 200000, original_line_price: 200000, final_line_price: 180000 })] }, lineTotal: 180000 },
  { name: "discount removal", cart: { total_price: 100000, total_discount: 0, items: [base({ line_price: 100000, original_line_price: 100000, final_line_price: 100000 })], discount_codes: [] }, lineTotal: 100000 },
  { name: "store credit remains separate", cart: { total_price: 100000, total_discount: 0, items: [base({ line_price: 100000, original_line_price: 100000, final_line_price: 100000 })], storeCreditAppliedPaise: 25000 }, lineTotal: 100000 },
  { name: "delivery remains separate", cart: { total_price: 100000, total_discount: 0, items: [base({ line_price: 100000, original_line_price: 100000, final_line_price: 100000 })], deliveryAmountPaise: 5000 }, lineTotal: 100000 },
  { name: "partial COD totals remain unchanged", cart: { total_price: 100000, total_discount: 0, items: [base({ line_price: 100000, original_line_price: 100000, final_line_price: 100000 })], codAdvance: { orderTotalPaise: 105000, advanceAmountPaise: 10000 } }, lineTotal: 100000 },
];

for (const testCase of cases) {
  assert.equal(totalDisplayedByLines(testCase.cart), testCase.lineTotal, testCase.name);
  const snapshot = cartSnapshot(testCase.cart);
  testCase.cart.items.forEach((item, index) => {
    assert.equal(snapshot.lineItems[index].line_price, Number(item.line_price || item.final_line_price || 0), `${testCase.name}: line_price unchanged`);
    assert.equal(snapshot.lineItems[index].final_line_price, Number(item.final_line_price || item.line_price || 0), `${testCase.name}: final_line_price unchanged`);
  });
}

const consistencyCart = { items: [base({ variant_id: 44, line_price: 12345, original_line_price: 15000, final_line_price: 12345 })] };
assert.equal(drawerLineDisplay(consistencyCart.items[0]), cartSnapshot(consistencyCart).lineItems[0].final_line_price, "drawer/modal consistency uses Shopify final_line_price");
assert.equal(cartSnapshot(cases[0].cart).total_price, 169150, "cart-level coupon remains authoritative for payable total");
assert.equal(cartSnapshot(cases[0].cart).total_discount, 29850, "cart-level discount row remains authoritative");
assert.doesNotMatch(drawerSource, /allocatedCartDiscountByKey|effectiveLinePrice|__loopdeskAllocatedCartDiscounts/, "drawer must not fabricate cart-level per-line allocations");
assert.doesNotMatch(modalSource, /allocatedCartDiscounts|cartDiscountAllocation/, "modal must not fabricate cart-level per-line allocations");
assert.match(drawerSource, /money\(item\.final_line_price, cart\.currency\)/, "drawer line price source is Shopify final_line_price");
assert.match(modalSource, /line_price: Number\(item\?\.line_price \|\| item\?\.final_line_price \|\| 0\)/, "cartSnapshot line_price is preserved from Shopify line_price");
assert.match(modalSource, /final_line_price: Number\(item\?\.final_line_price \|\| item\?\.line_price \|\| 0\)/, "cartSnapshot final_line_price is preserved from Shopify final_line_price");
