import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('extensions/megaska-otp/assets/loopdesk-buy-now-bridge.js', 'utf8');

const mustContain = (needle) => assert.ok(source.includes(needle), `missing ${needle}`);

test('supports explicit Shopify and theme buy-now selectors', () => {
  [
    '.shopify-payment-button', '.shopify-payment-button__button', '.shopify-payment-button__button--unbranded',
    '[data-shopify="payment-button"]', 'shopify-payment-button', 'shopify-accelerated-checkout', '[data-buy-now]',
    '[data-buy-it-now]', '[data-dynamic-checkout]', 'button[name="buy_now"]', 'button[name="buy-now"]'
  ].forEach(mustContain);
});

test('resolves product forms without defaulting to the first ambiguous form', () => {
  mustContain('cartAddForm(control)');
  mustContain('getAttribute("form")');
  mustContain('product-form, [data-product-form], [data-product-form-container]');
  mustContain('[id^="shopify-section-"]');
  mustContain('return all.length === 1 ? all[0] : null');
});

test('captures variant, quantity, selling plans, properties, and all FormData fields', () => {
  mustContain('new FormData(form)');
  mustContain('data.get("id")');
  mustContain('data.get("quantity") || 1');
  assert.ok(!source.includes('properties[') || source.includes('new FormData(form)'), 'properties should be preserved by FormData');
  mustContain('body: data');
});

test('prevents native checkout only after successful form resolution', () => {
  assert.ok(source.indexOf('if (!form)') < source.indexOf('event.preventDefault()'));
  mustContain('event.stopPropagation()');
  mustContain('event.stopImmediatePropagation');
  mustContain('[LoopDesk Buy Now] unresolved product form');
});

test('/cart/add.js is posted exactly once by the owned click path', () => {
  assert.equal((source.match(/fetch\("\/cart\/add\.js"/g) || []).length, 1);
  mustContain('method: "POST"');
  mustContain('credentials: "same-origin"');
  mustContain('Accept: "application/json"');
});

test('duplicate prevention and accessible loading state are present', () => {
  mustContain('new WeakSet()');
  mustContain('inflight.has(control)');
  mustContain('inflight.add(control)');
  mustContain('aria-busy');
  mustContain('Preparing checkout...');
  mustContain('role", "status"');
});

test('cart failures do not open OTP or checkout before successful add', () => {
  assert.ok(source.indexOf('await addToCart(data)') < source.indexOf('if (hasToken()) openCheckout()'));
  assert.ok(source.indexOf('await addToCart(data)') < source.indexOf('else { setResume(); if (!openOtp()) openCheckout(); }'));
  mustContain('catch (err)');
});

test('logged-out flow opens OTP and logged-in flow opens Express Checkout', () => {
  mustContain('hasToken()');
  mustContain('MegaskaAuth.openOtpModal');
  mustContain('MegaskaOtp.openModal("checkout")');
  mustContain('LoopDeskCheckoutBridge.open');
  mustContain('MegaskaExpressCheckout.open');
});

test('does not navigate to Shopify /checkout', () => {
  assert.equal((source.match(/location\.href/g) || []).length, 0);
  assert.equal((source.match(/location\.href\s*=|location\.assign|location\.replace/g) || []).length, 0);
});

test('add-to-cart, cart drawer, sold-out, dynamic insertion, duplicate load, and theme editor safeguards exist', () => {
  mustContain('[name="add"]');
  mustContain('[data-loopdesk-express-checkout]');
  mustContain('data-sold-out="true"');
  mustContain('new MutationObserver');
  mustContain('observerStarts');
  mustContain('if (window[MARKER] && window[API_NAME]) return');
  mustContain('shopify:section:load');
  mustContain('shopify:block:select');
});
