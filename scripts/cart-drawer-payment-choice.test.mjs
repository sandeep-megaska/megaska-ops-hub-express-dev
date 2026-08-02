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

test("the flag survives the async runtime-config fetch (re-normalize + re-render)", () => {
  // paymentChoiceEnabled is NOT a theme-block setting; it only arrives via the
  // async runtime-config fetch, which resolves after this script computes
  // `config`. Without re-normalizing on runtime-config-ready, the flag stays
  // frozen false and the choice never renders. Regression guard for that bug.
  assert.match(src, /addEventListener\("loopdesk:runtime-config-ready"/, "drawer must listen for the runtime config");
  assert.match(src, /loopdesk:runtime-config-ready"[\s\S]*?config = normalizeConfig\(window\.LoopDeskConfig/, "must re-normalize config when the runtime config lands");
  assert.match(src, /loopdesk:runtime-config-ready"[\s\S]*?getElementById\(ROOT_ID\)\) render\(\)/, "must re-render after re-normalizing");
});

test("the block renders when the flag is on and there are items (independent of promotion pricing)", () => {
  // Prepaid savings come from LoopDeskConfig.prepaidOffer, so the choice must NOT
  // depend on the promotion-pricing object being built.
  assert.match(src, /config\.cart\.paymentChoiceEnabled && hasItems\b/, "render must gate on the flag + items");
  assert.doesNotMatch(src, /config\.cart\.paymentChoiceEnabled && hasItems && pricing/, "render must not require the pricing object");
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
  assert.match(src, /choiceMode && paymentIntentValue\(\) !== "cod"/, "must branch on the flag + non-COD intent");
  assert.match(src, /handoffPrepaidToShopifyCheckout\(source\)/, "prepaid branch must call the hand-off");
});

test("COD choice opens the modal without a Razorpay requirement, in COD-only mode", () => {
  // The COD path must not require provider === "razorpay" (Razorpay is retired
  // for the in-modal capture); it opens whenever the module is ready for COD.
  assert.match(src, /var codChoice = choiceMode && paymentIntentValue\(\) === "cod"/, "must detect the COD choice");
  assert.match(src, /codChoice[\s\S]*?readiness\.codAvailable === true \|\| readiness\.ready === true/, "COD path must gate on cod-availability, not Razorpay");
  assert.match(src, /MegaskaExpressCheckout\.open\(\{ source: checkoutSource, codOnly: codChoice \}\)/, "must open the modal in COD-only mode for the COD choice");
});

// OTP verification must gate BOTH flows for logged-out shoppers. COD keeps its
// in-modal gate (loopd2c-express-modal.js ensureAuthenticated); the prepaid
// hand-off gates through the OTP module before reaching Shopify Checkout.
test("prepaid hand-off gates through OTP before Shopify Checkout", () => {
  assert.match(src, /window\.MegaskaOtp\.beginGatedShopifyCheckout/, "prepaid must gate via the OTP module");
  // Direct navigate remains only as a fallback when the OTP module is absent.
  assert.match(src, /beginGatedShopifyCheckout[\s\S]*?window\.location\.assign\("\/checkout"\)/, "direct navigate must be the fallback path");
});

const otp = readFileSync("extensions/megaska-otp/assets/loopd2c-otp.js", "utf8");

const modal = readFileSync("extensions/megaska-otp/assets/loopd2c-express-modal.js", "utf8");

test("express modal supports a COD-only mode driven by the open() option", () => {
  assert.match(modal, /state\.codOnly = Boolean\(opts\?\.codOnly\)/, "open() must read the codOnly option");
  assert.match(modal, /state\.codOnly[\s\S]*?state\.selectedDisplayPaymentMethod = "COD"/, "codOnly must preselect COD");
  // COD-only mode filters the method list down to the COD row (no Razorpay).
  assert.match(modal, /state\.codOnly\s*\n?\s*\?\s*DISPLAY_PAYMENT_METHODS\.filter\(\(method\) => method\.backendMethod === "COD"\)/, "codOnly must present COD alone");
  // The OTP re-open after verification must preserve COD-only mode.
  assert.match(modal, /callback: \(\) => open\(\{ triggerEl, codOnly: Boolean\(reopenOpts\?\.codOnly\) \}\)/, "OTP re-open must keep codOnly");
});

test("OTP module exposes a session-gated Shopify Checkout hand-off with prefill", () => {
  assert.match(otp, /async function beginGatedShopifyCheckout/, "beginGatedShopifyCheckout must exist");
  assert.match(otp, /beginGatedShopifyCheckout,/, "it must be exported on window.MegaskaOtp");
  // Gates on verified session state (not the checkout-page phone-field match)
  // and continues with the shared prefill + buyer-identity handoff.
  assert.match(otp, /gateState\.authenticated && gateState\.verifiedPhonePresent/, "must gate on the verified session state");
  assert.match(otp, /continueToCheckoutFromPendingAction\(gateState\.customer/, "authed path must continue with prefill");
  assert.match(otp, /setPendingAction\(\{ type: "navigate", url: "\/checkout" \}\)/, "unauthed path must queue the navigate resume");
});
