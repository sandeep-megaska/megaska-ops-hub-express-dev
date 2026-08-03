import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const asset = (name) => readFileSync(new URL(`../megaska-otp/assets/${name}`, import.meta.url), "utf8");
const block = (name) => readFileSync(new URL(`../megaska-otp/blocks/${name}`, import.meta.url), "utf8");

test("funnel analytics module beacons to the app-proxy track endpoint", () => {
  const src = asset("loopd2c-analytics.js");
  assert.match(src, /var ENDPOINT = "\/apps\/loopd2c\/api\/track"/);
  assert.match(src, /navigator\.sendBeacon/);
  assert.match(src, /keepalive: true/);
  // The six funnel events are the allowlist.
  for (const evt of ["CART_ADD", "DRAWER_OPEN", "EXPRESS_CLICK", "OTP_OPEN", "OTP_SUCCESS", "MODAL_OPEN"]) {
    assert.match(src, new RegExp(`${evt}: 1`), `analytics allowlist should include ${evt}`);
  }
  // Never sends identity; server resolves the customer from the session cookie.
  assert.doesNotMatch(src, /phoneE164|sessionToken|localStorage\.getItem\("megaska_session_token"\)/);
  // Flushes on the way out so late/abandonment signals survive.
  assert.match(src, /addEventListener\("pagehide"/);
  assert.match(src, /visibilitychange/);
  // OTP_SUCCESS only counts a genuine login this session (a modal was opened).
  assert.match(src, /otpOpenedThisSession/);
  assert.match(src, /otpSuccessTracked/);
  // Drains the load-order queue stub.
  assert.match(src, /window\.LoopDeskAnalytics\.q/);
});

test("embed installs the queue stub and loads the analytics asset early", () => {
  const embed = block("megaska-otp-embed.liquid");
  assert.match(embed, /window\.LoopDeskAnalytics = window\.LoopDeskAnalytics \|\| \{ q: \[\], track: function/);
  assert.match(embed, /'loopd2c-analytics\.js' \| asset_url/);
});

test("storefront assets emit the six funnel events at their trigger points", () => {
  // CART_ADD after a successful /cart/add.js.
  assert.match(asset("loopdesk-buy-now-bridge.js"), /LoopDeskAnalytics\.track\("CART_ADD", \{ source: "PRODUCT" \}\)/);

  // DRAWER_OPEN on the closed->open transition of the drawer.
  const drawer = asset("loopdesk-cart-drawer.js");
  assert.match(drawer, /if \(open && !state\.open\) \{[^}]*track\("DRAWER_OPEN"\)/);

  // EXPRESS_CLICK carries the entry point (drawer vs cart page).
  const bridge = asset("loopdesk-checkout-bridge.js");
  assert.match(bridge, /track\('EXPRESS_CLICK', \{ source: source === 'loopdesk-cart-drawer' \? 'DRAWER' : 'CART_PAGE' \}\)/);

  // OTP_OPEN only on a genuine open (guarded by !state.isOpen).
  assert.match(asset("loopd2c-otp.js"), /if \(!state\.isOpen && window\.LoopDeskAnalytics\) window\.LoopDeskAnalytics\.track\('OTP_OPEN'/);
  // (MODAL_OPEN removed — the express modal has been retired.)
});
