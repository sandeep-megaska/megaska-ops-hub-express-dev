import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('extensions/megaska-otp/assets/loopdesk-checkout-bridge.js', 'utf8');
const otp = readFileSync('extensions/megaska-otp/assets/megaska-otp.js', 'utf8');
const contains = (source, value) => assert.ok(source.includes(value), `missing ${value}`);

test('generic OTP delegates checkout instead of opening its own checkout gate', () => {
  const handler = otp.slice(otp.indexOf('async function handleCheckoutTriggerClick'), otp.indexOf('function bindGlobalClickInterceptor'));
  contains(handler, 'LoopDeskCheckoutBridge?.request');
  assert.ok(!handler.includes('openModal('));
  assert.ok(!handler.includes('location.assign'));
  contains(otp, 'handleAccountTriggerClick');
  contains(otp, 'openModal("account-intercept")');
});

test('canonical bridge covers delegated dynamic clicks and cart form submits', () => {
  contains(bridge, "document.addEventListener('click'");
  contains(bridge, "document.addEventListener('submit'");
  contains(bridge, 'event.submitter ||');
  contains(bridge, "'button[name=\"checkout\"]'");
  contains(bridge, "'input[name=\"checkout\"]'");
  contains(bridge, "'a[href=\"/checkout\"]'");
  contains(bridge, "interaction: 'submit'");
});

test('owned events are synchronously blocked and repeated sequences deduplicate', () => {
  contains(bridge, 'event?.preventDefault?.()');
  contains(bridge, 'event?.stopPropagation?.()');
  contains(bridge, 'event?.stopImmediatePropagation?.()');
  contains(bridge, 'if (lock)');
  contains(bridge, "debug('duplicate checkout event suppressed'");
});

test('authentication continuation resumes the same Express Checkout request', () => {
  contains(bridge, "pendingAction: { type: 'callback'");
  contains(bridge, "debug('OTP continuation stored'");
  contains(bridge, "debug('OTP continuation resumed'");
  contains(bridge, 'window.MegaskaExpressCheckout.open');
});

test('modal ownership is exclusive and native fallback is configuration-only', () => {
  contains(bridge, "closeModal('express-checkout-takeover'");
  contains(bridge, 'expressCheckoutEnabled !== false');
  contains(bridge, "state.lastReason = 'native-fallback'");
  assert.ok(!/window\.location\.(?:href|assign|replace)/.test(bridge));
  assert.ok(!bridge.includes('MegaskaOtp.openModal'));
});
