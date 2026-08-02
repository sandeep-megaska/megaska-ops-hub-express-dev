import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync("extensions/megaska-otp/assets/loopdesk-cart-drawer.js", "utf8");
const css = readFileSync("extensions/megaska-otp/assets/loopdesk-cart-drawer.css", "utf8");

// PR-1 of the Shopify-Checkout migration: a flag-gated drawer block that lets the
// shopper choose Prepaid vs COD (with both prices) and records it as a cart
// attribute for the discount + validation Functions. Must be OFF by default so
// the live drawer is unchanged until a merchant opts in.

test("payment choice is a config flag, default OFF", () => {
  assert.match(src, /paymentChoiceEnabled: false/, "DEFAULT_CONFIG must default the flag to false");
  assert.match(src, /paymentChoiceEnabled: bool\(firstDefined\(cart\.paymentChoiceEnabled/, "normalizeConfig must read the flag");
});

test("the block only renders when the flag is on and there are items", () => {
  assert.match(src, /config\.cart\.paymentChoiceEnabled && hasItems && pricing/, "render must gate on the flag + items + pricing");
});

test("choosing a method persists a cart attribute for the Functions", () => {
  assert.match(src, /loopd2c_payment_intent: state\.paymentIntent/, "must write the loopd2c_payment_intent cart attribute");
  assert.match(src, /\/cart\/update\.js/, "must persist via /cart/update.js");
});

test("both prices are shown, prepaid discounted and COD loss-framed", () => {
  assert.match(src, /function renderPaymentChoice/, "renderPaymentChoice must exist");
  assert.match(src, /prepaidOfferSavingsMinor/, "prepaid price must use the merchant prepaid offer");
  assert.match(src, /more than online/, "COD option must be loss-framed against online");
});

test("clicking an option updates the choice and re-renders", () => {
  assert.match(src, /data-loopdesk-pay-choice/, "options must carry the choice hook");
  assert.match(src, /setPaymentIntent\(choice\.getAttribute\("data-loopdesk-pay-choice"\)\)/, "handler must set the intent from the clicked option");
});

test("styles exist for the choice block", () => {
  assert.match(css, /\.loopdesk-cart-drawer__pay-option/, "option styling must be present");
  assert.match(css, /\.loopdesk-cart-drawer__pay-option\.is-active/, "selected-state styling must be present");
});

// PR-3a: when the flag is on, prepaid (and the unset default) hands off to
// Shopify Checkout with the intent attribute persisted first, and only an
// explicit COD choice opens the modal.
test("prepaid hands off to Shopify Checkout after persisting the attribute", () => {
  assert.match(src, /function handoffPrepaidToShopifyCheckout/, "hand-off helper must exist");
  assert.match(src, /persistPaymentIntent\(\)/, "hand-off must persist the intent before navigating");
  assert.match(src, /window\.location\.assign\("\/checkout"\)/, "hand-off must navigate to Shopify Checkout");
});

test("openLoopDeskExpressCheckout routes prepaid to the hand-off, COD to the modal", () => {
  assert.match(src, /config\.cart\.paymentChoiceEnabled && paymentIntentValue\(\) !== "cod"/, "must branch on the flag + non-COD intent");
  assert.match(src, /handoffPrepaidToShopifyCheckout\(source\)/, "prepaid branch must call the hand-off");
});
