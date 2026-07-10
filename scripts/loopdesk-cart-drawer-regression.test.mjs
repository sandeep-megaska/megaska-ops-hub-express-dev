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
