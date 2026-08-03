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
  assert.match(src, /paymentChoiceActive\(\) && hasItems\b/, "render must gate on the choice being active + items");
  assert.doesNotMatch(src, /paymentChoiceActive\(\) && hasItems && pricing/, "render must not require the pricing object");
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

test("payment-choice base is intent-neutral (never double-counts an already-applied prepaid discount)", () => {
  // When the cart already carries loopd2c_payment_intent=prepaid, cart.total_price
  // already includes the prepaid saving; the shared helper adds it back to recover
  // the COD base rather than subtracting prepaid a second time.
  assert.match(src, /function choicePrices\(pricing, cart\)/, "shared intent-neutral price helper must exist");
  assert.match(src, /cart\.attributes && cart\.attributes\.loopd2c_payment_intent\)[\s\S]*?=== "prepaid"/, "must read the current intent from the same cart fetch");
  assert.match(src, /var codBase = payable \+ \(prepaidApplied \? prepaidSavings : 0\)/, "COD base must add prepaid back when it is already applied to the cart total");
});

test("cart drawer reuses the PDP pincode result to show a delivery estimate", () => {
  // The product-page 'mg-pincode-widget' caches its Delhivery result under
  // megaska_delivery_pin_result; the drawer reads it (same domain) and shows a
  // "Delivering to <city> · Expected by <date>" banner - no re-entry, no API call.
  assert.match(src, /megaska_delivery_pin_result/, "must read the PDP widget's cached pincode result");
  assert.match(src, /function renderDeliveryEstimate/, "delivery-estimate renderer must exist");
  assert.match(src, /\+ renderDeliveryEstimate\(\)/, "must be rendered into the drawer body");
  assert.match(src, /Delivering to /, "must show the destination");
  assert.match(src, /Expected by /, "must show the expected delivery date");
  assert.match(css, /\.loopdesk-cart-drawer__delivery\b/, "delivery banner styling must exist");
});

test("the You-pay summary labels the prepaid price and states the COD price (choice mode)", () => {
  // Removes the ambiguity between the summary total and the two CTA prices, without
  // touching any discount logic - text/style only, using the same price helper.
  assert.match(src, /data-loopdesk-pay-note/, "a clarifying pay-note element must exist");
  assert.match(src, /You pay online/, "the summary must label the prepaid total as the online price");
  assert.match(src, /Cash on Delivery ' \+ money\(cp\.codBase/, "the note must state the COD price alongside");
  assert.match(css, /\.loopdesk-cart-drawer__pay-note\b/, "pay-note styling must exist");
});

test("each option is a direct-action button: sets the intent then proceeds", () => {
  assert.match(src, /data-loopdesk-pay-choice/, "options must carry the choice hook");
  assert.match(src, /var intent = choice\.getAttribute\("data-loopdesk-pay-choice"\)/, "handler must read the clicked option's intent");
  assert.match(src, /setPaymentIntent\(intent\)/, "handler must set the intent");
  // Clicking the option immediately proceeds to the flow (COD modal / prepaid).
  assert.match(src, /openExpressCheckout\(intent === "cod" \? "loopdesk-drawer-cod" : "loopdesk-drawer-prepaid"\)/, "handler must proceed to the chosen flow");
});

test("no separate Express Checkout button in choice mode; nudge suppressed", () => {
  assert.match(src, /elements\.express\.hidden = !config\.cart\.expressCheckoutButtonEnabled \|\| paymentChoiceActive\(\)/, "express button must be hidden when the choice is active");
  assert.match(src, /!paymentChoiceActive\(\)\) \? prepaidOfferNudgeText/, "redundant prepaid nudge must be suppressed in choice mode");
});

