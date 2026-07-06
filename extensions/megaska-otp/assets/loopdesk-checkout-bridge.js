(function () {
  var SOURCE = "loopdesk-checkout-bridge";
  var FALLBACK_URL = "/apps/megaska/checkout";
  var MARKER = "__LOOPDESK_CHECKOUT_BRIDGE_LOADED__";
  var API_NAME = "LoopDeskCheckoutBridge";

  if (window[MARKER] && window[API_NAME]) return;
  window[MARKER] = true;

  var state = { clicks: 0, submits: 0, fallbacks: 0, opened: 0, lastReason: "loaded" };
  var checkoutSelector = [
    'a[href="/checkout"]',
    'a[href^="/checkout"]',
    'a[href*="/checkout"]',
    'button[name="checkout"]',
    'input[name="checkout"]',
    'button[type="submit"][name="checkout"]',
    'input[type="submit"][name="checkout"]',
    '.cart__checkout-button',
    '.checkout-button',
    '[data-checkout]',
    '[data-testid*="checkout" i]',
    '[aria-label*="checkout" i]',
    '[class*="checkout" i]',
    '[id*="checkout" i]'
  ].join(',');
  var excludedSelector = [
    'form[action*="/cart/add"] button',
    'form[action*="/cart/add"] input',
    '[name="add"]',
    '[type="submit"][formaction*="/cart/add"]',
    '[name="plus"]',
    '[name="minus"]',
    '[name="updates[]"]',
    '[data-quantity]',
    '[data-quantity-selector]',
    '[href*="change"]',
    '[name*="remove" i]',
    '[class*="remove" i]',
    '[id*="remove" i]',
    '[class*="discount" i]',
    '[id*="discount" i]',
    '[name*="discount" i]',
    '[aria-label*="discount" i]',
    '[data-discount]',
    '[class*="coupon" i]',
    '[id*="coupon" i]',
    '[name*="coupon" i]',
    '[type="search"]',
    '[role="search"] button'
  ].join(',');
  var lastSubmitter = null;
  var lock = false;

  function matches(element, selector) {
    try { return Boolean(element && element.matches && element.matches(selector)); } catch (_error) { return false; }
  }

  function closest(element, selector) {
    try { return element && element.closest ? element.closest(selector) : null; } catch (_error) { return null; }
  }

  function text(element) {
    return String(element && (element.innerText || element.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function sameOriginPath(value, pathPrefix) {
    if (!value) return false;
    try {
      var url = new URL(value, window.location.origin);
      return url.origin === window.location.origin && url.pathname.indexOf(pathPrefix) === 0;
    } catch (_error) {
      return String(value).indexOf(pathPrefix) === 0;
    }
  }

  function isExcluded(control) {
    return Boolean(closest(control, excludedSelector)) || /\b(add to cart|add-to-cart|quantity|qty|increase|decrease|remove|discount|coupon|promo|search|menu)\b/i.test(text(control));
  }

  function findCheckoutControl(target) {
    var control = closest(target, checkoutSelector);
    if (control) return control;
    control = closest(target, 'a, button, input[type="button"], input[type="submit"], [role="button"]');
    if (!control) return null;
    return /^(checkout|check out|proceed to checkout|continue to checkout|secure checkout)$/.test(text(control)) ? control : null;
  }

  function isCheckoutForm(form) {
    if (!form || form.nodeName !== 'FORM') return false;
    var action = form.getAttribute('action') || '';
    return sameOriginPath(action, '/checkout') || sameOriginPath(action, '/cart');
  }

  function open(reason) {
    if (lock) return;
    lock = true;
    state.opened += 1;
    state.lastReason = reason || SOURCE;
    window.setTimeout(function () { lock = false; }, 900);
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === 'function') {
      window.MegaskaExpressCheckout.open({ source: SOURCE });
      return;
    }
    state.fallbacks += 1;
    window.location.href = FALLBACK_URL;
  }

  function stopAndOpen(event, reason) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    open(reason);
  }

  document.addEventListener('click', function (event) {
    var control = findCheckoutControl(event.target);
    if (!control || isExcluded(control)) return;
    lastSubmitter = matches(control, 'button, input') ? control : null;
    state.clicks += 1;
    stopAndOpen(event, 'click');
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!isCheckoutForm(form)) return;
    var submitter = event.submitter || (lastSubmitter && form.contains(lastSubmitter) ? lastSubmitter : null);
    var directCheckout = sameOriginPath(form.getAttribute('action') || '', '/checkout') || (submitter && sameOriginPath(submitter.getAttribute && submitter.getAttribute('formaction') || '', '/checkout'));
    var checkoutSubmitter = submitter && findCheckoutControl(submitter) && !isExcluded(submitter);
    if (!directCheckout && !checkoutSubmitter) return;
    state.submits += 1;
    stopAndOpen(event, 'submit');
  }, true);

  window[API_NAME] = {
    open: function () { open('api'); },
    fallbackUrl: FALLBACK_URL,
    status: function () {
      return {
        loaded: window[MARKER] === true,
        modalApiPresent: Boolean(window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === 'function'),
        clicks: state.clicks,
        submits: state.submits,
        opened: state.opened,
        fallbacks: state.fallbacks,
        lastReason: state.lastReason
      };
    }
  };
})();
