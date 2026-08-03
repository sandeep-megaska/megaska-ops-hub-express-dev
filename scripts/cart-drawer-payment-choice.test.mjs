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

test("each option is a direct-action button: sets the intent then proceeds", () => {
  assert.match(src, /data-loopdesk-pay-choice/, "options must carry the choice hook");
  assert.match(src, /var intent = choice\.getAttribute\("data-loopdesk-pay-choice"\)/, "handler must read the clicked option's intent");
  assert.match(src, /setPaymentIntent\(intent\)/, "handler must set the intent");
  // Clicking the option immediately proceeds to the flow (COD modal / prepaid).
  assert.match(src, /openExpressCheckout\(intent === "cod" \? "loopdesk-drawer-cod" : "loopdesk-drawer-prepaid"\)/, "handler must proceed to the chosen flow");
});

test("no separate Express Checkout button in choice mode; nudge suppressed", () => {
  assert.match(src, /elements\.express\.hidden = !config\.cart\.expressCheckoutButtonEnabled \|\| config\.cart\.paymentChoiceEnabled/, "express button must be hidden when the choice is active");
  assert.match(src, /!config\.cart\.paymentChoiceEnabled\) \? prepaidOfferNudgeText/, "redundant prepaid nudge must be suppressed in choice mode");
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

// OTP verification must gate BOTH flows for logged-out shoppers. COD keeps its
// in-modal gate (loopd2c-express-modal.js ensureAuthenticated); the prepaid
// hand-off gates through the OTP module before reaching Shopify Checkout.
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

test("express modal waits for the OTP/auth modules before gating (first-click race)", () => {
  assert.match(modal, /async function waitForAuthModules/, "must have a wait-for-modules helper");
  assert.match(modal, /await waitForAuthModules\(3000\)/, "ensureAuthenticated must await the modules");
});

const modal = readFileSync("extensions/megaska-otp/assets/loopd2c-express-modal.js", "utf8");

test("COD-only mode suppresses all prepaid pricing in the modal", () => {
  // A COD order must not show prepaid discounts, the prepaid offer banner, the
  // switch-to-prepaid nudge, or the Prepaid/COD comparison.
  assert.match(modal, /function prepaidSummary\(method\) \{ if \(state\.codOnly \|\| method !== "PREPAID"\)/, "prepaid discount line hidden in codOnly");
  assert.match(modal, /function prepaidOfferBanner\(\) \{ if \(state\.codOnly\) return ""/, "prepaid offer banner hidden in codOnly");
  assert.match(modal, /function prepaidNudgeMarkup\(\)[\s\S]*?if \(state\.codOnly\) return ""/, "switch-to-prepaid nudge hidden in codOnly");
  assert.match(modal, /if \(state\.codOnly\) \{\s*\n\s*return `<span>Total Payable<\/span><strong>\$\{money\(codPaise/, "footer shows COD total alone in codOnly");
  // And the intent is switched to COD at open so the summary total is the COD price.
  assert.match(modal, /if \(state\.codOnly\) \{ try \{ await ensureBackendPaymentMethod\("COD"\)/, "codOnly forces the COD backend method at open");
});

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
