import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const css = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.css", "utf8");

assert.match(js, /Sign in to view your account/);
assert.match(js, /Verify your mobile number to see your orders and account details\./);
assert.match(js, /We could not load your account right now\./);
assert.match(js, /You have not placed any orders yet\./);
assert.match(js, /Continue Shopping/);
assert.match(js, /moneyPaise\(data\.wallet\?\.availableToRedeem \?\? data\.wallet\?\.balance \?\? 0\)/);
assert.match(js, /moneyMajor\(o\.total \|\| o\.totalPrice \|\| o\.currentTotalPrice\)/);
assert.match(js, /new URL\(u, fallback \|\| window\.location\.origin\)/);
assert.match(js, /\["http:", "https:"\]\.includes\(x\.protocol\)/);
assert.match(js, /state\.requestSequence\+\+/);
assert.match(js, /if \(state\.request\) return state\.request/);
assert.match(js, /err\.auth = true/);
assert.match(js, /renderAuthRequired\(false\)/);
assert.match(js, /window\.MegaskaAuth/);
assert.match(js, /typeof a\.logout === "function"/);
assert.match(js, /document\.dispatchEvent\(new CustomEvent\("megaska:auth-state-changed"/);
assert.match(js, /uniqueReasons/);
assert.match(js, /Available — wiring will be tested in the next module phase/);
assert.doesNotMatch(js, /fetch\([^)]*requests\/(cancellation|exchange|issue)/s);
assert.doesNotMatch(js, /console\.(log|debug|info)\(/);

assert.doesNotMatch(css, /\n\.(?!ld-account-scroll-lock)|\n[a-z]+\s*\{/i);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /width: min\(520px, 100vw\)/);
assert.match(css, /width: 100vw/);
console.log("loopdesk-customer-dashboard dom/static tests passed");
