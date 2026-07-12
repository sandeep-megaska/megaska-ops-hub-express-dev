import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-cart-drawer.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extensions/megaska-otp/assets/loopdesk-cart-drawer.css", import.meta.url), "utf8");

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

const controllerOpen = source.match(/window\.LoopDeskCartController = \{[\s\S]*?open: function \(\) \{[\s\S]*?\n    \},/);
assert.ok(controllerOpen, "manual controller open helper should exist");
assert.match(controllerOpen[0], /return refreshAndMaybeOpen\(true\);/, "manual open helper should open the drawer for debugging");
assert.doesNotMatch(controllerOpen[0], /isLoopDeskDrawerActive\(\)/, "manual open helper should not be gated by cartOwnershipMode");

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

console.log("LoopDesk cart drawer CONFIG-2B regression checks passed");
