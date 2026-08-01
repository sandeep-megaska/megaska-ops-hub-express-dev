/**
 * LoopD2C storefront funnel analytics.
 *
 * Captures the pre-intent express-checkout funnel steps that are otherwise only
 * client-side (add-to-cart, drawer open, express-checkout click, OTP open/
 * success, modal open) and beacons them to /apps/loopd2c/api/track. The app
 * proxy adds the shop + verifies the request; the server resolves the logged-in
 * customer from the httpOnly session cookie, so this script never sends identity.
 *
 * Load order is handled by a queue stub inlined in the embed:
 *   window.LoopDeskAnalytics = { q: [], track: fn-that-queues }
 * This module replaces track() with the real implementation and drains the queue,
 * so track() calls made before this asset loads are never lost.
 */
(function () {
  "use strict";

  var ENDPOINT = "/apps/loopd2c/api/track";
  var SESSION_KEY = "loopdesk_funnel_sid";
  var FLUSH_DEBOUNCE_MS = 1200;
  var MAX_BUFFER = 20;

  var VALID_EVENTS = {
    CART_ADD: 1,
    DRAWER_OPEN: 1,
    EXPRESS_CLICK: 1,
    OTP_OPEN: 1,
    OTP_SUCCESS: 1,
    MODAL_OPEN: 1,
  };
  var VALID_SOURCES = { DRAWER: 1, CART_PAGE: 1, PRODUCT: 1, UNKNOWN: 1 };

  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_e) {}
    return "f-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function funnelSessionId() {
    try {
      var existing = window.sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var id = uuid();
      window.sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (_e) {
      // Private mode / storage disabled: fall back to a per-page id.
      if (!window.__loopdeskFsid) window.__loopdeskFsid = uuid();
      return window.__loopdeskFsid;
    }
  }

  function device() {
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 767px)").matches) return "MOBILE";
      if (/Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent)) return "MOBILE";
      return "DESKTOP";
    } catch (_e) {
      return "UNKNOWN";
    }
  }

  var buffer = [];
  var flushTimer = null;

  function normalizeEvent(type, opts) {
    if (!type || !VALID_EVENTS[type]) return null;
    opts = opts || {};
    var source = typeof opts.source === "string" ? opts.source.toUpperCase() : null;
    if (source && !VALID_SOURCES[source]) source = null;
    var evt = {
      t: type,
      sid: funnelSessionId(),
      dev: device(),
      ts: Date.now(),
    };
    if (source) evt.src = source;
    if (typeof opts.cartToken === "string" && opts.cartToken) evt.cart = opts.cartToken.slice(0, 256);
    if (typeof opts.cartValuePaise === "number" && isFinite(opts.cartValuePaise)) {
      evt.val = Math.max(0, Math.round(opts.cartValuePaise));
    }
    if (opts.metadata && typeof opts.metadata === "object") evt.meta = opts.metadata;
    return evt;
  }

  function serialize() {
    var events = buffer.slice(0, MAX_BUFFER);
    buffer = buffer.slice(MAX_BUFFER);
    return JSON.stringify({ events: events });
  }

  function flush(useBeacon) {
    if (!buffer.length) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    var payload = serialize();
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch (_e) {}
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        credentials: "same-origin",
        keepalive: true,
      }).catch(function () {});
    } catch (_e) {}
  }

  function scheduleFlush() {
    if (buffer.length >= MAX_BUFFER) {
      flush(false);
      return;
    }
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush(false);
    }, FLUSH_DEBOUNCE_MS);
  }

  // Only attribute OTP_SUCCESS to a genuine login this session (a modal was
  // opened), not to a session silently restored on page load.
  var otpOpenedThisSession = false;
  var otpSuccessTracked = false;

  function track(type, opts) {
    var evt = normalizeEvent(type, opts);
    if (!evt) return;
    if (type === "OTP_OPEN") otpOpenedThisSession = true;
    if (type === "OTP_SUCCESS") {
      if (!otpOpenedThisSession || otpSuccessTracked) return;
      otpSuccessTracked = true;
    }
    buffer.push(evt);
    scheduleFlush();
  }

  // Flush on the way out so late-funnel events (and abandonment signals) survive.
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush(true);
  });

  // OTP_SUCCESS is inferred from the auth-state-changed signal, but track()
  // filters it to genuine logins (an OTP_OPEN happened this session).
  document.addEventListener("megaska:auth-state-changed", function (e) {
    var authed = e && e.detail && e.detail.authenticated;
    if (authed) track("OTP_SUCCESS");
  });

  // A decoupled dispatch channel so other assets can emit without depending on
  // load order: document.dispatchEvent(new CustomEvent('loopdesk:funnel', {detail:{type, ...opts}})).
  document.addEventListener("loopdesk:funnel", function (e) {
    var d = (e && e.detail) || {};
    if (d.type) track(d.type, d);
  });

  // Install the real implementation and drain anything the queue stub captured
  // before this module loaded.
  var pending = (window.LoopDeskAnalytics && window.LoopDeskAnalytics.q) || [];
  window.LoopDeskAnalytics = { track: track, q: [] };
  try {
    for (var i = 0; i < pending.length; i++) {
      track.apply(null, pending[i]);
    }
  } catch (_e) {}
})();
