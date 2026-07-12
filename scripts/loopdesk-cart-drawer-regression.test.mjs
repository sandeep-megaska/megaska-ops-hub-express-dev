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

console.log("LoopDesk cart drawer CONFIG-2B regression checks passed");

assert.match(source, /selectedOfferVariants: \{\}/, "selected offer variants should be tracked in drawer state");
assert.match(source, /elements\.body\.addEventListener\("change", function \(event\) \{[\s\S]*?closest\("\[data-loopdesk-offer-variant\]"\)[\s\S]*?state\.selectedOfferVariants\[ruleId\] = select\.value;[\s\S]*?render\(\);[\s\S]*?\}\);/, "offer variant selection must use a change-event listener and store state by rule ID");
assert.match(source, /function selectedOfferVariant\(rule, product\) \{[\s\S]*?state\.selectedOfferVariants\[rule\.ruleId\][\s\S]*?variant\.available !== false[\s\S]*?\}/, "Add Offer should resolve the currently selected available Shopify variant");
assert.match(source, /fetch\("\/cart\/add\.js"[\s\S]*?_loopdesk_promotion_rule_id: String\(rule\.ruleId\)[\s\S]*?_loopdesk_promotion_compilation_version: ruleCompilationVersion\(rule\)/, "Add Offer must preserve the cart\/add.js flow and exact marker keys");
assert.match(source, /function promotionRuleIdFromLine\(item\) \{[\s\S]*?_loopdesk_promotion_rule_id/, "promotion rule marker helper should read the exact rule ID property");
assert.match(source, /function promotionCompilationVersionFromLine\(item\) \{[\s\S]*?_loopdesk_promotion_compilation_version/, "promotion compilation marker helper should read the exact compilation version property");
assert.match(source, /function triggerQuantityInCart\(rule, cart\) \{[\s\S]*?if \(isLoopDeskPromotionalLine\(item\)\) return sum;/, "trigger eligibility calculations must exclude marked promotional lines");
assert.match(source, /function rewardQuantityInCart\(rule, cart\) \{[\s\S]*?promotionLineMatchesRule\(item, rule\)/, "reward quantity should only count marked lines that match the active rule identity");
assert.match(source, /function promotionLineMatchesRule\(item, rule\) \{[\s\S]*?promotionRuleIdFromLine\(item\) === String\(rule\.ruleId\) && promotionCompilationVersionFromLine\(item\) === ruleCompilationVersion\(rule\);/, "promotion lines must match both rule ID and compilation version");
assert.match(source, /function offerConfirmationHtml\(rule, cart\) \{[\s\S]*?rewardQuantityInCart\(rule, cart\)/, "offer confirmation must use the version-aware reward quantity helper");
assert.match(source, /fetch\("\/products\/" \+ encodeURIComponent\(handle\) \+ "\.js"/, "offer product presentation should hydrate from Shopify product JSON");
assert.match(source, /loopdesk-cart-drawer__offer-product-title">' \+ escapeHtml\(product\.title\)/, "offer cards should display the Shopify product title");
assert.match(source, /variant\.title && variant\.title !== "Default Title"/, "offer cards should display selected variant title except Default Title");
assert.match(source, /var current = Number\(variant\.price \|\| 0\);[\s\S]*?var compareAt = Number\(variant\.compare_at_price \|\| 0\);[\s\S]*?compareAt > current/, "offer pricing should use selected Shopify variant price and only show compare-at when higher");
assert.doesNotMatch(source, /offerProductTitle|offerProductImageUrl|Add eligible items|Recommended add-on/, "drawer offer presentation must not fall back to admin snapshots or canned promo copy");
