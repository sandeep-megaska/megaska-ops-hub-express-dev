import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-cart-drawer.css", import.meta.url), "utf8");

const embed = readFileSync(new URL("../extensions/megaska-otp/blocks/loopdesk-cart-drawer-embed.liquid", import.meta.url), "utf8");

// MONEY-FMT: prices in the drawer must honour the store's Shopify money format
// (including a "no decimals" format, e.g. ₹630 not ₹629.95) rather than forcing
// the currency's default fraction digits.
const moneyFn = source.match(/function money\(cents, currency\) \{[\s\S]*?\n {2}\}/);
assert.ok(moneyFn, "money() formatter should exist");
assert.match(moneyFn[0], /shopify\.money_format/, "money() must read the store's Shopify money_format");
assert.match(moneyFn[0], /shopify\.formatMoney/, "money() should prefer Shopify.formatMoney so it matches the theme exactly");
assert.match(source, /function moneyFractionDigits\([\s\S]*?no_decimals/, "fraction digits must derive from the money format (no_decimals => 0)");

// TIER-LABEL: the order (tier) discount must read as a self-explanatory line,
// not a bare "Tier discount" lump — it derives the effective percentage from the
// classified order savings so the shopper sees "Order discount (5% off)".
assert.match(source, /orderLabel = orderPct > 0 \? "Order discount \(" \+ displayPercentage\(orderPct\)/, "the order savings row must show a self-explanatory 'Order discount (X% off)' label");
assert.match(source, /label: orderLabel,/, "the order savings row must use the dynamic order label");
assert.doesNotMatch(source, /label: "Tier discount"/, "the bare 'Tier discount' label must be replaced");

const immediateAssetLoad = embed.match(/var drawerAssetRequested = false;[\s\S]*?function loadDrawerAsset\(\) \{[\s\S]*?fetch\(runtimeUrl,/);
assert.ok(immediateAssetLoad, "drawer asset loading should be declared and requested before the runtime config fetch");
assert.match(immediateAssetLoad[0], /var drawerAssetRequested = false;[\s\S]*function loadDrawerAsset\(\) \{[\s\S]*if \(drawerAssetRequested\) return;[\s\S]*drawerAssetRequested = true;/, "drawer asset loading should use one idempotent insertion guard");
assert.match(immediateAssetLoad[0], /loadDrawerAsset\(\);[\s\S]*if \(typeof fetch === 'function'\) \{[\s\S]*fetch\(runtimeUrl,/, "drawer asset loading should start independently before runtime config fetching");
assert.doesNotMatch(embed, /\.then\(loadDrawerAsset\)/, "runtime config completion must not trigger drawer asset loading");
assert.doesNotMatch(embed, /LoopDeskCartBootstrap/, "the removed cart bootstrap must remain absent");
assert.doesNotMatch(embed, /applyRuntimeConfig/, "the removed runtime config application helper must remain absent");

// CART-NAV-3: the embed's inline bounce-back check is a fast-path duplicate
// of bounceBackFromUnwantedCartPageNavigation()/recordCartAddReturnIntent()
// in loopdesk-cart-drawer.js, run synchronously before any deferred asset
// fetch to minimize the visible flash of the native cart page. It must use
// the exact same sessionStorage keys and max-age as the main script, or the
// fast path silently stops working while the slower fallback masks it.
assert.ok(embed.indexOf('<script>') < embed.indexOf("RETURN_KEY = \"loopdeskCartAddReturnTo\""), "the inline bounce-back check must run before the drawer CSS/asset script tags");
assert.match(embed, /RETURN_KEY = "loopdeskCartAddReturnTo";/, "the embed's fast-path key must match the main script's CART_ADD_RETURN_KEY");
assert.match(embed, /REOPEN_KEY = "loopdeskCartAddReopenDrawer";/, "the embed's fast-path key must match the main script's CART_ADD_REOPEN_KEY");
assert.match(embed, /MAX_AGE_MS = 8000;/, "the embed's fast-path max-age must match the main script's CART_ADD_RETURN_MAX_AGE_MS");
assert.match(source, /CART_ADD_RETURN_KEY = "loopdeskCartAddReturnTo";/, "the main script's return key must match the embed's fast-path RETURN_KEY");
assert.match(source, /CART_ADD_REOPEN_KEY = "loopdeskCartAddReopenDrawer";/, "the main script's reopen key must match the embed's fast-path REOPEN_KEY");
assert.match(source, /CART_ADD_RETURN_MAX_AGE_MS = 8000;/, "the main script's max-age must match the embed's fast-path MAX_AGE_MS");

const ownershipDecision = source.match(/function cartOwnershipDecision\(capability\) \{[\s\S]*?\n  \}\n\n  function isLoopDeskDrawerActive/);
assert.ok(ownershipDecision, "cart ownership decision helper should exist");
assert.match(ownershipDecision[0], /config\.cart\.drawerMode === "theme"[\s\S]*reason = "theme-mode"/, "theme mode must remain fallback-owned");
assert.match(ownershipDecision[0], /ownershipMode = active \? "loopdesk" : "fallback"/, "passing capability checks should select LoopDesk ownership");
assert.doesNotMatch(ownershipDecision[0], /drawerMode === "auto"[\s\S]*fallback/, "auto mode must not force fallback ownership");
assert.match(ownershipDecision[0], /debugLog\("ownership decision", \{[\s\S]*drawerMode:[\s\S]*cartOwnershipMode:[\s\S]*enabled:[\s\S]*hasController:[\s\S]*hasCartApi:[\s\S]*hasRoot:[\s\S]*reason:/, "ownership diagnostics must include the required fields");

const activeDecision = source.match(/function isLoopDeskDrawerActive\(\) \{[\s\S]*?\n  \}/);
assert.ok(activeDecision, "active drawer helper should exist");
assert.match(activeDecision[0], /return cartOwnershipDecision\(capability\)\.active;/, "cart icon listener should use the ownership decision to activate LoopDesk");

const triggerHandler = source.match(/function handleCartTriggerEvent\(event\) \{[\s\S]*?\n  \}/);
assert.ok(triggerHandler, "cart trigger handler should exist");
assert.match(triggerHandler[0], /var active = isLoopDeskDrawerActive\(\);/, "cart trigger handler should evaluate active ownership");
assert.match(triggerHandler[0], /return ownCartTriggerEvent\(event, trigger, event\.type\);/, "active ownership should route cart icon events to LoopDesk drawer opening");

// CART-UAT-1A: delegated capture is the navigation-safety boundary. These
// checks intentionally cover the source contract without advancing takeover's
// debounce timer, because cloning must only be a compatibility enhancement.
assert.match(source, /function listenForCartLinks\(\) \{[\s\S]*\["pointerdown", "mousedown", "touchstart", "click", "keydown"\][\s\S]*document\.addEventListener\(eventName, handleCartTriggerEvent, true\)/, "Case A: every cart interaction should be captured synchronously at document level");
assert.doesNotMatch(triggerHandler[0], /isDrawerAvailable\(\)\) return/, "Case A: interception must not wait for takeover or a mounted root");
assert.match(source, /function findCartTrigger\(target\) \{[\s\S]*target\.closest\("a\[href\]"\)[\s\S]*hasCartPath/, "Case B: nested SVG/path targets should resolve through their closest cart anchor");
assert.doesNotMatch(triggerHandler[0], /if \([^\n]*data-loopdesk-cart-trigger/, "Cases A-C: delegated interception must not require a cloned/owned trigger marker");
assert.match(source, /function scheduleCartTriggerTakeover\(reason\)[\s\S]*}, 80\);/, "Case C fixture: mutation takeover remains debounced");
assert.match(source, /applyCartTriggerTakeover\(\);\n  observeCartTriggerTakeoverTargets\(\);/, "Case C: present triggers get synchronous compatibility takeover while delegated capture protects replacements");
assert.match(triggerHandler[0], /event\.key !== "Enter" && event\.key !== " "/, "Case D: Enter and Space should be the only intercepted key activations");
assert.match(source, /function isDuplicateCartTriggerEvent\(event, trigger\)[\s\S]*event\.type === "keydown"[\s\S]*suppressNextCartClickUntil > Date\.now\(\)[\s\S]*sameCartTrigger/, "Case E: one pointer/mouse/click interaction should have one open path");
assert.match(source, /function ownCartTriggerEvent\(event, trigger, action\) \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*event\.stopImmediatePropagation/, "owned cart interactions should prevent default and both propagation paths");
assert.match(source, /function isInsideLoopDeskDrawer\(element\)[\s\S]*closest\("#" \+ ROOT_ID\)/, "Case F: LoopDesk View Cart remains excluded by the drawer-root boundary");
assert.match(triggerHandler[0], /if \(!active\) \{[\s\S]*fallback theme behavior allowed[\s\S]*return;/, "Case G: inactive ownership should preserve normal theme navigation");
assert.match(source, /function openLoopDeskCartFromTrigger\(trigger, action\)[\s\S]*deferredCartOpen[\s\S]*\[0, 50, 150, 300\][\s\S]*DOMContentLoaded/, "Case H: an early interaction should use bounded deferred mount/open retries");

// CART-UNIVERSAL-1: merchants can supply an escape-hatch CSS selector for
// themes whose cart icon markup doesn't match any known naming convention,
// and icon glyph text (SVG use/img alt) counts as a positive cart signal.
assert.match(source, /function getCustomCartTriggerSelector\(\) \{[\s\S]*try \{[\s\S]*document\.querySelectorAll\(trimmed\);[\s\S]*return trimmed;[\s\S]*catch \(_error\) \{[\s\S]*return "";/, "Case I: an invalid merchant-supplied selector must be caught and ignored, not throw");
assert.match(source, /if \(CUSTOM_CART_TRIGGER_SELECTOR\) \{[\s\S]*var customTrigger = target\.closest\(CUSTOM_CART_TRIGGER_SELECTOR\);[\s\S]*return customTrigger;/, "Case I: a merchant custom selector match should be treated as an authoritative cart trigger");
assert.match(source, /function iconGlyphText\(element\)[\s\S]*querySelectorAll\("use"\)[\s\S]*getAttribute\("href"\) \|\| [\s\S]*getAttribute\("xlink:href"\)/, "Case J: SVG <use> icon references should count as a cart-icon signal for icon-only triggers");
assert.match(source, /CART_TRIGGER_KEYWORD_REGEX = \/\\b\(cart\|bag\|basket\|trolley\)\\b/, "Case J: regional cart synonyms (bag/basket/trolley) should be recognized");
assert.match(source, /document\.querySelectorAll\(COMBINED_CART_TRIGGER_SELECTOR\)/, "Case I: the compatibility takeover should also clone merchant custom-selector triggers");
assert.match(source, /runtimeConfig\.cart\.customTriggerSelector !== config\.cart\.customTriggerSelector\)[\s\S]*CUSTOM_CART_TRIGGER_SELECTOR = getCustomCartTriggerSelector\(\);/, "Case I: a late-arriving runtime config should refresh the custom selector without a page reload");
assert.doesNotMatch(source.match(/function ownCartTriggerEvent\(event, trigger, action\)[\s\S]*?\n  \}/)[0], /fallbackToCartPage/, "an owned interaction must never fall through to /cart after interception");

// CART-ATC-1: an "add to bag/basket/trolley" control (e.g. a custom mobile
// sticky/floating ATC bar that opens a size selector before adding) is an ADD
// action, never a cart-OPEN trigger. It must be excluded from findCartTrigger /
// the clone takeover even when it lives OUTSIDE a /cart/add form and its label
// does not literally say "cart". Misclassifying it strips the theme's native
// size-popup + ATC handlers (via cloneNode) and hijacks the tap to open an
// empty drawer instead of adding the product. Regression for the mobile
// "Add to bag" coexistence bug.
const excludedCartControl = source.match(/function isExcludedCartControl\(element\) \{[\s\S]*?\n  \}/);
assert.ok(excludedCartControl, "isExcludedCartControl helper should exist");
assert.match(excludedCartControl[0], /"\[class\*='add-to' i\]"/, "add-to-* controls outside a /cart/add form must be excluded from cart-open triggers");
assert.match(excludedCartControl[0], /"\[data-add-to-cart\]"/, "data-add-to-cart controls must be excluded from cart-open triggers");
assert.match(excludedCartControl[0], /"\[class\*='product-form__submit' i\]"/, "product-form submit controls must be excluded from cart-open triggers");
// Theme-exact hooks: the mobile floating sticky bar and its size sheet must be
// fully hands-off, including the transient "SELECT SIZE" label state that the
// text guard alone would not catch.
assert.match(excludedCartControl[0], /"\[data-product-sticky\]"/, "the theme's mobile sticky bar subtree must be excluded from cart-open triggers");
assert.match(excludedCartControl[0], /"\[data-sticky-add\]"/, "the theme's sticky ADD TO BAG button must be excluded from cart-open triggers");
assert.match(excludedCartControl[0], /"\[data-size-sheet\]"/, "the theme's size-selection sheet must be excluded from cart-open triggers");
assert.match(excludedCartControl[0], /add\(\?:ed\)\?\(\?:\\s\|-\|_\)\+to\(\?:\\s\|-\|_\)\+\(\?:\(\?:my\|your\)\(\?:\\s\|-\|_\)\+\)\?\(\?:cart\|bag\|basket\|trolley\)/, "the add-to-X text guard must cover all cart synonyms (cart/bag/basket/trolley), not just 'cart'");

const controllerOpen = source.match(/window\.LoopDeskCartController = \{[\s\S]*?open: function \(\) \{[\s\S]*?\n    \},/);
assert.ok(controllerOpen, "manual controller open helper should exist");
assert.match(controllerOpen[0], /return refreshAndMaybeOpen\(true\);/, "manual open helper should open the drawer for debugging");
assert.doesNotMatch(controllerOpen[0], /isLoopDeskDrawerActive\(\)/, "manual open helper should not be gated by cartOwnershipMode");


const renderFunction = source.match(/function render\(\) \{[\s\S]*?\n  \}\n\n  function setOpen/);
assert.ok(renderFunction, "cart drawer render function should exist");
assert.match(renderFunction[0], /var hasItems = itemCount > 0;/, "render should derive a single cart availability value");
assert.match(renderFunction[0], /elements\.body\.innerHTML = state\.error[\s\S]*renderLines\(cart\)/, "render should keep empty cart messaging sourced from renderLines");
assert.match(renderFunction[0], /elements\.express\.hidden = !config\.cart\.expressCheckoutButtonEnabled;/, "merchant setting should control express checkout visibility");
assert.match(renderFunction[0], /elements\.express\.disabled = !hasItems \|\| state\.loading \|\| state\.expressCheckoutLock;/, "empty, loading, and opening states should disable express checkout");
assert.match(renderFunction[0], /elements\.express\.setAttribute\("aria-disabled", elements\.express\.disabled \? "true" : "false"\);/, "express checkout should expose aria-disabled from the disabled state");
assert.match(renderFunction[0], /if \(state\.expressCheckoutLock\) \{[\s\S]*Opening checkout\.\.\.[\s\S]*\} else if \(!hasItems\) \{[\s\S]*Add items to checkout[\s\S]*\} else \{[\s\S]*config\.labels\.expressCheckoutText/, "express checkout label should reflect opening, empty, and enabled cart states");
assert.match(renderFunction[0], /elements\.viewCart\.hidden = !config\.cart\.viewCartButtonEnabled;/, "view cart merchant setting should still control visibility");

const interceptCheckout = source.match(/function interceptCheckout\(event, source\) \{[\s\S]*?\n  \}\n\n  var CHECKOUT_INTENT_SELECTOR/);
assert.ok(interceptCheckout, "checkout interception helper should exist");
assert.match(interceptCheckout[0], /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/, "defensive checkout guard should prevent default and propagation before returning");
assert.match(interceptCheckout[0], /if \(!state\.cart \|\| Number\(state\.cart\.item_count \|\| 0\) <= 0 \|\| state\.loading\) \{[\s\S]*return;[\s\S]*\}/, "checkout interception should fail closed for empty or loading carts");
assert.match(interceptCheckout[0], /openExpressCheckout\(source\);/, "checkout interception should still open checkout for valid carts");

assert.match(source, /Your cart is empty/, "empty cart should render the empty cart message");
assert.match(source, /Add items to checkout/, "empty cart express checkout should use disabled empty-cart label");
assert.doesNotMatch(source, /elements\.express\.hidden = !config\.cart\.expressCheckoutButtonEnabled \|\| itemCount === 0/, "empty cart should no longer hide express checkout when merchant setting is enabled");
assert.doesNotMatch(source, /megaska-otp\.js|megaska-auth\.js|megaska-express-modal\.js|loopdesk-checkout-bridge\.js/, "cart drawer regression source should not reference forbidden asset edits");

assert.match(css, /\.loopdesk-cart-drawer__express\[hidden\],[\s\S]*\.loopdesk-cart-drawer__view-cart\[hidden\] \{[\s\S]*display: none;/, "scoped hidden CSS should hide merchant-disabled express checkout and view cart fallback");
assert.doesNotMatch(css, /(^|[^_a-zA-Z0-9-])\[hidden\] \{[\s\S]*display: none;/, "hidden CSS should remain scoped, not global");
assert.match(css, /\.loopdesk-cart-drawer__express:disabled,[\s\S]*\.loopdesk-cart-drawer__express\[aria-disabled="true"\] \{[\s\S]*cursor: not-allowed;[\s\S]*box-shadow: none;[\s\S]*opacity: 0\.48;[\s\S]*filter: none;/, "disabled express checkout styling should avoid active primary affordance");
assert.match(css, /\.loopdesk-cart-drawer__express:not\(:disabled\):hover/, "express checkout hover brightening should only apply when enabled");
assert.doesNotMatch(css, /\.loopdesk-cart-drawer__express:hover,/, "disabled express checkout should not match active hover selector");

assert.match(source, /if \(wasAdd && shouldOpenLoopDeskAfterCartAdd\(\)\) return refreshAndMaybeOpen\(true\);/, "add-to-cart should only open the drawer when explicitly configured, avoiding OTP/checkout changes");
assert.match(source, /elements\.express\.addEventListener\("click", function \(event\) \{ interceptCheckout\(event, "loopdesk-cart-drawer"\); \}\);/, "express checkout OTP/checkout should remain scoped to the drawer checkout CTA");

assert.match(source, /debugState: debugState,/, "debugState helper should be exposed on the public controller");
assert.match(source, /rootClass:[\s\S]*panelClass:[\s\S]*bodyClass:[\s\S]*ariaHidden:[\s\S]*computed:[\s\S]*drawerMode:[\s\S]*ownershipMode:/, "debugState should include DOM classes, aria state, computed visibility, drawer mode, and ownership mode");
assert.match(source, /elements\.root\) elements\.root\.classList\.toggle\("loopdesk-cart-drawer--open", state\.open\)/, "open state should be reflected on the drawer root");
assert.match(css, /#loopdesk-cart-drawer-root \.loopdesk-cart-drawer[\s\S]*display: flex !important;[\s\S]*visibility: visible !important;[\s\S]*pointer-events: auto !important;/, "LoopDesk drawer panel must override broad native cart hiding selectors");
assert.match(css, /#loopdesk-cart-drawer-root \.loopdesk-cart-drawer__overlay[\s\S]*display: block !important;[\s\S]*visibility: visible !important;/, "LoopDesk overlay must override broad native cart hiding selectors");

assert.match(source, /promotions: isPlainObject\(raw\.promotions\)[\s\S]*rules: raw\.promotions\.rules/, "runtime promotions should be read from app-proxy config");
assert.match(source, /function eligiblePromotionRules\(cart\) \{[\s\S]*rule\.status !== "ACTIVE"[\s\S]*rule\.compilation\.status !== "READY"[\s\S]*isScheduleActive\(rule\)[\s\S]*triggerMatches\(cart, rule\)[\s\S]*minimumCartSubtotal[\s\S]*maximumQuantity[\s\S]*sort\(function \(a, b\) \{ return Number\(a\.priority \|\| 0\) - Number\(b\.priority \|\| 0\); \}\)/, "compiled promotion eligibility should require active READY scheduled trigger/subtotal/max quantity and ascending priority");
assert.match(source, /fetch\('\/products\/' \+ encodeURIComponent\(rule\.offer\.handle\) \+ '\.js'/, "offer availability and variants should load from the app-proxy-provided offer handle");
assert.match(source, /<select data-loopdesk-offer-variant/, "offer card should render a per-rule variant selector");
assert.match(source, /elements\.body\.addEventListener\("change", handleDrawerAction\)/, "variant selector changes should be handled through the change event");
assert.match(source, /variant\.available === false \? 'disabled'/, "unavailable offer variants should be disabled");
assert.match(source, /function isPromotionLineForAnyRule\(item\)[\s\S]*_loopdesk_promotion_rule_id[\s\S]*_loopdesk_promotion_compilation_version/, "marked promotional lines should be excluded from trigger eligibility");
assert.match(source, /function isPromotionLineForRule\(item, rule\)[\s\S]*_loopdesk_promotion_rule_id[\s\S]*rule\.ruleId[\s\S]*_loopdesk_promotion_compilation_version[\s\S]*rule\.compilation[\s\S]*version/, "promotion lines should match by both rule ID and compilation version");
assert.match(source, /productTitle = product && product\.title \|\| rule\.offer\.title/, "offer card should prefer the Shopify product title");
assert.match(source, /selectedVariantTitle = selected && selected\.title/, "offer card should render the selected variant title");
assert.match(source, /function variantPriceHtml\(variant, cart\)[\s\S]*compare_at_price[\s\S]*compareAt > price/, "offer card should render selected variant price and only valid compare-at pricing");
assert.match(source, /fetch\('\/cart\/add\.js'[\s\S]*_loopdesk_promotion_rule_id: rule\.ruleId[\s\S]*_loopdesk_promotion_compilation_version: String\(rule\.compilation\.version\)/, "Add Offer should POST the selected variant with exact Function marker properties");
assert.doesNotMatch(source, /Bag Exclusive|Special Offer|Complete your offer|Add Offer/, "offer copy must come from Promotion Admin fields only");
assert.match(source, /offerConfirmationHtml\(cart, rule\)[\s\S]*original_line_price[\s\S]*final_line_price/, "discount confirmation should use Shopify cart response prices");
assert.match(css, /\.loopdesk-cart-drawer__offer[\s\S]*\.loopdesk-cart-drawer__offer-savings/, "offer card and Shopify savings confirmation should be styled inside the existing drawer");

const refreshRuntime = source.match(new RegExp('function refreshPromotionRuntime\\(reason\\) \\{[\\s\\S]*?\n  \\}\n\n  function schedulePromotionRuntimeRefresh'));
assert.ok(refreshRuntime, "promotion runtime refresh helper should exist");
assert.match(refreshRuntime[0], /\/apps\/megaska\/api\/runtime\/config\?shop=/, "empty promotion recovery should fetch the app-proxy runtime config endpoint");
assert.match(refreshRuntime[0], /encodeURIComponent\(shopDomain\)[\s\S]*_loopdesk_runtime=" \+ Date\.now\(\)/, "runtime recovery should pass the shop domain and cache-busting timestamp");
assert.match(refreshRuntime[0], /credentials: "same-origin", cache: "no-store"/, "runtime recovery should use same-origin credentials and no-store cache");
assert.match(refreshRuntime[0], /freshConfig\.promotions && Array\.isArray\(freshConfig\.promotions\.rules\)[\s\S]*applyFreshRuntimePromotions\(freshConfig\.promotions\)/, "fresh runtime responses with promotion rules should replace the drawer promotion runtime");
assert.match(refreshRuntime[0], /catch\(function \(\) \{ return false; \}\)[\s\S]*finally\(function \(\) \{ state\.promotionRuntimeRefresh\.inFlight = false; \}\)/, "runtime recovery failures should fail closed without setting cart errors");

const applyFreshRuntime = source.match(new RegExp('function applyFreshRuntimePromotions\\(promotions\\) \\{[\\s\\S]*?\n  \\}'));
assert.ok(applyFreshRuntime, "fresh promotion runtime apply helper should exist");
assert.match(applyFreshRuntime[0], /config\.promotions = normalizedPromotions/, "closure-local drawer config should be updated with fresh promotions");
assert.match(applyFreshRuntime[0], /window\.LoopDeskConfig = Object\.assign\([\s\S]*promotions: normalizedPromotions/, "window.LoopDeskConfig should be updated with the same fresh promotions");
assert.match(applyFreshRuntime[0], /if \(state\.cart\) ensureOfferProducts\(eligiblePromotionRules\(state\.cart\)\);[\s\S]*render\(\);/, "fresh promotions should reevaluate the current cart, hydrate offers, and rerender");

assert.match(source, /promotionRuntimeRefresh: \{ attempts: 0, maxAttempts: 3,[\s\S]*cartNonEmptyAttempted: false \}/, "promotion runtime recovery should have a bounded retry state");
assert.match(source, /refreshPromotionRuntime\("init"\)\.then\(function \(applied\) \{ if \(!applied && !hasPromotionRules\(\)\) schedulePromotionRuntimeRefresh\("init-delayed", 750\); \}\);/, "drawer initialization should refresh empty promotions and schedule one delayed retry");
assert.match(source, /function maybeRefreshPromotionsForCart\(cart\) \{[\s\S]*cartNonEmptyAttempted[\s\S]*Number\(cart\.item_count \|\| 0\) <= 0[\s\S]*refreshPromotionRuntime\("cart-non-empty"\);[\s\S]*\}/, "cart becoming non-empty should trigger one additional empty-promotion recovery attempt");
assert.match(source, /then\(function \(cart\) \{ state\.cart = cart; maybeRefreshPromotionsForCart\(cart\); \}\)/, "normal cart fetch should remain operational and only opportunistically invoke promotion recovery");

assert.match(source, /function cartGoalProgressViewModel\(cart\)[\s\S]*intelligence\.enabled === true && progress\.enabled === true[\s\S]*Number\.isFinite\(threshold\) && threshold > 0/, "goal progress must require both flags and a valid positive merchant target");
assert.match(source, /remaining = Math\.max\(0, threshold - subtotal\)[\s\S]*unlocked = remaining === 0[\s\S]*progressPercent: unlocked \? 100 : Math\.min\(100, Math\.max\(0, Math\.round/, "goal progress must handle below, exact, and above-target subtotals and cap percentage");
assert.match(source, /visible: !\(unlocked && progress\.hideAfterUnlock === true\)/, "unlocked goal must hide only when configured");
assert.match(source, /unlocked \? String\(progress\.unlockedText[\s\S]*String\(progress\.progressText/, "goal progress must use merchant-authored locked and unlocked messages");
assert.match(source, /replace\(\/\\\{amount\\\}\/g, money\(viewModel\.remainingAmountMinor, viewModel\.currency\)\)/, "remaining amount must use the existing currency formatter");
assert.match(source, /role="progressbar"[\s\S]*aria-valuemin="0"[\s\S]*aria-valuemax="100"[\s\S]*aria-valuenow=/, "cart goal progress must expose accessible progressbar values");
assert.doesNotMatch(source, /deliveryProfiles|resolvedShopifyThresholdMinor|SHOPIFY_WITH_FALLBACK/, "cart goal progress must not read or infer Shopify shipping configuration");
assert.match(source, /document\.addEventListener\("loopdesk:runtime-config"[\s\S]*config\.cartIntelligence = normalizeCartIntelligence\(intelligence\);[\s\S]*render\(\)/, "late runtime configuration should normalize and rerender without controlling drawer asset loading");
assert.match(css, /\.loopdesk-cart-drawer__shipping-progress-track[\s\S]*\.loopdesk-cart-drawer__shipping-progress-track span/, "free-shipping progress should use drawer-scoped styles");
assert.match(source, /function renderTrustBadges\(placement\)[\s\S]*intelligence\.enabled !== true[\s\S]*badges\.enabled !== true[\s\S]*item\.enabled && item\.label/, "trust badges should require both master switches and render only enabled labeled items");
assert.match(source, /function normalizeCartIntelligence\(value\)[\s\S]*items\.length > 6[\s\S]*icons\.indexOf\(item\.icon\)[\s\S]*slice\(0, 60\)/, "malformed icons and badge counts should fail closed while labels are length limited");
assert.match(source, /aria-label="Store assurances"/, "trust badges should expose an accessible group label");
assert.match(source, /viewBox="0 0 24 24" aria-hidden="true" focusable="false"/, "trust badge icons should be decorative and hidden from assistive technology");
assert.match(css, /\.loopdesk-cart-drawer__trust-badges--grid[\s\S]*grid-template-columns:[^;]*repeat\(2/, "trust badges should have a responsive compact grid");

// CART-NAV-1: with "Cart type: Page" set (required for LoopDesk drawer
// ownership), some themes redirect to /cart via location.assign/replace
// after a successful AJAX add-to-cart (their own native "Page" cart-type
// fallback behavior) even though our fetch/XHR patch already opened the
// drawer for the same add. That native navigation must be redirected into
// keeping the drawer open instead of leaving the page, the same way
// location.assign/replace to /checkout is already redirected into Express
// Checkout.
const patchLocationNavigation = source.match(/function patchLocationNavigation\(\) \{[\s\S]*?\n  \}/);
assert.ok(patchLocationNavigation, "location navigation patch should exist");
assert.match(patchLocationNavigation[0], /if \(url && url\.pathname === '\/checkout'\)[\s\S]*openLoopDeskExpressCheckout\('navigation-' \+ method\);/, "checkout navigation interception must remain in place");
assert.match(patchLocationNavigation[0], /if \(url && hasCartPath\(url\.pathname\) && isLoopDeskDrawerActive\(\)\)[\s\S]*refreshAndMaybeOpen\(true\);/, "cart page navigation should be redirected into keeping the drawer open when LoopDesk owns the drawer");

// CART-NAV-2: some themes navigate to /cart via a direct `location.href =`
// / `window.location =` property assignment rather than .assign()/.replace()
// after a successful AJAX add — a mechanism no script can intercept, by
// browser design. Since we can't prevent that navigation, we detect landing
// on /cart right after such an add and bounce back to where the shopper
// was, reopening the drawer there, instead of leaving them stranded on the
// native cart page.
assert.match(source, /function recordCartAddReturnIntent\(\) \{[\s\S]*?if \(!shouldOpenLoopDeskAfterCartAdd\(\)\) return;/, "a return intent should only be recorded when LoopDesk would actually own the resulting drawer");
assert.match(source, /function bounceBackFromUnwantedCartPageNavigation\(\) \{[\s\S]*?if \(!hasCartPath\(window\.location\.pathname\)\) return false;/, "the bounce-back should only engage when we actually landed on the cart page");
assert.match(source, /var parsedReturn = getSameOriginUrl\(returnUrl\);[\s\S]*?if \(!parsedReturn \|\| hasCartPath\(parsedReturn\.pathname\)\) return false;/, "a stored return URL that is itself /cart must not trigger a pointless bounce");
assert.match(source, /Date\.now\(\) - parsed\.ts > CART_ADD_RETURN_MAX_AGE_MS\) return "";/, "a stale return intent (e.g. from an abandoned flow) must not be honored");
assert.match(source, /function listenForCartAddFormSubmissions\(\) \{[\s\S]*?if \(!isCartAddUrl\(form\.getAttribute\("action"\) \|\| ""\)\) return;[\s\S]*?recordCartAddReturnIntent\(\);/, "the return intent should be recorded without ever preventing the form's own native submission or side effects");
assert.match(source, /if \(bounceBackFromUnwantedCartPageNavigation\(\)\) return;\n  if \(document\.readyState === "loading"\)/, "the bounce-back must be checked before the drawer bootstraps on a fresh page load");
assert.match(source, /refreshAndMaybeOpen\(consumeCartAddReopenIntent\(\)\);/, "landing back after a bounce-back should reopen the drawer once mounted");

console.log("LoopDesk cart drawer CONFIG-2B regression checks passed");