test("only the CTA is pinned in the sticky footer; totals/trust/fine-print scroll", () => {
  // The tall summary was eating the drawer; it now scrolls with the cart while the
  // payment CTA stays pinned, so more cart content is visible.
  assert.match(src, /class="loopdesk-cart-drawer__scroll"/, "a scroll wrapper must exist");
  assert.match(src, /class="loopdesk-cart-drawer__summary"/, "totals/trust/fine-print live in a scrollable summary block");
  assert.match(css, /\.loopdesk-cart-drawer__scroll \{[\s\S]*?overflow-y: auto/, "the scroll wrapper is the scroll region");
  const footer = src.match(/<footer class="loopdesk-cart-drawer__footer">[\s\S]*?<\/footer>/);
  assert.ok(footer, "footer must be present");
  assert.match(footer[0], /data-loopdesk-payment-choice/, "footer keeps the payment-choice CTA");
  assert.doesNotMatch(footer[0], /data-loopdesk-cart-subtotal|loopdesk-cart-drawer__microcopy/, "footer must not carry the totals rows or fine print");
});

test("styles exist for the choice block (primary/secondary CTA buttons)", () => {
  assert.match(css, /\.loopdesk-cart-drawer__pay-option/, "option styling must be present");
  assert.match(css, /\.loopdesk-cart-drawer__pay-option--primary/, "prepaid primary-button styling must be present");
  assert.match(css, /\.loopdesk-cart-drawer__pay-option--secondary/, "COD secondary-button styling must be present");
});

test("the Pay Online option lists accepted online methods (self-contained badges)", () => {
  // A generic accepted-methods strip (no third-party brand marks) under Pay Online.
  assert.match(src, /loopdesk-cart-drawer__pay-methods/, "methods strip must render");
  assert.match(src, /\["UPI", "Cards", "Net Banking", "Wallets"\]/, "generic method labels must be present");
  assert.match(src, /opt\("prepaid", "primary"[\s\S]*?methodsHtml\)/, "methods strip must attach to the Pay Online option only");
  assert.match(css, /\.loopdesk-cart-drawer__pay-method \{/, "method badge styling must exist");
});

test("collapsed-CTA experiment: flag-gated Place Order button that expands to the choice", () => {
  // A default-OFF experiment: one "Place Order" button that reveals the priced
  // Prepaid/COD options on click, to test whether it reduces drawer confusion.
  assert.match(src, /paymentChoiceCollapsed: false/, "DEFAULT_CONFIG must default the collapsed flag to false");
  assert.match(src, /paymentChoiceCollapsed: bool\(firstDefined\(cart\.paymentChoiceCollapsed/, "normalizeConfig must read the collapsed flag");
  assert.match(src, /if \(config\.cart\.paymentChoiceCollapsed && !state\.payChoiceExpanded\)/, "collapsed mode renders only behind the flag, until expanded");
  // The collapse flag is self-sufficient: it activates the choice on its own,
  // without also needing paymentChoiceEnabled (regression from the first attempt).
  assert.match(src, /config\.cart\.paymentChoiceEnabled \|\| config\.cart\.paymentChoiceCollapsed/, "paymentChoiceActive must treat the collapse flag as activating the choice");
  assert.match(src, /data-loopdesk-place-order/, "a Place Order button must render in collapsed mode");
  assert.match(src, /closest\("\[data-loopdesk-place-order\]"\)[\s\S]*?state\.payChoiceExpanded = true/, "clicking Place Order expands to the options");
  assert.match(src, /if \(open && !state\.open\) state\.payChoiceExpanded = false/, "each fresh open starts collapsed");
  assert.match(css, /\.loopdesk-cart-drawer__place-order \{/, "Place Order button styling must exist");
});

// Phase 2 (modal-free): with the flag on, BOTH prepaid and COD hand off to
// native Shopify Checkout - the chosen intent is persisted, then the shared OTP
// gate runs. The COD-only modal is retired from this path.
test("the shared hand-off persists the chosen intent then navigates to Shopify Checkout", () => {
  assert.match(src, /function handoffToShopifyCheckout\(intent, source\)/, "generalized hand-off helper must exist");
  assert.match(src, /state\.paymentIntent = intent === "cod" \? "cod" : "prepaid"/, "hand-off must set the chosen intent");
  assert.match(src, /handoffToShopifyCheckout[\s\S]*?persistPaymentIntent\(\)/, "hand-off must persist the intent before navigating");
  assert.match(src, /handoffToShopifyCheckout[\s\S]*?window\.location\.assign\("\/checkout"\)/, "hand-off must navigate to Shopify Checkout (fallback)");
});

test("choice mode routes BOTH prepaid and COD through the native hand-off (no modal)", () => {
  assert.match(src, /if \(choiceMode\) \{\s*handoffToShopifyCheckout\(paymentIntentValue\(\) === "cod" \? "cod" : "prepaid", source\)/, "choice mode must hand both intents off natively");
  // The COD-only modal open must no longer be reachable from the choice path.
  assert.doesNotMatch(src, /codOnly: codChoice/, "COD-only modal open must be retired from the drawer");
  assert.doesNotMatch(src, /var codChoice = /, "the codChoice modal branch must be gone");
});

test("each intent labels its OTP trigger source", () => {
  assert.match(src, /var triggerSource = "loopdesk-drawer-" \+ state\.paymentIntent/, "trigger source must reflect the chosen intent");
});

test("a hand-off overlay bridges the gap until Shopify Checkout paints", () => {
  // Between the CTA and the checkout page there is a ~1s gap; a full-screen
  // "Proceeding to secure checkout" overlay reassures the shopper.
  assert.match(src, /function showCheckoutHandoffOverlay/, "overlay helper must exist");
  assert.match(src, /Proceeding to secure checkout/, "overlay must show a proceeding message");
  assert.match(src, /handoffToShopifyCheckout[\s\S]*?showCheckoutHandoffOverlay\(\)/, "the native hand-off must show the overlay");
  // If the OTP modal opens instead of navigating, the overlay is dropped.
  assert.match(src, /if \(navigated === false\) hideCheckoutHandoffOverlay\(\)/, "overlay must be hidden when the OTP modal opens instead");
  assert.match(css, /\.loopdesk-checkout-handoff\b/, "overlay styling must exist");
});

// OTP verification must gate BOTH flows for logged-out shoppers. Both COD and
// prepaid hand off through the OTP module (beginGatedShopifyCheckout) before
// reaching native Shopify Checkout - there is no in-modal gate any more.
test("prepaid hand-off gates through OTP before Shopify Checkout", () => {
  assert.match(src, /window\.MegaskaOtp\.beginGatedShopifyCheckout/, "prepaid must gate via the OTP module");
  // Direct navigate remains only as a fallback when the OTP module is absent.
  assert.match(src, /beginGatedShopifyCheckout[\s\S]*?window\.location\.assign\("\/checkout"\)/, "direct navigate must be the fallback path");
});

const otp = readFileSync("extensions/megaska-otp/assets/loopd2c-otp.js", "utf8");

test("OTP: no premature guard error when the modal is the prompt", () => {
  // When the reason opens the OTP modal, the guard error message is suppressed
  // (the modal itself explains why login is needed).
  assert.match(otp, /const opensModal = \["no-session", "no-verified-phone"\]\.includes\(validation\.reason\)/, "must detect modal-opening reasons");
  assert.match(otp, /message: opensModal \? "" : validation\.message/, "must suppress the guard message when opening the modal");
});

// The COD-only express modal has been retired; both flows finish in native
// Shopify Checkout, so the modal's codOnly behaviour is no longer asserted here.

test("OTP module exposes a session-gated Shopify Checkout hand-off with prefill", () => {
  assert.match(otp, /async function beginGatedShopifyCheckout/, "beginGatedShopifyCheckout must exist");
  assert.match(otp, /beginGatedShopifyCheckout,/, "it must be exported on window.MegaskaOtp");
  // Gates on verified session state (not the checkout-page phone-field match)
  // and continues with the shared prefill + buyer-identity handoff.
  assert.match(otp, /gateState\.authenticated && gateState\.verifiedPhonePresent/, "must gate on the verified session state");
  assert.match(otp, /continueToCheckoutFromPendingAction\(gateState\.customer/, "authed path must continue with prefill");
  assert.match(otp, /setPendingAction\(\{ type: "navigate", url: "\/checkout" \}\)/, "unauthed path must queue the navigate resume");
});
