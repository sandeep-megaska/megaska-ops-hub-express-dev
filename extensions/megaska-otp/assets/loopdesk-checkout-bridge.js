(function () {
  var MARKER = "__LOOPDESK_CHECKOUT_BRIDGE_LOADED__";
  var API_NAME = "LoopDeskCheckoutBridge";
  var checkoutSelector = [
    'a[href="/checkout"]', 'a[href^="/checkout?"]', 'a[href*="/checkout"]',
    'button[name="checkout"]', 'input[name="checkout"]', '[data-checkout-button]',
    '.cart__checkout-button', '.cart__checkout', '.checkout-button', '.btn-checkout',
    '.mini-cart__checkout', '[data-checkout]', '[data-testid*="checkout" i]',
    '[aria-label*="checkout" i]'
  ].join(',');
  var excludedSelector = 'form[action*="/cart/add"], [name="add"], [data-quantity], [name="updates[]"], [class*="discount" i], [class*="coupon" i]';
  var state = { clicks: 0, submits: 0, opened: 0, duplicates: 0, nativeFallbacks: 0, lastReason: "loaded" };
  var lock = false;
  var lastSubmitter = null;

  if (window[MARKER] && window[API_NAME]) return;
  window[MARKER] = true;

  function debug(message, details) {
    if (!window.LoopDeskConfig?.debug && !window.__LOOPDESK_DEBUG__) return;
    window.console?.debug?.("[LoopDesk Checkout] " + message, details || {});
  }
  function closest(value, selector) { try { return value?.closest?.(selector) || null; } catch { return null; } }
  function sameOriginPath(value, path) { try { var url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname === path; } catch { return false; } }
  function findControl(target) {
    var control = closest(target, checkoutSelector);
    if (control) return control;
    control = closest(target, 'a,button,input,[role="button"]');
    return control && /^(checkout|check out|proceed to checkout|continue to checkout|secure checkout)$/i.test(String(control.textContent || control.value || '').trim()) ? control : null;
  }
  function excluded(control) { return Boolean(closest(control, excludedSelector)); }
  function enabled() {
    return window.LoopDeskConfig?.expressCheckoutEnabled !== false && window.LoopDeskConfig?.enabled !== false;
  }
  function sourceFor(trigger) {
    if (closest(trigger, '#loopdesk-cart-drawer-root, [data-loopdesk-cart-drawer]')) return 'loopdesk-cart-drawer';
    if (closest(trigger, 'cart-drawer, #CartDrawer, #cart-drawer, .cart-drawer, [data-cart-drawer]')) return 'theme-cart-drawer';
    if (window.location.pathname === '/cart') return 'cart-page';
    return 'unknown-checkout-trigger';
  }
  function describe(trigger) {
    if (!trigger) return 'unknown';
    return [String(trigger.tagName || '').toLowerCase(), trigger.id ? '#' + trigger.id : '', trigger.getAttribute?.('name') ? '[name="' + trigger.getAttribute('name') + '"]' : '', trigger.className ? '.' + String(trigger.className).trim().replace(/\s+/g, '.') : ''].join('');
  }
  function hardBlock(event) {
    event?.preventDefault?.(); event?.stopPropagation?.(); event?.stopImmediatePropagation?.();
  }
  function closeGenericOtp() {
    if (window.MegaskaOtp?.isModalOpen?.()) window.MegaskaOtp.closeModal('express-checkout-takeover', { force: true });
  }
  function launchExpress(options) {
    closeGenericOtp();
    state.opened += 1;
    state.lastReason = options.source;
    debug('delegated to Express Checkout', { source: options.source, authenticated: true });
    window.MegaskaExpressCheckout.open({ source: options.source, triggerEl: options.trigger });
  }
  function request(options) {
    options = options || {};
    var event = options.event;
    var trigger = options.trigger || findControl(event?.target);
    var source = options.source || sourceFor(trigger);
    if (!enabled()) {
      state.nativeFallbacks += 1; state.lastReason = 'native-fallback';
      debug('native fallback allowed', { source: source, trigger: describe(trigger) });
      return false;
    }
    hardBlock(event);
    debug('checkout trigger detected', { source: source, trigger: describe(trigger), interaction: options.interaction || 'api' });
    if (lock) { state.duplicates += 1; debug('duplicate checkout event suppressed', { source: source }); return true; }
    lock = true; window.setTimeout(function () { lock = false; }, 900);
    if (!window.MegaskaExpressCheckout?.open) {
      // Asset latency is not permission to navigate or invoke legacy OTP.
      lock = false; state.lastReason = 'express-controller-pending';
      window.setTimeout(function () { request(Object.assign({}, options, { event: null, source: source })); }, 50);
      return true;
    }
    var auth = window.MegaskaAuth?.fetchSession ? window.MegaskaAuth.fetchSession() : Promise.resolve({ authenticated: Boolean(localStorage.getItem('megaska_session_token')) });
    Promise.resolve(auth).then(function (session) {
      debug('authenticated session status', { source: source, authenticated: Boolean(session?.authenticated) });
      if (session?.authenticated) { launchExpress({ source: source, trigger: trigger }); return; }
      if (window.MegaskaOtp?.ensureMegaskaAuthenticatedBeforeCheckout) {
        debug('OTP continuation stored', { source: source });
        window.MegaskaOtp.ensureMegaskaAuthenticatedBeforeCheckout({
          triggerEl: trigger,
          pendingAction: { type: 'callback', callback: function () { debug('OTP continuation resumed', { source: source }); launchExpress({ source: source, trigger: trigger }); } }
        });
      }
    });
    return true;
  }

  document.addEventListener('click', function (event) {
    var control = findControl(event.target);
    if (!control || excluded(control)) return;
    lastSubmitter = /^(BUTTON|INPUT)$/.test(control.tagName) ? control : null;
    state.clicks += 1;
    request({ event: event, trigger: control, interaction: 'click' });
  }, true);
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    var submitter = event.submitter || (lastSubmitter && form.contains(lastSubmitter) ? lastSubmitter : null);
    var control = findControl(submitter);
    var direct = sameOriginPath(form.getAttribute('action') || '', '/checkout');
    if (!direct && !control) return;
    if (control && excluded(control)) return;
    state.submits += 1;
    request({ event: event, trigger: control || submitter, form: form, interaction: 'submit' });
  }, true);

  window[API_NAME] = {
    request: request,
    open: function (options) { return request(Object.assign({}, options || {}, { interaction: 'api' })); },
    status: function () { return Object.assign({ loaded: true, enabled: enabled(), modalApiPresent: Boolean(window.MegaskaExpressCheckout?.open) }, state); }
  };
})();
