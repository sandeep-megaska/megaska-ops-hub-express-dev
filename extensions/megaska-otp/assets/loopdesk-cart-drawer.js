(function () {
  var DEFAULT_CONFIG = {
    branding: {
      merchantName: "LoopD2C",
      storeName: "LoopD2C",
      logoUrl: null,
      primaryColor: "#111827",
      secondaryColor: "#374151",
      accentColor: "#2563eb",
      textColor: "#111827",
      surfaceColor: "#ffffff",
      borderRadius: "16px",
      fontFamily: "inherit",
      showPoweredBy: true,
      poweredByText: "Powered by LoopD2C"
    },
    labels: {
      expressCheckoutText: "Express Checkout",
      viewCartText: "View Cart",
      continueShoppingText: "Continue Shopping",
      loadingText: "Loading...",
      secureCheckoutText: "Secure checkout",
      otpContinueText: "Continue"
    },
    cart: {
      drawerMode: "auto",
      openAfterAddToCart: false,
      expressCheckoutButtonEnabled: true,
      viewCartButtonEnabled: true,
      nativeDrawerDisabledRequiredMessage: "To use LoopD2C Enhanced Drawer, set your theme cart type to Page in Shopify theme settings.",
      customTriggerSelector: ""
    },
    checkout: {
      showSecureBadge: true,
      showTrustCopy: true
    },
    enabled: true,
    cartOwnershipMode: "fallback"
  };
  var config = normalizeConfig(window.LoopDeskConfig || window.LOOPDESK_CART_DRAWER_CONFIG || window.LoopDeskCartDrawerConfig || {});
  window.LoopDeskConfig = Object.assign({}, window.LoopDeskConfig || {}, config);
  window.LOOPDESK_CART_DRAWER_CONFIG = Object.assign({}, window.LOOPDESK_CART_DRAWER_CONFIG || {}, {
    enabled: config.enabled,
    drawerMode: config.cart.drawerMode,
    openAfterAddToCart: config.cart.openAfterAddToCart,
    expressCheckoutButtonEnabled: config.cart.expressCheckoutButtonEnabled,
    viewCartButtonEnabled: config.cart.viewCartButtonEnabled,
    primaryColor: config.branding.primaryColor,
    checkoutButtonText: config.labels.expressCheckoutText,
    buttonText: config.labels.expressCheckoutText,
    showPoweredBy: config.branding.showPoweredBy
  });
  var ROOT_ID = "loopdesk-cart-drawer-root";
  var FETCH_MARKER = "__loopdeskCartDrawerPatched";
  var XHR_MARKER = "__loopdeskCartDrawerXhrPatched";
  var FORM_MARKER = "__loopdeskCartDrawerFormPatched";
  var LOCATION_MARKER = "__loopdeskCartDrawerLocationPatched";
  var LOOPDESK_HOST_MODE = "NO_THEME_DRAWER";
  var CART_DRAWER_MODULE_KEYS = ["CART_GOAL_PROGRESS", "DYNAMIC_BANNER", "PROMOTIONS", "QUICK_ADD", "UPSELLS", "BUNDLES", "RECOMMENDATIONS", "COUPON", "SAVINGS_SUMMARY", "STORE_CREDIT", "LOYALTY", "TRUST_BADGES", "CHECKOUT_REASSURANCE"];
  var CART_DRAWER_MODULE_SLOTS = ["BEFORE_CART_LINES", "AFTER_CART_LINES", "BEFORE_PROMOTIONS", "AFTER_PROMOTIONS", "BEFORE_COUPON", "AFTER_COUPON", "BEFORE_TOTALS", "AFTER_TOTALS", "BEFORE_CHECKOUT", "AFTER_CHECKOUT", "BEFORE_FOOTER", "AFTER_FOOTER"];
  var moduleRegistry = CART_DRAWER_MODULE_KEYS.reduce(function (registry, key) { registry[key] = null; return registry; }, {});

  var THEME_CART_DRAWER_SELECTORS = [
    "cart-drawer",
    "cart-notification",
    "details[open][aria-controls*='cart' i]",
    "details[open][class*='cart' i]",
    "#CartDrawer",
    "#cart-drawer",
    ".cart-drawer",
    ".cart-notification",
    ".drawer",
    ".drawer--cart",
    "[data-cart-drawer]",
    "[data-drawer='cart']",
    "#mini-cart",
    ".mini-cart",
    ".ajax-cart",
    "#ajax-cart-container",
    "[data-section-type='cart-drawer']",
    "#cart-sidebar",
    ".cart-sidebar"
  ];
  var THEME_CART_DRAWER_OPEN_CLASSES = ["open", "active", "animate", "menu-opening", "drawer--is-open", "is-open", "cart-drawer--active", "drawer--open"];
  var THEME_CART_BODY_OPEN_CLASSES = ["overflow-hidden", "js-drawer-open", "js-drawer-open-cart", "cart-drawer-open", "cart-open", "drawer-open", "menu-opening", "body--drawer-open", "lock-scroll", "no-scroll"];
  var LOOPDESK_BODY_LOCK_CLASSES = ["loopdesk-cart-drawer-is-open"];
  var CART_TRIGGER_SELECTOR = [
    'a[href="/cart"]',
    'a[href^="/cart"]',
    'button[name="cart"]',
    '[aria-label*="cart" i]',
    '[aria-label*="bag" i]',
    '[aria-label*="basket" i]',
    '[aria-controls*="cart" i]',
    '[id*="cart-icon" i]',
    '[id*="cart-toggle" i]',
    '[id*="cart-trigger" i]',
    '[id*="mini-cart" i]',
    '[class*="cart-icon" i]',
    '[class*="cart-toggle" i]',
    '[class*="cart-trigger" i]',
    '[class*="cart-link" i]',
    '[class*="cart-count" i]',
    '[class*="mini-cart" i]',
    '[class*="header__icon--cart" i]',
    '[class*="header-cart" i]',
    '[class*="basket" i]',
    '[data-cart]',
    '[data-cart-drawer]',
    '[data-cart-trigger]',
    '[data-action*="cart" i]',
    'summary',
    'button'
  ].join(',');

  function getCustomCartTriggerSelector() {
    var raw = config.cart && config.cart.customTriggerSelector;
    if (!raw || typeof raw !== "string") return "";
    var trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      document.querySelectorAll(trimmed);
      return trimmed;
    } catch (_error) {
      debugLog("invalid custom cart trigger selector ignored", { selector: trimmed }, true);
      return "";
    }
  }
  var CUSTOM_CART_TRIGGER_SELECTOR = getCustomCartTriggerSelector();
  var COMBINED_CART_TRIGGER_SELECTOR = CUSTOM_CART_TRIGGER_SELECTOR ? CART_TRIGGER_SELECTOR + "," + CUSTOM_CART_TRIGGER_SELECTOR : CART_TRIGGER_SELECTOR;
  var CART_TRIGGER_KEYWORD_REGEX = /\b(cart|bag|basket|trolley)\b|cart-icon|cart-toggle|cart-trigger|cart-link|cart-count|mini-cart|header__icon--cart|header-cart/;

  var state = { selectedOfferVariants: {}, offerProducts: {}, offerLoading: {}, open: false, loading: false, cart: null, error: "", hostMode: LOOPDESK_HOST_MODE, themeDrawer: null, fallbackReason: "", expressCheckoutLock: false, capability: null, drawerModeActive: false, neutralizedThemeDrawers: [], bodyLockSnapshot: null, removedThemeBodyClasses: [], cartTriggerTakeovers: [], promotionRuntimeRefresh: { attempts: 0, maxAttempts: 3, inFlight: false, delayedTimer: null, cartNonEmptyAttempted: false } };
  var cartTriggerObserver = null;
  var cartTriggerTakeoverTimer = null;
  var suppressNextCartClickUntil = 0;
  var suppressedCartTrigger = null;
  var deferredCartOpen = null;
  var deferredCartOpenTimers = [];
  var diagnosticActions = {};
  var elements = {};

  // Decimal places to show. The store's Shopify money format is authoritative:
  // a "*_no_decimals*" format means the storefront rounds to whole units (e.g.
  // ₹630, not ₹629.95), so the drawer must match it rather than always forcing
  // the currency's default (2 for INR).
  function moneyFractionDigits(format, currency) {
    var fmt = String(format || "");
    if (/no_decimals/i.test(fmt)) return 0;
    if (fmt) return 2;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).resolvedOptions().maximumFractionDigits; }
    catch (_error) { return 2; }
  }
  function money(cents, currency) {
    var minor = Math.round(Number(cents || 0));
    var shopify = (typeof window !== "undefined" && window.Shopify) || {};
    var format = shopify.money_format || "";
    // Prefer Shopify's own formatter so symbol, separators, and the store's
    // decimal preference exactly match what the theme renders.
    if (typeof shopify.formatMoney === "function" && format) {
      try { return shopify.formatMoney(minor, format); } catch (_error) {}
    }
    var resolvedCurrency = currency || (state.cart && state.cart.currency) || (shopify.currency && shopify.currency.active) || "INR";
    var digits = moneyFractionDigits(format, resolvedCurrency);
    var amount = minor / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: resolvedCurrency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(amount);
    } catch (_error) {
      return digits === 0 ? String(Math.round(amount)) : amount.toFixed(2);
    }
  }

  // Preview of the merchant's prepaid discount for the drawer nudge, mirroring
  // the server engine (services/express-checkout/pricing.ts). Display-only: the
  // express modal and server remain authoritative. Reads the public offer that
  // the storefront runtime-config endpoint exposes as LoopDeskConfig.prepaidOffer.
  function prepaidOfferSavingsMinor(subtotalMinor) {
    var offer = (window.LoopDeskConfig && window.LoopDeskConfig.prepaidOffer) || null;
    if (!offer || !offer.enabled) return 0;
    var subtotal = Math.max(0, Math.floor(Number(subtotalMinor || 0)));
    if (subtotal <= 0) return 0;
    var value = Number(offer.value || 0);
    if (!(value > 0)) return 0;
    var minSubtotal = offer.minSubtotalPaise == null ? null : Math.max(0, Math.floor(Number(offer.minSubtotalPaise)));
    if (minSubtotal != null && subtotal < minSubtotal) return 0;
    var raw = offer.type === "FIXED_AMOUNT" ? Math.floor(value) : Math.round(subtotal * (value / 100));
    var capped = offer.maxPaise == null ? raw : Math.min(raw, Math.max(0, Math.floor(Number(offer.maxPaise))));
    return Math.max(0, Math.min(subtotal, capped));
  }

  // Storefront teaser for the prepaid offer. Uses the merchant's custom message
  // (LoopDeskConfig.prepaidOffer.message) with {percent}/{amount}/{cap}
  // placeholders substituted; falls back to a sensible default built from the
  // offer's percent (or the computed savings amount for a fixed-amount offer).
  function prepaidOfferNudgeText(savingsMinor, currency) {
    var offer = (window.LoopDeskConfig && window.LoopDeskConfig.prepaidOffer) || null;
    if (!offer) return "";
    var amount = money(savingsMinor, currency);
    var percent = offer.percent != null && Number(offer.percent) > 0 ? String(Number(offer.percent)).replace(/\.0+$/, "") + "%" : "";
    var cap = offer.maxPaise != null ? money(offer.maxPaise, currency) : "";
    var custom = typeof offer.message === "string" ? offer.message.trim() : "";
    if (custom) return custom.replace(/\{percent\}/gi, percent).replace(/\{amount\}/gi, amount).replace(/\{cap\}/gi, cap);
    return percent
      ? "💸 Pay online at checkout & get " + percent + " off — you save " + amount
      : "💸 Pay online at checkout and save " + amount;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getSameOriginUrl(input) {
    try {
      if (!input) return null;
      var raw = typeof input === "string" ? input : input.url;
      var url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin ? url : null;
    } catch (_error) {
      return null;
    }
  }

  function isCartMutationUrl(input) {
    var url = getSameOriginUrl(input);
    if (!url) return false;
    return [
      "/cart/add",
      "/cart/add.js",
      "/cart/change",
      "/cart/change.js",
      "/cart/update",
      "/cart/update.js"
    ].indexOf(url.pathname) !== -1;
  }

  function isCartAddUrl(input) {
    var url = getSameOriginUrl(input);
    return Boolean(url && (url.pathname === "/cart/add" || url.pathname === "/cart/add.js"));
  }

  // Some themes' own add-to-cart JS navigates to /cart after a successful
  // AJAX add (a direct `location.href =`/`window.location =` assignment,
  // which no script can intercept — a hard browser platform limitation, not
  // a gap in our patching). Rather than trying to prevent that native
  // behavior (which would require disabling the theme's own submit handler
  // entirely, losing whatever native UI feedback it drives elsewhere), we
  // let it happen and immediately bounce back to where the shopper was,
  // then open the LoopDesk drawer there. This works regardless of which
  // mechanism a given theme uses to redirect.
  var CART_ADD_RETURN_KEY = "loopdeskCartAddReturnTo";
  var CART_ADD_REOPEN_KEY = "loopdeskCartAddReopenDrawer";
  var CART_ADD_RETURN_MAX_AGE_MS = 8000;

  function recordCartAddReturnIntent() {
    if (!shouldOpenLoopDeskAfterCartAdd()) return;
    try {
      sessionStorage.setItem(CART_ADD_RETURN_KEY, JSON.stringify({ url: window.location.href, ts: Date.now() }));
    } catch (_error) {}
  }

  function consumeCartAddReturnIntent() {
    var raw;
    try { raw = sessionStorage.getItem(CART_ADD_RETURN_KEY); } catch (_error) { return ""; }
    if (!raw) return "";
    try { sessionStorage.removeItem(CART_ADD_RETURN_KEY); } catch (_error) {}
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_error) { return ""; }
    if (!parsed || !parsed.url || !parsed.ts || Date.now() - parsed.ts > CART_ADD_RETURN_MAX_AGE_MS) return "";
    return parsed.url;
  }

  function consumeCartAddReopenIntent() {
    try {
      if (sessionStorage.getItem(CART_ADD_REOPEN_KEY) !== "1") return false;
      sessionStorage.removeItem(CART_ADD_REOPEN_KEY);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function bounceBackFromUnwantedCartPageNavigation() {
    if (!hasCartPath(window.location.pathname)) return false;
    var returnUrl = consumeCartAddReturnIntent();
    if (!returnUrl) return false;
    var parsedReturn = getSameOriginUrl(returnUrl);
    if (!parsedReturn || hasCartPath(parsedReturn.pathname)) return false;
    try { sessionStorage.setItem(CART_ADD_REOPEN_KEY, "1"); } catch (_error) {}
    try {
      window.location.replace(returnUrl);
      return true;
    } catch (_error) {
      try { sessionStorage.removeItem(CART_ADD_REOPEN_KEY); } catch (_removeError) {}
      return false;
    }
  }

  function listenForCartAddFormSubmissions() {
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form || form.nodeName !== "FORM") return;
      if (!isCartAddUrl(form.getAttribute("action") || "")) return;
      recordCartAddReturnIntent();
    }, true);
  }


  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function normalizeCartDrawerModules(value) {
    if (!isPlainObject(value) || !Array.isArray(value.modules)) return { schemaVersion: 1, modules: [] };
    var seen = {};
    var modules = [];
    value.modules.forEach(function (candidate) {
      if (!isPlainObject(candidate) || CART_DRAWER_MODULE_KEYS.indexOf(candidate.key) === -1 || CART_DRAWER_MODULE_SLOTS.indexOf(candidate.slot) === -1 || seen[candidate.key]) return;
      seen[candidate.key] = true;
      var order = typeof candidate.sortOrder === "number" ? candidate.sortOrder : Number(candidate.sortOrder);
      modules.push({
        key: candidate.key,
        enabled: candidate.enabled === true,
        slot: candidate.slot,
        sortOrder: Number.isFinite(order) ? Math.round(order) : 100,
        settings: isPlainObject(candidate.settings) ? Object.assign({}, candidate.settings) : undefined
      });
    });
    return { schemaVersion: 1, modules: modules };
  }

  function renderCartDrawerSlot(slot, context) {
    if (CART_DRAWER_MODULE_SLOTS.indexOf(slot) === -1) return "";
    var runtime;
    try { runtime = normalizeCartDrawerModules(config && config.cartIntelligence && config.cartIntelligence.cartDrawerModules); }
    catch (error) { debugLog("module registry normalization failed", { slot: slot, error: error && error.message }); return ""; }
    return runtime.modules.filter(function (module) { return module.enabled && module.slot === slot; })
      .sort(function (left, right) { return left.sortOrder - right.sortOrder || left.key.localeCompare(right.key); })
      .map(function (module) {
        var renderer = moduleRegistry[module.key];
        if (typeof renderer !== "function") return "";
        try { return String(renderer(Object.assign({}, context || {}, { module: module })) || ""); }
        catch (error) { debugLog("module renderer failed", { key: module.key, slot: slot, error: error && error.message }); return ""; }
      }).join("");
  }

  function bannerHash(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function safeBannerUrl(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 500 || /[<>\s]/.test(value.trim())) return null;
    var next = value.trim();
    if (next.charAt(0) === "/") return next.indexOf("//") === 0 ? null : next;
    try { var parsed = new URL(next); return ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) || ((parsed.protocol === "mailto:" || parsed.protocol === "tel:") && parsed.pathname) ? next : null; }
    catch (_error) { return null; }
  }

  function bannerDismissalKey(settings) {
    var shop = window.Shopify && window.Shopify.shop || window.LoopDeskConfig && (window.LoopDeskConfig.shop || window.LoopDeskConfig.shopDomain) || "unknown-shop";
    var material = JSON.stringify([settings.message, settings.style, settings.alignment, settings.showIcon, settings.linkLabel, settings.linkUrl, settings.openLinkInNewTab]);
    return "loopdesk:cart-banner-dismissed:" + bannerHash(String(shop).toLowerCase()) + ":" + bannerHash(material);
  }

  function isBannerDismissed(key) { try { return window.sessionStorage && window.sessionStorage.getItem(key) === "1"; } catch (_error) { return false; } }
  function dismissBanner(key) { try { if (window.sessionStorage) window.sessionStorage.setItem(key, "1"); } catch (_error) {} }

  function renderDynamicBannerModule(context) {
    try {
      var module = context && context.module;
      var settings = module && isPlainObject(module.settings) ? module.settings : {};
      var message = typeof settings.message === "string" ? settings.message.trim().slice(0, 240) : "";
      if (!module || module.enabled !== true || !message) return "";
      var hasItems = Boolean(context && context.cart && Number(context.cart.item_count || 0) > 0);
      var visibility = isPlainObject(settings.visibility) ? settings.visibility : {};
      if (hasItems ? visibility.cartWithItems === false : visibility.emptyCart === false) return "";
      var styles = ["INFO", "SUCCESS", "WARNING", "NEUTRAL", "BRAND"];
      var style = styles.indexOf(settings.style) === -1 ? "INFO" : settings.style;
      var alignment = settings.alignment === "LEFT" ? "LEFT" : "CENTER";
      var key = bannerDismissalKey(settings);
      if (settings.dismissible === true && isBannerDismissed(key)) return "";
      var linkUrl = safeBannerUrl(settings.linkUrl);
      var linkLabel = typeof settings.linkLabel === "string" ? settings.linkLabel.trim().slice(0, 60) : "";
      var icon = settings.showIcon === false ? "" : '<span class="loopdesk-cart-banner__icon" aria-hidden="true">' + (style === "WARNING" ? "!" : style === "SUCCESS" ? "✓" : "i") + '</span>';
      var link = linkUrl && linkLabel ? '<a class="loopdesk-cart-banner__link" href="' + escapeHtml(linkUrl) + '"' + (settings.openLinkInNewTab === true ? ' target="_blank" rel="noopener noreferrer"' : "") + '>' + escapeHtml(linkLabel) + '</a>' : "";
      var dismiss = settings.dismissible === true ? '<button type="button" class="loopdesk-cart-banner__dismiss" data-loopdesk-cart-banner-dismiss="' + escapeHtml(key) + '" aria-label="Dismiss banner">×</button>' : "";
      return '<section class="loopdesk-cart-banner loopdesk-cart-banner--' + style.toLowerCase() + ' loopdesk-cart-banner--' + alignment.toLowerCase() + '" role="' + (style === "WARNING" ? "alert" : "status") + '">' + icon + '<div class="loopdesk-cart-banner__content"><p>' + escapeHtml(message) + '</p>' + link + '</div>' + dismiss + '</section>';
    } catch (error) { debugLog("dynamic banner renderer failed", { error: error && error.message }); return ""; }
  }

  function savingsMinor(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(number)) : 0;
  }



  function promotionPricing(cart) {
    var builder = window.LoopDeskPromotionPricing && window.LoopDeskPromotionPricing.build;
    return typeof builder === "function" ? builder(cart) : null;
  }

  function buildCartSavingsSummary(context) {
    var cart = context && isPlainObject(context.cart) ? context.cart : {};
    var pricing = context && context.pricing || promotionPricing(cart);
    if (pricing && pricing.isAuthoritative) {
      return { offerSavingsMinor: pricing.productPromotionSavings, orderSavingsMinor: pricing.orderPromotionSavings, couponSavingsMinor: pricing.couponSavings, compareAtSavingsMinor: 0, totalSavingsMinor: pricing.totalSavings, breakdownComplete: pricing.breakdownComplete };
    }
    return { offerSavingsMinor: 0, orderSavingsMinor: 0, couponSavingsMinor: 0, compareAtSavingsMinor: 0, totalSavingsMinor: 0, breakdownComplete: false };
  }

  function renderSavingsSummaryModule(context) {
    try {
      var module = context && context.module;
      var settings = module && isPlainObject(module.settings) ? module.settings : {};
      var cart = context && context.cart;
      var items = cart && Array.isArray(cart.items) ? cart.items : [];
      if (!module || module.enabled !== true || !items.length || Number(cart.item_count || 0) <= 0) return "";
      var values = buildCartSavingsSummary(context);
      if (!values.totalSavingsMinor) return "";
      // Make the order (tier) discount self-explanatory so the shopper sees e.g.
      // "Order discount (5% off)" rather than an unexplained lump. The effective
      // percentage is derived from the classified order savings, and only shown
      // when the order discount is the sole discount so its basis is unambiguous.
      var pricing = context && context.pricing || promotionPricing(cart);
      var orderBasis = pricing && (pricing.qualifyingSubtotal || pricing.merchandiseSubtotal) || 0;
      var soleOrderDiscount = values.offerSavingsMinor === 0 && values.couponSavingsMinor === 0;
      var orderPct = soleOrderDiscount && values.orderSavingsMinor > 0 && orderBasis > 0 ? (values.orderSavingsMinor / orderBasis) * 100 : 0;
      var orderLabel = orderPct > 0 ? "Order discount (" + displayPercentage(orderPct) + "% off)" : "Order discount";
      var rows = [
        { shown: values.breakdownComplete && settings.showOfferSavings !== false, label: "Product savings", value: values.offerSavingsMinor },
        { shown: values.breakdownComplete, label: orderLabel, value: values.orderSavingsMinor },
        { shown: values.breakdownComplete && settings.showCouponSavings !== false, label: "Coupon discount", value: values.couponSavingsMinor },
        { shown: !values.breakdownComplete, label: "Total discount", value: values.totalSavingsMinor }
      ].filter(function (row) { return row.shown && (settings.hideZeroRows !== true || row.value > 0); });
      var showTotal = settings.showTotalSavings !== false;
      if (!showTotal && !rows.length) return "";
      var formatter = context && typeof context.money === "function" ? context.money : money;
      var currency = cart.currency;
      var title = typeof settings.title === "string" && settings.title.trim() ? settings.title.trim().slice(0, 80) : "You Saved";
      var header = showTotal ? '<div class="loopdesk-cart-savings__header"><h3 class="loopdesk-cart-savings__title">' + escapeHtml(title) + '</h3><strong class="loopdesk-cart-savings__total">' + escapeHtml(formatter(values.totalSavingsMinor, currency)) + '</strong></div>' : '<h3 class="loopdesk-cart-savings__title">' + escapeHtml(title) + '</h3>';
      var detail = rows.length ? '<dl class="loopdesk-cart-savings__rows">' + rows.map(function (row) { return '<div class="loopdesk-cart-savings__row"><dt class="loopdesk-cart-savings__label">' + escapeHtml(row.label) + '</dt><dd class="loopdesk-cart-savings__amount">' + escapeHtml(formatter(row.value, currency)) + '</dd></div>'; }).join("") + '</dl>' : "";
      return '<section class="loopdesk-cart-savings" aria-label="' + escapeHtml(title) + '">' + header + detail + '</section>';
    } catch (error) { debugLog("savings summary renderer failed", { error: error && error.message }); return ""; }
  }

  moduleRegistry.DYNAMIC_BANNER = renderDynamicBannerModule;
  moduleRegistry.SAVINGS_SUMMARY = renderSavingsSummaryModule;

  window.LoopDeskCartDrawerModules = {
    normalize: normalizeCartDrawerModules,
    renderCartDrawerSlot: renderCartDrawerSlot,
    registerRenderer: function (key, renderer) {
      if (CART_DRAWER_MODULE_KEYS.indexOf(key) !== -1 && (renderer === null || typeof renderer === "function")) moduleRegistry[key] = renderer;
    },
    renderDynamicBannerModule: renderDynamicBannerModule,
    renderSavingsSummaryModule: renderSavingsSummaryModule,
    buildCartSavingsSummary: buildCartSavingsSummary,
    safeBannerUrl: safeBannerUrl
  };

  if (!config.enabled || window.__LOOPDESK_CART_DRAWER_LOADED__) return;
  window.__LOOPDESK_CART_DRAWER_LOADED__ = true;

  function text(value, fallback) {
    var next = typeof value === "string" ? value.trim() : "";
    return next || fallback;
  }

  function nullableText(value) {
    var next = typeof value === "string" ? value.trim() : "";
    return next || null;
  }

  function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function firstDefined(primary, fallback) {
    return primary === undefined || primary === null ? fallback : primary;
  }

  function safeColor(value, fallback, path) {
    var next = typeof value === "string" ? value.trim() : "";
    if (/^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([0-9.,%\s-]+\)|hsla?\([0-9.,%\s-]+\))$/i.test(next)) return next;
    if (next) configDiagnostics("invalid values ignored", { path: path, value: next }, true);
    return fallback;
  }

  function safeRadius(value, fallback) {
    var next = typeof value === "string" ? value.trim() : "";
    if (/^(?:0|[0-9]{1,2}(?:\.[0-9]{1,2})?(?:px|rem|em|%))$/i.test(next)) return next;
    if (next) configDiagnostics("invalid values ignored", { path: "branding.borderRadius", value: next }, true);
    return fallback;
  }

  function safeLogoUrl(value) {
    var next = nullableText(value);
    if (!next) return null;
    try {
      var url = new URL(next, window.location.origin);
      if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "data:") return next;
    } catch (_error) {}
    configDiagnostics("invalid values ignored", { path: "branding.logoUrl" }, true);
    return null;
  }

  function configDiagnostics(message, payload, force) {
    if (!window.console || (window.LOOPDESK_CONFIG_DEBUG !== true && !force)) return;
    window.console.debug("[LoopDesk Config] " + message, payload || {});
  }

  function normalizeConfig(rawConfig) {
    var legacy = isPlainObject(window.LOOPDESK_CART_DRAWER_CONFIG) ? window.LOOPDESK_CART_DRAWER_CONFIG : {};
    var raw = isPlainObject(rawConfig) ? rawConfig : {};
    var branding = isPlainObject(raw.branding) ? raw.branding : raw;
    var labels = isPlainObject(raw.labels) ? raw.labels : raw;
    var cart = isPlainObject(raw.cart) ? raw.cart : raw;
    var checkout = isPlainObject(raw.checkout) ? raw.checkout : raw;
    var mode = cart.drawerMode || cart.cartDrawerMode || legacy.drawerMode || legacy.cartDrawerMode;
    if (!mode && (cart.cartOwnershipMode || legacy.cartOwnershipMode) === "theme") mode = "theme";
    if (!mode && (cart.cartOwnershipMode || legacy.cartOwnershipMode) === "app") mode = "loopdesk";
    if (["theme", "loopdesk", "auto"].indexOf(mode) === -1) mode = DEFAULT_CONFIG.cart.drawerMode;
    var storeName = text(branding.storeName, text(window.Shopify && window.Shopify.shop, DEFAULT_CONFIG.branding.storeName));
    var normalized = {
      branding: {
        merchantName: text(branding.merchantName, storeName),
        storeName: storeName,
        logoUrl: safeLogoUrl(branding.logoUrl),
        primaryColor: safeColor(branding.primaryColor || legacy.primaryColor, DEFAULT_CONFIG.branding.primaryColor, "branding.primaryColor"),
        secondaryColor: safeColor(branding.secondaryColor, DEFAULT_CONFIG.branding.secondaryColor, "branding.secondaryColor"),
        accentColor: safeColor(branding.accentColor, DEFAULT_CONFIG.branding.accentColor, "branding.accentColor"),
        textColor: safeColor(branding.textColor, DEFAULT_CONFIG.branding.textColor, "branding.textColor"),
        surfaceColor: safeColor(branding.surfaceColor, DEFAULT_CONFIG.branding.surfaceColor, "branding.surfaceColor"),
        borderRadius: safeRadius(branding.borderRadius, DEFAULT_CONFIG.branding.borderRadius),
        fontFamily: text(branding.fontFamily, DEFAULT_CONFIG.branding.fontFamily),
        showPoweredBy: bool(firstDefined(branding.showPoweredBy, legacy.showPoweredBy), DEFAULT_CONFIG.branding.showPoweredBy),
        poweredByText: text(branding.poweredByText, DEFAULT_CONFIG.branding.poweredByText)
      },
      labels: {
        expressCheckoutText: text(labels.expressCheckoutText || legacy.buttonText || legacy.checkoutButtonText || labels.buttonText || labels.checkoutButtonText, DEFAULT_CONFIG.labels.expressCheckoutText),
        viewCartText: text(labels.viewCartText, DEFAULT_CONFIG.labels.viewCartText),
        continueShoppingText: text(labels.continueShoppingText, DEFAULT_CONFIG.labels.continueShoppingText),
        loadingText: text(labels.loadingText, DEFAULT_CONFIG.labels.loadingText),
        secureCheckoutText: text(labels.secureCheckoutText, DEFAULT_CONFIG.labels.secureCheckoutText),
        otpContinueText: text(labels.otpContinueText, DEFAULT_CONFIG.labels.otpContinueText)
      },
      cart: {
        drawerMode: mode,
        openAfterAddToCart: bool(firstDefined(cart.openAfterAddToCart, legacy.openAfterAddToCart), DEFAULT_CONFIG.cart.openAfterAddToCart),
        expressCheckoutButtonEnabled: bool(firstDefined(cart.expressCheckoutButtonEnabled, legacy.expressCheckoutButtonEnabled), DEFAULT_CONFIG.cart.expressCheckoutButtonEnabled),
        viewCartButtonEnabled: bool(firstDefined(cart.viewCartButtonEnabled, legacy.viewCartButtonEnabled), DEFAULT_CONFIG.cart.viewCartButtonEnabled),
        nativeDrawerDisabledRequiredMessage: text(cart.nativeDrawerDisabledRequiredMessage, DEFAULT_CONFIG.cart.nativeDrawerDisabledRequiredMessage),
        customTriggerSelector: text(cart.customTriggerSelector || legacy.customTriggerSelector, DEFAULT_CONFIG.cart.customTriggerSelector)
      },
      checkout: {
        showSecureBadge: bool(checkout.showSecureBadge, DEFAULT_CONFIG.checkout.showSecureBadge),
        showTrustCopy: bool(checkout.showTrustCopy, DEFAULT_CONFIG.checkout.showTrustCopy)
      },
      enabled: bool(firstDefined(raw.enabled, legacy.enabled), DEFAULT_CONFIG.enabled),
      cartOwnershipMode: text(cart.cartOwnershipMode || legacy.cartOwnershipMode, DEFAULT_CONFIG.cartOwnershipMode),
      cartIntelligence: normalizeCartIntelligence(raw.cart_intelligence_config || raw.cartIntelligence),
      promotions: isPlainObject(raw.promotions) && Array.isArray(raw.promotions.rules) ? { rules: raw.promotions.rules } : { rules: [] }
    };
    configDiagnostics("runtime config normalized", { drawerMode: normalized.cart.drawerMode }, true);
    if (Object.keys(legacy).length) configDiagnostics("legacy config merged", { keys: Object.keys(legacy) }, true);
    configDiagnostics("defaults applied", { merchantName: normalized.branding.merchantName }, true);
    return normalized;
  }

  function normalizeCartIntelligence(value) {
    if (!isPlainObject(value)) return { enabled: false, cartGoalProgress: { enabled: false }, trustBadges: null, savingsSummary: normalizeSavingsSummaryConfig(null) };
    var rawGoal = isPlainObject(value.cartGoalProgress) ? value.cartGoalProgress : (isPlainObject(value.freeShippingProgress) ? value.freeShippingProgress : {});
    var rawTarget = firstDefined(rawGoal.targetAmountMinor, rawGoal.fallbackThresholdMinor);
    var target = Number(rawTarget);
    var goal = {
      enabled: rawGoal.enabled === true,
      goalType: "FREE_SHIPPING",
      goalName: text(rawGoal.goalName, "Free Shipping").slice(0, 80),
      targetAmountMinor: Number.isFinite(target) ? Math.round(target) : null,
      progressText: text(firstDefined(rawGoal.progressText, rawGoal.progressBarText), "You’re {amount} away from free shipping").slice(0, 160),
      unlockedText: text(rawGoal.unlockedText, "You’ve unlocked free shipping").slice(0, 160),
      hideAfterUnlock: rawGoal.hideAfterUnlock === true
    };
    var badges = value.trustBadges;
    if (!isPlainObject(badges) || !Array.isArray(badges.items) || badges.items.length > 6 || ["BELOW_TOTALS", "BELOW_CHECKOUT_BUTTON"].indexOf(badges.placement) === -1 || ["ROW", "GRID"].indexOf(badges.layout) === -1) {
      return Object.assign({}, value, { cartGoalProgress: goal, trustBadges: null, savingsSummary: normalizeSavingsSummaryConfig(value.savingsSummary) });
    }
    var icons = ["secure-payment", "delivery", "exchange", "cod", "support", "authenticity", "custom"];
    var items = badges.items.map(function (item, index) {
      if (!isPlainObject(item) || icons.indexOf(item.icon) === -1 || typeof item.label !== "string") return null;
      return { id: text(item.id, "badge-" + index).slice(0, 64), enabled: item.enabled === true, icon: item.icon, label: item.label.replace(/[<>]/g, "").replace(/javascript:/gi, "").trim().slice(0, 60), sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index };
    });
    if (items.some(function (item) { return !item; })) return Object.assign({}, value, { cartGoalProgress: goal, trustBadges: null, savingsSummary: normalizeSavingsSummaryConfig(value.savingsSummary) });
    return Object.assign({}, value, { cartGoalProgress: goal, savingsSummary: normalizeSavingsSummaryConfig(value.savingsSummary), trustBadges: { enabled: badges.enabled === true, placement: badges.placement, layout: badges.layout, items: items.sort(function (a, b) { return a.sortOrder - b.sortOrder; }) } });
  }

  function normalizeSavingsSummaryConfig(value) {
    var raw = isPlainObject(value) ? value : {};
    var supportedSlots = ["BEFORE_CART_LINES", "AFTER_CART_LINES", "BEFORE_PROMOTIONS", "AFTER_PROMOTIONS", "BEFORE_COUPON", "AFTER_COUPON", "BEFORE_TOTALS", "AFTER_TOTALS", "BEFORE_CHECKOUT", "AFTER_CHECKOUT", "BEFORE_FOOTER", "AFTER_FOOTER"];
    var order = typeof raw.sortOrder === "number" ? raw.sortOrder : Number(raw.sortOrder);
    var title = typeof raw.title === "string" ? raw.title.replace(/[<>]/g, "").trim().slice(0, 80) : "";
    return {
      enabled: raw.enabled === true, title: title || "You Saved",
      placement: supportedSlots.indexOf(raw.placement) === -1 ? "BEFORE_TOTALS" : raw.placement,
      sortOrder: Number.isFinite(order) && order >= 0 && order <= 999 ? Math.round(order) : 20,
      showTotalSavings: raw.showTotalSavings !== false, showOfferSavings: raw.showOfferSavings !== false,
      showCouponSavings: raw.showCouponSavings !== false, showCompareAtSavings: raw.showCompareAtSavings !== false,
      hideZeroRows: raw.hideZeroRows !== false
    };
  }

  function debugLog(message, payload, force) {
    if (!window.console || (window.LOOPDESK_CART_DRAWER_DEBUG !== true && !force)) return;
    window.console.debug("[LoopDesk Cart] " + message, payload || {});
  }

  function debugLogOnce(key, message, payload, force) {
    if (diagnosticActions[key]) return;
    diagnosticActions[key] = true;
    debugLog(message, payload, force);
  }


  function hasPromotionRules() {
    return Boolean(config.promotions && Array.isArray(config.promotions.rules) && config.promotions.rules.length > 0);
  }

  function getRuntimeShopDomain() {
    var candidates = [
      config && config.shop,
      config && config.shopDomain,
      config && config.general && config.general.shopDomain,
      window.LoopDeskConfig && window.LoopDeskConfig.shop,
      window.LoopDeskConfig && window.LoopDeskConfig.shopDomain,
      window.LOOPDESK_CART_DRAWER_CONFIG && window.LOOPDESK_CART_DRAWER_CONFIG.shop,
      window.LOOPDESK_CART_DRAWER_CONFIG && window.LOOPDESK_CART_DRAWER_CONFIG.shopDomain,
      window.Shopify && window.Shopify.shop,
      window.Shopify && window.Shopify.shopDomain
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      var value = typeof candidates[index] === "string" ? candidates[index].trim() : "";
      if (value) return value;
    }
    return "";
  }

  function normalizeRuntimePromotions(promotions) {
    return normalizeConfig({ promotions: promotions }).promotions;
  }

  function applyFreshRuntimePromotions(promotions) {
    var normalizedPromotions = normalizeRuntimePromotions(promotions);
    config.promotions = normalizedPromotions;
    window.LoopDeskConfig = Object.assign({}, window.LoopDeskConfig || {}, config, { promotions: normalizedPromotions });
    if (state.cart) ensureOfferProducts(eligiblePromotionRules(state.cart));
    render();
  }

  function refreshPromotionRuntime(reason) {
    if (hasPromotionRules()) return Promise.resolve(false);
    if (state.promotionRuntimeRefresh.inFlight || state.promotionRuntimeRefresh.attempts >= state.promotionRuntimeRefresh.maxAttempts) return Promise.resolve(false);
    var shopDomain = getRuntimeShopDomain();
    if (!shopDomain || typeof window.fetch !== "function") return Promise.resolve(false);

    state.promotionRuntimeRefresh.attempts += 1;
    state.promotionRuntimeRefresh.inFlight = true;
    var url = "/apps/loopd2c/api/runtime/config?shop=" + encodeURIComponent(shopDomain) + "&_loopdesk_runtime=" + Date.now();
    debugLog("promotion runtime refresh started", { reason: reason, attempt: state.promotionRuntimeRefresh.attempts }, true);
    return fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Promotion runtime request failed");
        return response.json();
      })
      .then(function (payload) {
        var freshConfig = payload && payload.config || {};
        if (freshConfig.promotions && Array.isArray(freshConfig.promotions.rules)) {
          applyFreshRuntimePromotions(freshConfig.promotions);
          debugLog("promotion runtime refresh applied", { rules: config.promotions.rules.length }, true);
          return true;
        }
        return false;
      })
      .catch(function () { return false; })
      .finally(function () { state.promotionRuntimeRefresh.inFlight = false; });
  }

  function schedulePromotionRuntimeRefresh(reason, delay) {
    if (hasPromotionRules()) return;
    if (state.promotionRuntimeRefresh.delayedTimer || state.promotionRuntimeRefresh.attempts >= state.promotionRuntimeRefresh.maxAttempts) return;
    state.promotionRuntimeRefresh.delayedTimer = window.setTimeout(function () {
      state.promotionRuntimeRefresh.delayedTimer = null;
      refreshPromotionRuntime(reason);
    }, delay);
  }

  function maybeRefreshPromotionsForCart(cart) {
    if (hasPromotionRules() || state.promotionRuntimeRefresh.cartNonEmptyAttempted) return;
    if (!cart || Number(cart.item_count || 0) <= 0) return;
    state.promotionRuntimeRefresh.cartNonEmptyAttempted = true;
    refreshPromotionRuntime("cart-non-empty");
  }

  debugLog("config loaded", { drawerMode: config.cart.drawerMode, openAfterAddToCart: config.cart.openAfterAddToCart, expressCheckoutButtonEnabled: config.cart.expressCheckoutButtonEnabled, viewCartButtonEnabled: config.cart.viewCartButtonEnabled }, true);

  function getLoopDeskRoot() {
    return document.getElementById(ROOT_ID);
  }

  function isLoopDeskOwned(element) {
    var root = getLoopDeskRoot();
    if (!element || !root) return false;
    var owned = element === root || (element.closest && element.closest("#" + ROOT_ID)) || (element.contains && element.contains(root));
    if (owned) debugLog("skipped LoopDesk-owned element", { element: element });
    return Boolean(owned);
  }

  function isInsideLoopDeskDrawer(element) {
    return Boolean(element && element.closest && element.closest("#" + ROOT_ID));
  }

  function isAppOwnedCartMode() {
    return isLoopDeskDrawerActive();
  }

  function setCartOwnershipMode(mode, reason) {
    config.cartOwnershipMode = mode;
    window.LoopDeskConfig = Object.assign({}, window.LoopDeskConfig || {}, config);
    window.LOOPDESK_CART_DRAWER_CONFIG = Object.assign({}, window.LOOPDESK_CART_DRAWER_CONFIG || {}, {
      cartOwnershipMode: mode,
      ownershipReason: reason
    });
  }

  function canUseCartAjax() {
    return typeof window.fetch === "function";
  }

  function canUseExpressCheckoutBridge() {
    return Boolean(window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") || true;
  }

  function getCapabilityResult() {
    var root = getLoopDeskRoot();
    // A loading document can receive a cart interaction before <body> exists.
    // The root is still mountable as soon as parsing reaches it, so do not give
    // theme navigation ownership during that short window.
    var rootAvailable = Boolean(root || document.body || document.documentElement);
    var result = {
      assetsLoaded: Boolean(window.__LOOPDESK_CART_DRAWER_LOADED__),
      cartAjaxAvailable: canUseCartAjax(),
      rootAvailable: rootAvailable,
      expressCheckoutBridgeAvailable: canUseExpressCheckoutBridge(),
      unsupportedState: Boolean(window.location && /^\/(?:checkout|account)(?:\/|$)/.test(window.location.pathname || "")),
      reason: "safe"
    };
    result.safe = result.assetsLoaded && result.cartAjaxAvailable && result.rootAvailable && result.expressCheckoutBridgeAvailable && !result.unsupportedState;
    if (!result.safe) {
      result.reason = !result.assetsLoaded ? "assets-not-loaded" : !result.cartAjaxAvailable ? "cart-ajax-unavailable" : !result.rootAvailable ? "root-unavailable" : !result.expressCheckoutBridgeAvailable ? "express-bridge-unavailable" : "unsupported-state";
    }
    state.capability = result;
    return result;
  }

  function cartOwnershipDecision(capability) {
    var hasController = Boolean(window.LoopDeskCartController);
    var hasRoot = Boolean(getLoopDeskRoot() || document.body);
    var hasCartApi = canUseCartAjax();
    var reason = capability && capability.reason ? capability.reason : "safe";
    var active = false;

    if (config.enabled === false) {
      reason = "disabled";
    } else if (config.cart.drawerMode === "theme") {
      reason = "theme-mode";
    } else if (!capability || !capability.safe) {
      reason = reason || "capability-failed";
    } else {
      active = true;
      reason = "capability-passed";
    }

    var ownershipMode = active ? "loopdesk" : "fallback";
    state.drawerModeActive = active;
    state.fallbackReason = active ? "" : reason;
    setCartOwnershipMode(ownershipMode, reason);
    debugLog("ownership decision", {
      drawerMode: config.cart.drawerMode,
      cartOwnershipMode: ownershipMode,
      enabled: config.enabled,
      hasController: hasController,
      hasCartApi: hasCartApi,
      hasRoot: hasRoot,
      reason: reason
    }, true);
    return { active: active, reason: reason, cartOwnershipMode: ownershipMode };
  }

  function isLoopDeskDrawerActive() {
    var capability = getCapabilityResult();
    return cartOwnershipDecision(capability).active;
  }

  function shouldOpenLoopDeskAfterCartAdd() {
    return Boolean(config.cart.openAfterAddToCart && isLoopDeskDrawerActive());
  }

  function scheduleNativeCartPanelCleanup() {
    [0, 50, 150, 300].forEach(function (delay) {
      window.setTimeout(function () {
        neutralizeThemeDrawers();
        debugLog("delayed cleanup ran", { delay: delay }, true);
        var remaining = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_DRAWER_SELECTORS.join(",")))
          .filter(function (drawer, index, list) { return drawer && !isLoopDeskOwned(drawer) && list.indexOf(drawer) === index && isThemeDrawerVisible(drawer); });
        if (remaining.length) debugLog("remaining native cart drawer detected after cleanup", { count: remaining.length, drawers: remaining.map(getElementDescriptor) }, true);
      }, delay);
    });
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        neutralizeThemeDrawers();
        debugLog("delayed cleanup ran", { delay: "requestAnimationFrame" }, true);
      });
    }
  }

  function refreshAfterCartMutation(wasAdd) {
    if (wasAdd && shouldOpenLoopDeskAfterCartAdd()) return refreshAndMaybeOpen(true);
    return refreshAndMaybeOpen(false);
  }

  function detectThemeDrawer() {
    var drawers = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_DRAWER_SELECTORS.join(",")))
      .filter(function (drawer, index, list) { return drawer && !isLoopDeskOwned(drawer) && list.indexOf(drawer) === index; });
    var drawer = drawers[0] || null;
    state.themeDrawer = drawer;
    debugLog("theme drawer detected " + (drawer ? "yes" : "no"), { element: drawer, visible: drawer ? isThemeDrawerVisible(drawer) : false });
    return drawer;
  }

  function rememberBodyLockState() {
    if (state.bodyLockSnapshot || !document.documentElement || !document.body) return;
    state.bodyLockSnapshot = {
      htmlOverflow: document.documentElement.style.overflow || "",
      bodyOverflow: document.body.style.overflow || "",
      htmlHadLoopDeskClass: document.documentElement.classList.contains("loopdesk-cart-drawer-is-open"),
      bodyHadLoopDeskClass: document.body.classList.contains("loopdesk-cart-drawer-is-open")
    };
  }

  function restoreLoopDeskBodyLock() {
    var snapshot = state.bodyLockSnapshot;
    if (document.documentElement) {
      if (snapshot) document.documentElement.style.overflow = snapshot.htmlOverflow;
      LOOPDESK_BODY_LOCK_CLASSES.forEach(function (className) {
        if (!snapshot || !snapshot.htmlHadLoopDeskClass) document.documentElement.classList.remove(className);
      });
    }
    if (document.body) {
      if (snapshot) document.body.style.overflow = snapshot.bodyOverflow;
      LOOPDESK_BODY_LOCK_CLASSES.forEach(function (className) {
        if (!snapshot || !snapshot.bodyHadLoopDeskClass) document.body.classList.remove(className);
      });
    }
    state.bodyLockSnapshot = null;
  }

  function removeThemeBodyOpenClasses() {
    state.removedThemeBodyClasses = [];
    [document.documentElement, document.body].forEach(function (root) {
      if (!root || !root.classList) return;
      THEME_CART_BODY_OPEN_CLASSES.forEach(function (className) {
        if (root.classList.contains(className)) {
          root.classList.remove(className);
          state.removedThemeBodyClasses.push({ element: root, className: className });
        }
      });
    });
  }

  function neutralizeThemeDrawers() {
    if (!isLoopDeskDrawerActive()) return;
    restoreNeutralizedThemeDrawers();
    removeThemeBodyOpenClasses();
    var drawers = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_DRAWER_SELECTORS.join(",")))
      .filter(function (drawer, index, list) { return drawer && !isLoopDeskOwned(drawer) && list.indexOf(drawer) === index; });

    drawers.forEach(function (drawer) {
      var visible = isThemeDrawerVisible(drawer);
      var hasOpenState = drawer.hasAttribute("open") || drawer.hidden || drawer.getAttribute("aria-hidden") === "false" || THEME_CART_DRAWER_OPEN_CLASSES.some(function (className) {
        return drawer.classList && drawer.classList.contains(className);
      });
      if (!visible && !hasOpenState) return;

      var record = {
        element: drawer,
        open: drawer.hasAttribute("open"),
        hidden: drawer.hidden,
        inert: drawer.inert,
        ariaHidden: drawer.getAttribute("aria-hidden"),
        loopdeskNeutralized: drawer.getAttribute("data-loopdesk-neutralized"),
        display: drawer.style.display || "",
        visibility: drawer.style.visibility || "",
        classes: {}
      };
      THEME_CART_DRAWER_OPEN_CLASSES.forEach(function (className) {
        record.classes[className] = drawer.classList && drawer.classList.contains(className);
        if (drawer.classList) drawer.classList.remove(className);
      });
      drawer.removeAttribute("open");
      drawer.setAttribute("aria-hidden", "true");
      drawer.setAttribute("data-loopdesk-neutralized", "true");
      drawer.hidden = true;
      try { drawer.inert = true; } catch (_error) {}
      drawer.style.display = "none";
      drawer.style.visibility = "hidden";
      state.neutralizedThemeDrawers.push(record);
      debugLog("native cart panel suppressed", { element: getElementDescriptor(drawer) }, true);
    });
  }

  function restoreNeutralizedThemeDrawers() {
    if (!state.neutralizedThemeDrawers || !state.neutralizedThemeDrawers.length) return;
    state.neutralizedThemeDrawers.forEach(function (record) {
      var drawer = record.element;
      if (!drawer || !drawer.isConnected) return;
      THEME_CART_DRAWER_OPEN_CLASSES.forEach(function (className) {
        if (!record.classes[className] && drawer.classList) drawer.classList.remove(className);
      });
      if (record.open) drawer.setAttribute("open", "");
      else drawer.removeAttribute("open");
      drawer.hidden = Boolean(record.hidden);
      try { drawer.inert = Boolean(record.inert); } catch (_error) {}
      drawer.style.display = record.display || "";
      drawer.style.visibility = record.visibility || "";
      if (record.ariaHidden === null) drawer.removeAttribute("aria-hidden");
      else drawer.setAttribute("aria-hidden", record.ariaHidden);
      if (record.loopdeskNeutralized === null) drawer.removeAttribute("data-loopdesk-neutralized");
      else drawer.setAttribute("data-loopdesk-neutralized", record.loopdeskNeutralized);
    });
    state.neutralizedThemeDrawers = [];
  }

  function isThemeDrawerVisible(element) {
    if (!element || isLoopDeskOwned(element)) return false;
    if (element.hasAttribute("open")) return true;
    if (element.getAttribute("aria-hidden") === "false") return true;
    if (THEME_CART_DRAWER_OPEN_CLASSES.some(function (className) { return element.classList && element.classList.contains(className); })) return true;

    var style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (!style || style.display === "none" || style.visibility === "hidden") return false;

    var rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function hasCartPath(href) {
    if (!href) return false;
    try {
      var url = new URL(href, window.location.origin);
      return url.origin === window.location.origin && /(?:^|\/)cart\/?$/.test(url.pathname);
    } catch (_error) {
      return /(?:^|\/)cart\/?(?:[?#].*)?$/.test(String(href));
    }
  }

  function elementText(element) {
    if (!element) return "";
    return [
      element.getAttribute && element.getAttribute("aria-label"),
      element.getAttribute && element.getAttribute("title"),
      element.getAttribute && element.getAttribute("data-action"),
      element.getAttribute && element.getAttribute("name"),
      element.id,
      element.className,
      element.textContent,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function isExcludedCartControl(element) {
    if (!element || !element.closest) return true;
    var excluded = element.closest([
      "[href*='checkout']",
      "[action*='checkout']",
      "[name*='checkout' i]",
      "[aria-label*='checkout' i]",
      "[class*='checkout' i]",
      "[id*='checkout' i]",
      "[name='plus']",
      "[name='minus']",
      "[name='updates[]']",
      "[data-quantity]",
      "[data-quantity-selector]",
      "[aria-label*='quantity' i]",
      "[aria-label*='increase' i]",
      "[aria-label*='decrease' i]",
      "[class*='quantity' i]",
      "[id*='quantity' i]",
      "[href*='change']",
      "[name*='remove' i]",
      "[aria-label*='remove' i]",
      "[class*='remove' i]",
      "[id*='remove' i]",
      "[class*='discount' i]",
      "[id*='discount' i]",
      "[name*='discount' i]",
      "[aria-label*='discount' i]",
      "[data-discount]",
      "form[action*='/cart/add'] button",
      "form[action*='/cart/add'] [role='button']",
      "[name='add']",
      "[type='submit'][formaction*='/cart/add']",
      // Add-to-cart / buy controls that live OUTSIDE a /cart/add form — e.g. a
      // custom mobile sticky/floating bar and its size-selection sheet that add
      // via their own fetch and then dispatch `loopdesk:cart-drawer:open` for
      // us. These are ADD actions, never cart-OPEN triggers, so we must never
      // clone/hijack them: doing so strips the theme's own size-sheet + ATC
      // handlers and steals the tap (the bug that broke mobile add-to-cart).
      // Theme-native hooks (megaska custom theme):
      "[data-product-sticky]",
      "[data-sticky-add]",
      "[data-sticky-buy]",
      "[data-sticky-offer]",
      "[data-size-sheet]",
      "[data-add-to-cart]",
      "[data-buy-now]",
      // Generic add-to-cart hooks for portability across other themes:
      "[data-add-to-bag]",
      "[data-atc-button]",
      "[data-sticky-atc]",
      "[class*='add-to' i]",
      "[class*='add_to' i]",
      "[class*='addtocart' i]",
      "[class*='addtobag' i]",
      "[class*='product-form__submit' i]",
    ].join(","));
    if (excluded) return true;
    var text = elementText(element);
    return /\b(checkout|quantity|qty|increase|decrease|remove|discount|coupon|promo)\b/.test(text) || /\badd(?:ed)?(?:\s|-|_)+to(?:\s|-|_)+(?:(?:my|your)(?:\s|-|_)+)?(?:cart|bag|basket|trolley)\b/.test(text);
  }

  function iconGlyphText(element) {
    if (!element || !element.querySelectorAll) return "";
    var parts = [];
    var useNodes = element.querySelectorAll("use");
    for (var i = 0; i < useNodes.length; i += 1) {
      parts.push(useNodes[i].getAttribute("href") || useNodes[i].getAttribute("xlink:href") || "");
    }
    var glyphNodes = element.querySelectorAll("img[alt], svg[aria-label], symbol[id], [data-icon]");
    for (var j = 0; j < glyphNodes.length; j += 1) {
      parts.push(glyphNodes[j].getAttribute("alt") || glyphNodes[j].getAttribute("aria-label") || glyphNodes[j].id || glyphNodes[j].getAttribute("data-icon") || "");
    }
    return parts.join(" ").toLowerCase();
  }

  function findCartTrigger(target) {
    if (!target || !target.closest || isInsideLoopDeskDrawer(target)) return null;
    var link = target.closest("a[href]");
    if (link && hasCartPath(link.getAttribute("href")) && !isExcludedCartControl(link)) return link;

    if (CUSTOM_CART_TRIGGER_SELECTOR) {
      var customTrigger = target.closest(CUSTOM_CART_TRIGGER_SELECTOR);
      if (customTrigger && !isInsideLoopDeskDrawer(customTrigger) && !isExcludedCartControl(customTrigger)) {
        debugLogOnce("cart-trigger-matched-custom", "cart trigger matched merchant custom selector", { eventType: "cart-trigger", trigger: getElementDescriptor(customTrigger) }, true);
        return customTrigger;
      }
    }

    var trigger = closestSelector(target, CART_TRIGGER_SELECTOR);
    if (!trigger || isInsideLoopDeskDrawer(trigger) || isExcludedCartControl(trigger)) return null;

    var wrapper = trigger.closest && trigger.closest("[class*='cart-icon' i], [id*='cart-icon' i], [class*='header__icon--cart' i], [class*='header-cart' i], [class*='cart-toggle' i], [class*='cart-trigger' i], [class*='mini-cart' i], [data-cart], [data-cart-drawer], [data-cart-trigger], [aria-controls*='cart' i]");
    var text = elementText(trigger) + " " + elementText(wrapper || null) + " " + iconGlyphText(trigger) + " " + iconGlyphText(wrapper || null);
    if (!hasCartPath(trigger.getAttribute && trigger.getAttribute("href")) && !CART_TRIGGER_KEYWORD_REGEX.test(text)) return null;
    debugLogOnce("cart-trigger-matched", "cart trigger matched selector/type", { eventType: "cart-trigger", trigger: getElementDescriptor(trigger), wrapper: getElementDescriptor(wrapper) }, true);
    return trigger;
  }


  function getConnectedTakeoverRecord(element) {
    return state.cartTriggerTakeovers.filter(function (record) { return record && (record.clone === element || record.original === element); })[0] || null;
  }

  function handleOwnedCartTriggerEvent(event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    return ownCartTriggerEvent(event, this, event.type);
  }

  function prepareLoopDeskCartTrigger(trigger) {
    if (!trigger || trigger.getAttribute("data-loopdesk-cart-trigger") === "true") return trigger;
    var clone = trigger.cloneNode(true);
    clone.setAttribute("data-loopdesk-cart-trigger", "true");
    clone.setAttribute("data-loopdesk-original-trigger", "true");
    if (clone.tagName && clone.tagName.toLowerCase() === "a") clone.setAttribute("href", "javascript:void(0)");
    if (!/^(a|button|summary)$/i.test(clone.tagName || "")) {
      clone.setAttribute("role", clone.getAttribute("role") || "button");
      clone.setAttribute("tabindex", clone.getAttribute("tabindex") || "0");
    }
    if (!clone.getAttribute("aria-label") && !clone.textContent.trim()) clone.setAttribute("aria-label", "Open cart");
    ["pointerdown", "mousedown", "touchstart", "click", "keydown"].forEach(function (eventName) {
      clone.addEventListener(eventName, handleOwnedCartTriggerEvent, true);
      clone.addEventListener(eventName, handleOwnedCartTriggerEvent, false);
    });
    return clone;
  }

  function applyCartTriggerTakeover() {
    if (!isDrawerAvailable() || !isLoopDeskDrawerActive()) {
      restoreCartTriggerTakeover();
      return;
    }
    var applied = 0;
    var triggers = Array.prototype.slice.call(document.querySelectorAll(COMBINED_CART_TRIGGER_SELECTOR))
      .filter(function (trigger, index, list) {
        return trigger && list.indexOf(trigger) === index && !isInsideLoopDeskDrawer(trigger) && trigger.getAttribute("data-loopdesk-cart-trigger") !== "true" && findCartTrigger(trigger) === trigger && !getConnectedTakeoverRecord(trigger);
      });
    triggers.forEach(function (trigger) {
      if (!trigger.parentNode) return;
      var clone = prepareLoopDeskCartTrigger(trigger);
      var record = { original: trigger, clone: clone, parent: trigger.parentNode, nextSibling: trigger.nextSibling };
      trigger.parentNode.replaceChild(clone, trigger);
      state.cartTriggerTakeovers.push(record);
      applied += 1;
      debugLog("trigger cloned", { trigger: getElementDescriptor(clone) }, true);
    });
    if (applied) debugLog("trigger takeover applied", { count: applied }, true);
  }

  function restoreCartTriggerTakeover() {
    if (!state.cartTriggerTakeovers.length) return;
    state.cartTriggerTakeovers.forEach(function (record) {
      if (record.clone && record.clone.parentNode) {
        record.clone.parentNode.replaceChild(record.original, record.clone);
        debugLog("trigger restored", { trigger: getElementDescriptor(record.original) }, true);
      }
    });
    state.cartTriggerTakeovers = [];
  }

  function scheduleCartTriggerTakeover(reason) {
    if (cartTriggerTakeoverTimer) window.clearTimeout(cartTriggerTakeoverTimer);
    cartTriggerTakeoverTimer = window.setTimeout(function () {
      cartTriggerTakeoverTimer = null;
      applyCartTriggerTakeover();
      if (reason === "mutation") debugLog("mutation observer reapplied takeover", {}, true);
    }, 80);
  }

  function observeCartTriggerTakeoverTargets() {
    if (!window.MutationObserver || cartTriggerObserver) return;
    cartTriggerObserver = new MutationObserver(function (mutations) {
      var shouldReapply = mutations.some(function (mutation) {
        if (!mutation.target || isInsideLoopDeskDrawer(mutation.target)) return false;
        if (mutation.target.getAttribute && mutation.target.getAttribute("data-loopdesk-cart-trigger") === "true") return false;
        return mutation.type === "childList" || mutation.type === "attributes";
      });
      if (shouldReapply) scheduleCartTriggerTakeover("mutation");
    });
    cartTriggerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "href", "aria-label", "aria-controls", "data-cart", "data-cart-drawer"]
    });
  }

  function getItemImage(item) {
    var image = item && (item.image || item.featured_image && (item.featured_image.url || item.featured_image.src));
    return image ? String(image).replace(/(\.(?:jpg|jpeg|png|webp))(?:\?.*)?$/i, "_160x$1") : "";
  }

  function lineSavingsHtml(item, cart) {
    var original = Number(item.original_line_price || 0);
    var finalPrice = Number(item.final_line_price || 0);
    if (original > finalPrice) return '<div class="loopdesk-cart-drawer__savings">You save ' + money(original - finalPrice, cart.currency) + '</div>';
    return "";
  }


  function productGidFromId(id) {
    return id ? "gid://shopify/Product/" + String(id) : "";
  }


  function centsFromDecimal(value) {
    var number = Number(value || 0);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function isScheduleActive(rule) {
    var now = Date.now();
    var schedule = rule && rule.schedule || {};
    var starts = schedule.startsAt ? Date.parse(schedule.startsAt) : null;
    var ends = schedule.endsAt ? Date.parse(schedule.endsAt) : null;
    return (!starts || starts <= now) && (!ends || ends >= now);
  }

  function ruleTriggerProductGids(rule) {
    var groups = rule && rule.trigger && Array.isArray(rule.trigger.sourceGroups) ? rule.trigger.sourceGroups : [];
    return groups.reduce(function (ids, group) {
      (Array.isArray(group.productGids) ? group.productGids : []).forEach(function (gid) { if (ids.indexOf(gid) === -1) ids.push(gid); });
      return ids;
    }, []);
  }

  function quantityForProductGids(cart, gids) {
    return (cart.items || []).reduce(function (total, item) {
      if (isPromotionLineForAnyRule(item)) return total;
      return gids.indexOf(productGidFromId(item.product_id)) === -1 ? total : total + Number(item.quantity || 0);
    }, 0);
  }

  function triggerQuantity(cart, rule) {
    return quantityForProductGids(cart, ruleTriggerProductGids(rule));
  }

  function triggerMatches(cart, rule) {
    var minimum = Number(rule.trigger && rule.trigger.minimumQuantity || 1);
    var groups = rule && rule.trigger && Array.isArray(rule.trigger.sourceGroups) ? rule.trigger.sourceGroups : [];
    if ((rule.trigger && rule.trigger.matchMode) !== "ALL") return triggerQuantity(cart, rule) >= minimum;
    return groups.length > 0 && groups.every(function (group) {
      return quantityForProductGids(cart, Array.isArray(group.productGids) ? group.productGids : []) >= minimum;
    });
  }

  function rewardQuantityInCart(cart, rule) {
    return (cart.items || []).reduce(function (total, item) {
      return isPromotionLineForRule(item, rule) ? total + Number(item.quantity || 0) : total;
    }, 0);
  }

  function rewardQuantityCap(rule) {
    var reward = rule && rule.reward || {};
    return Number(reward.configuration && reward.configuration.quantityCap || reward.maximumQuantity || 1);
  }

  function promotionLineProperties(item) {
    return item && item.properties && typeof item.properties === "object" ? item.properties : {};
  }

  function isPromotionLineForAnyRule(item) {
    var props = promotionLineProperties(item);
    return Boolean(props._loopdesk_promotion_rule_id || props._loopdesk_promotion_compilation_version);
  }

  function isPromotionLineForRule(item, rule) {
    var props = promotionLineProperties(item);
    return String(props._loopdesk_promotion_rule_id || "") === String(rule && rule.ruleId || "") &&
      String(props._loopdesk_promotion_compilation_version || "") === String(rule && rule.compilation && rule.compilation.version || "");
  }

  function selectedVariantForRule(rule) {
    var product = state.offerProducts[rule.ruleId];
    var variants = product && Array.isArray(product.variants) ? product.variants : [];
    var selected = state.selectedOfferVariants[rule.ruleId];
    return variants.filter(function (variant) { return String(variant.id) === String(selected) && variant.available !== false; })[0] || variants.filter(function (variant) { return variant.available !== false; })[0] || null;
  }

  function eligiblePromotionRules(cart) {
    if (!cart || !cart.items) return [];
    var rules = config.promotions && Array.isArray(config.promotions.rules) ? config.promotions.rules : [];
    return rules.filter(function (rule) {
      if (!rule || rule.status !== "ACTIVE" || !rule.compilation || rule.compilation.status !== "READY") return false;
      if (!isScheduleActive(rule)) return false;
      if (!rule.offer || !rule.offer.handle) return false;
      if (!triggerMatches(cart, rule)) return false;
      if (centsFromDecimal(rule.trigger && rule.trigger.minimumCartSubtotal) > Number(cart.items_subtotal_price || cart.total_price || 0)) return false;
      if (rewardQuantityInCart(cart, rule) >= rewardQuantityCap(rule)) return false;
      var product = state.offerProducts[rule.ruleId];
      return !product || (Array.isArray(product.variants) && product.variants.some(function (variant) { return variant.available !== false; }));
    }).sort(function (a, b) { return Number(a.priority || 0) - Number(b.priority || 0); });
  }

  function ensureOfferProducts(rules) {
    rules.forEach(function (rule) {
      if (!rule.offer || !rule.offer.handle || state.offerProducts[rule.ruleId] || state.offerLoading[rule.ruleId]) return;
      state.offerLoading[rule.ruleId] = true;
      fetch('/products/' + encodeURIComponent(rule.offer.handle) + '.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (response) { if (!response.ok) throw new Error('Offer product unavailable'); return response.json(); })
        .then(function (product) { state.offerProducts[rule.ruleId] = product; var variant = selectedVariantForRule(rule); if (variant) state.selectedOfferVariants[rule.ruleId] = String(variant.id); })
        .catch(function () { state.offerProducts[rule.ruleId] = { variants: [] }; })
        .finally(function () { state.offerLoading[rule.ruleId] = false; render(); });
    });
  }

  function offerConfirmationHtml(cart, rule) {
    var lines = (cart.items || []).filter(function (item) { return isPromotionLineForRule(item, rule); });
    if (!lines.length) return '';
    var original = lines.reduce(function (sum, item) { return sum + Number(item.original_line_price || item.line_price || 0); }, 0);
    var finalPrice = lines.reduce(function (sum, item) { return sum + Number(item.final_line_price || item.line_price || 0); }, 0);
    if (original <= finalPrice) return '';
    return '<div class="loopdesk-cart-drawer__offer-savings"><span>' + money(original, cart.currency) + '</span><strong>' + money(finalPrice, cart.currency) + '</strong><em>' + money(original - finalPrice, cart.currency) + '</em></div>';
  }

  function variantPriceHtml(variant, cart) {
    var price = Number(variant && variant.price || 0);
    var compareAt = Number(variant && variant.compare_at_price || 0);
    return '<span class="loopdesk-cart-drawer__offer-price">' +
      (compareAt > price ? '<s>' + money(compareAt, cart && cart.currency) + '</s>' : '') +
      '<strong>' + money(price, cart && cart.currency) + '</strong></span>';
  }

  function renderOfferCard(rule, cart) {
    var presentation = rule.presentation || {};
    var product = state.offerProducts[rule.ruleId];
    var variants = product && Array.isArray(product.variants) ? product.variants : [];
    var selected = selectedVariantForRule(rule);
    var image = (product && product.featured_image) || rule.offer.imageUrl || '';
    var productTitle = product && product.title || rule.offer.title || presentation.heading || '';
    var selectedVariantTitle = selected && selected.title && selected.title !== "Default Title" ? selected.title : "";
    return ['<article class="loopdesk-cart-drawer__offer" data-loopdesk-offer-rule="' + escapeHtml(rule.ruleId) + '">',
      image ? '<img class="loopdesk-cart-drawer__offer-image" src="' + escapeHtml(image) + '" alt="" loading="lazy">' : '',
      presentation.badgeText ? '<div class="loopdesk-cart-drawer__offer-badge">' + escapeHtml(presentation.badgeText) + '</div>' : '',
      presentation.heading ? '<h3>' + escapeHtml(presentation.heading) + '</h3>' : '',
      productTitle ? '<div class="loopdesk-cart-drawer__offer-product-title">' + escapeHtml(productTitle) + '</div>' : '',
      selectedVariantTitle ? '<div class="loopdesk-cart-drawer__offer-variant-title">' + escapeHtml(selectedVariantTitle) + '</div>' : '',
      selected ? variantPriceHtml(selected, cart) : '',
      presentation.customerMessage ? '<p>' + escapeHtml(presentation.customerMessage) + '</p>' : '',
      variants.length ? '<select data-loopdesk-offer-variant data-loopdesk-offer-rule="' + escapeHtml(rule.ruleId) + '">' + variants.map(function (variant) { return '<option value="' + escapeHtml(variant.id) + '" ' + (selected && String(selected.id) === String(variant.id) ? 'selected' : '') + ' ' + (variant.available === false ? 'disabled' : '') + '>' + escapeHtml((variant.title && variant.title !== "Default Title" ? variant.title + " — " : "") + money(variant.price, cart.currency)) + '</option>'; }).join('') + '</select>' : '',
      presentation.ctaText ? '<button type="button" data-loopdesk-add-offer data-loopdesk-offer-rule="' + escapeHtml(rule.ruleId) + '" ' + (!selected ? 'disabled' : '') + '>' + escapeHtml(presentation.ctaText) + '</button>' : '',
      offerConfirmationHtml(cart, rule), '</article>'].join('');
  }

  function renderOffers(cart) {
    var rules = eligiblePromotionRules(cart);
    ensureOfferProducts(rules);
    return rules.map(function (rule) { return renderOfferCard(rule, cart); }).join('');
  }

  function renderLines(cart) {
    if (state.loading) return '<div class="loopdesk-cart-drawer__loading"><span></span>' + escapeHtml(config.labels.loadingText) + '</div>';
    if (!cart || !cart.items || cart.items.length === 0) {
      return '<div class="loopdesk-cart-drawer__empty"><strong>Your cart is empty</strong><span>Add something you love and come back for express checkout.</span></div>';
    }

    return cart.items.map(function (item, index) {
      var variant = item.variant_title && item.variant_title !== "Default Title" ? '<div class="loopdesk-cart-drawer__variant">' + escapeHtml(item.variant_title) + "</div>" : "";
      var image = getItemImage(item);
      return [
        '<article class="loopdesk-cart-drawer__line" data-loopdesk-line-key="' + escapeHtml(item.key) + '">',
        '<div class="loopdesk-cart-drawer__image-wrap">' + (image ? '<img class="loopdesk-cart-drawer__image" src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.product_title || item.title) + '" loading="lazy">' : '<div class="loopdesk-cart-drawer__image loopdesk-cart-drawer__image--placeholder"></div>') + '</div>',
        '<div class="loopdesk-cart-drawer__line-main">',
        '<div class="loopdesk-cart-drawer__line-top"><div><div class="loopdesk-cart-drawer__title">' + escapeHtml(item.product_title || item.title) + "</div>" + variant + '</div><div class="loopdesk-cart-drawer__price">' + money(item.final_line_price, cart.currency) + lineSavingsHtml(item, cart) + '</div></div>',
        '<div class="loopdesk-cart-drawer__line-actions"><div class="loopdesk-cart-drawer__qty" aria-label="Quantity controls"><button type="button" data-loopdesk-qty="decrease" data-loopdesk-line="' + index + '">−</button><span>' + escapeHtml(item.quantity) + '</span><button type="button" data-loopdesk-qty="increase" data-loopdesk-line="' + index + '">+</button></div><button type="button" class="loopdesk-cart-drawer__remove" data-loopdesk-remove data-loopdesk-line="' + index + '">Remove</button></div>',
        "</div>",
        "</article>",
      ].join("");
    }).join("");
  }

  function cartGoalProgressViewModel(cart) {
    var intelligence = config.cartIntelligence || {};
    var progress = intelligence.cartGoalProgress || {};
    var subtotal = Math.max(0, Number(cart && (cart.items_subtotal_price || cart.total_price) || 0));
    var currency = String(cart && cart.currency || "").toUpperCase();
    var threshold = Number(progress.targetAmountMinor);
    var visible = Boolean(intelligence.enabled === true && progress.enabled === true && Number.isFinite(threshold) && threshold > 0);
    if (!visible) return { visible: false, goalType: "FREE_SHIPPING", goalName: progress.goalName || "Free Shipping", currency: currency || null, targetAmountMinor: 0, currentSubtotalMinor: subtotal, remainingAmountMinor: 0, progressPercent: 0, unlocked: false, message: "" };
    var remaining = Math.max(0, threshold - subtotal);
    var unlocked = remaining === 0;
    return { visible: !(unlocked && progress.hideAfterUnlock === true), goalType: "FREE_SHIPPING", goalName: progress.goalName || "Free Shipping", currency: currency || null, targetAmountMinor: threshold, currentSubtotalMinor: subtotal, remainingAmountMinor: remaining, progressPercent: unlocked ? 100 : Math.min(100, Math.max(0, Math.round(subtotal / threshold * 100))), unlocked: unlocked, message: unlocked ? String(progress.unlockedText || "You’ve unlocked free shipping") : String(progress.progressText || "You’re {amount} away from free shipping") };
  }

  function renderCartGoalProgress(cart) {
    var viewModel = cartGoalProgressViewModel(cart);
    if (!viewModel.visible) return "";
    var message = viewModel.unlocked ? viewModel.message : viewModel.message.replace(/\{amount\}/g, money(viewModel.remainingAmountMinor, viewModel.currency));
    return '<section class="loopdesk-cart-drawer__shipping-progress" aria-live="polite"><p class="loopdesk-cart-drawer__shipping-progress-text">' + escapeHtml(message) + '</p><div class="loopdesk-cart-drawer__shipping-progress-track" role="progressbar" aria-label="' + escapeHtml(viewModel.goalName) + ' progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + viewModel.progressPercent + '"><span style="width:' + viewModel.progressPercent + '%"></span></div></section>';
  }

  // Shopify's AJAX `original_total_price` is the closest safe storefront projection of
  // cart.cost.subtotalAmount: it is merchandise-only and is not reduced by automatic or code discounts.
  function tierQualifyingSubtotal(cart) {
    var minor = cart && Number(cart.original_total_price);
    return Number.isFinite(minor) && minor >= 0 ? minor / 100 : null;
  }

  function activeOrderTierRule() {
    var rules = config.promotions && Array.isArray(config.promotions.rules) ? config.promotions.rules : [];
    return rules.filter(function (rule) {
      var reward = rule && rule.reward;
      var configuration = reward && reward.configuration;
      return rule.status === "ACTIVE" && rule.compilation && rule.compilation.status === "READY" && isScheduleActive(rule) && reward.scope === "order" && reward.method === "percentage" && configuration && configuration.basis === "eligible_merchandise_subtotal";
    }).sort(function (a, b) { return Number(b.priority || 0) - Number(a.priority || 0) || String(a.ruleId || "").localeCompare(String(b.ruleId || "")); })[0] || null;
  }

  function tierProgressViewModel(cart) {
    var rule = activeOrderTierRule();
    var subtotal = tierQualifyingSubtotal(cart);
    var evaluator = window.LoopDeskTierProgress && window.LoopDeskTierProgress.buildTierProgressViewModel;
    if (!rule || subtotal === null || typeof evaluator !== "function") return null;
    var configuration = rule.reward.configuration;
    var tiers = Array.isArray(configuration.tiers) ? configuration.tiers.map(function (tier, index) { return { publicId: tier.publicId || tier.id, position: Number.isInteger(tier.position) ? tier.position : index, minimumSubtotal: tier.minimumSubtotal, maximumSubtotal: tier.maximumSubtotal, percentage: tier.percentage }; }) : [];
    var model = evaluator({ qualifyingSubtotal: subtotal, tiers: tiers, currencyCode: String(cart.currency || "").toUpperCase(), promotionPublicId: rule.publicId || rule.ruleId || null, selectionMode: configuration.selectionMode, continuityMode: configuration.continuityMode });
    return model && model.enabled ? model : null;
  }

  function majorMoney(amount, currency) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount); }
    catch (_error) { return String(amount) + " " + currency; }
  }

  function tierRangeLabel(tier, currency) {
    if (tier.maximumSubtotal === null) return majorMoney(tier.minimumSubtotal, currency) + "+";
    var digits = 2;
    try { digits = new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).resolvedOptions().maximumFractionDigits; } catch (_error) {}
    var unit = Math.pow(10, -digits);
    return majorMoney(tier.minimumSubtotal, currency) + "–" + majorMoney(Math.max(tier.minimumSubtotal, tier.maximumSubtotal - unit), currency);
  }

  function displayPercentage(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

  function renderTierProgress(cart) {
    var model = tierProgressViewModel(cart);
    if (!model) return "";
    var statusTitle = model.message.title ? '<strong class="loopdesk-tier-progress__status-title">' + escapeHtml(model.message.title) + '</strong>' : '';
    var description = model.message.description.replace("{amount}", model.amountToNextTier === null ? "" : majorMoney(model.amountToNextTier, model.currencyCode));
    var markers = model.tiers.map(function (tier, index) {
      var stateName = tier.isCurrent ? "current" : tier.isUnlocked ? "unlocked" : tier.isNext ? "next" : "locked";
      var connector = index < model.tiers.length - 1 ? '<span class="loopdesk-tier-progress__connector"><i style="width:' + (tier.isUnlocked ? (tier.isCurrent ? model.progressPercent : 100) : 0) + '%"></i></span>' : '';
      return '<li class="loopdesk-tier-progress__tier is-' + stateName + '"><span class="loopdesk-tier-progress__marker" aria-hidden="true">' + (tier.isUnlocked && !tier.isCurrent ? '&#10003;' : '') + '</span>' + connector + '<span class="loopdesk-tier-progress__range">' + escapeHtml(tierRangeLabel(tier, model.currencyCode)) + '</span><strong>' + escapeHtml(displayPercentage(tier.percentage)) + '% OFF</strong></li>';
    }).join("");
    return '<section class="loopdesk-tier-progress" style="--tier-count:' + model.tiers.length + '" aria-labelledby="loopdesk-tier-progress-title" aria-live="polite"><p class="loopdesk-tier-progress__eyebrow">' + escapeHtml(model.message.eyebrow) + '</p><h3 id="loopdesk-tier-progress-title">Your cart discount increases as you add more.</h3><div class="loopdesk-tier-progress__bar" role="progressbar" aria-label="Cart discount progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + model.progressPercent + '"><ol>' + markers + '</ol></div><p class="loopdesk-tier-progress__status">' + statusTitle + '<span>' + escapeHtml(description) + '</span></p><small>Discount applied automatically at checkout.</small></section>';
  }

  function trustBadgeIcon(icon) {
    var paths = {
      "secure-payment": '<path d="M12 3l7 3v5c0 4.6-3 8-7 10-4-2-7-5.4-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
      delivery: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      exchange: '<path d="M7 7h11l-3-3M17 17H6l3 3M18 7l-3 3M6 17l3-3"/>',
      cod: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h5M7 14h3M16 10v4"/>',
      support: '<path d="M4 13v-2a8 8 0 0116 0v2M4 13h3v5H5a1 1 0 01-1-1v-4zM20 13h-3v5h2a1 1 0 001-1v-4zM17 18c-1 2-3 3-5 3"/>',
      authenticity: '<path d="M12 3l2.2 2.2 3.1-.4.4 3.1L20 10l-1.6 2.7.8 3-3 .8-1.5 2.7-2.7-1.5-2.7 1.5-1.5-2.7-3-.8.8-3L4 10l2.3-2.1.4-3.1 3.1.4L12 3z"/><path d="M9 11.5l2 2 4-4"/>',
      custom: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths[icon] + '</svg>';
  }

  function renderTrustBadges(placement) {
    var intelligence = config.cartIntelligence;
    var badges = intelligence && intelligence.trustBadges;
    if (!intelligence || intelligence.enabled !== true || !badges || badges.enabled !== true || badges.placement !== placement) return "";
    var items = badges.items.filter(function (item) { return item.enabled && item.label; });
    if (!items.length) return "";
    return '<section class="loopdesk-cart-drawer__trust-badges loopdesk-cart-drawer__trust-badges--' + badges.layout.toLowerCase() + '" aria-label="Store assurances">' + items.map(function (item) { return '<div class="loopdesk-cart-drawer__trust-badge">' + trustBadgeIcon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></div>'; }).join("") + '</section>';
  }

  document.addEventListener("loopdesk:runtime-config", function (event) {
    var runtimeConfig = event && event.detail && event.detail.config;
    if (!isPlainObject(runtimeConfig)) return;
    if (isPlainObject(runtimeConfig.cart) && typeof runtimeConfig.cart.customTriggerSelector === "string" && runtimeConfig.cart.customTriggerSelector !== config.cart.customTriggerSelector) {
      config.cart.customTriggerSelector = runtimeConfig.cart.customTriggerSelector;
      CUSTOM_CART_TRIGGER_SELECTOR = getCustomCartTriggerSelector();
      COMBINED_CART_TRIGGER_SELECTOR = CUSTOM_CART_TRIGGER_SELECTOR ? CART_TRIGGER_SELECTOR + "," + CUSTOM_CART_TRIGGER_SELECTOR : CART_TRIGGER_SELECTOR;
      scheduleCartTriggerTakeover("runtime-config");
    }
    var intelligence = runtimeConfig.cart_intelligence_config || runtimeConfig.cartIntelligence;
    if (!isPlainObject(intelligence)) return;
    config.cartIntelligence = normalizeCartIntelligence(intelligence);
    render();
  });

  // ---- Coupon (in-drawer discount code) ----
  // The coupon input lives in the cart drawer only (it was previously carried by
  // the now-removed loopdesk-cart-drawer-embed block; ported here into the active
  // drawer asset). The code is applied to the Shopify cart via /cart/update.js,
  // so the express-checkout intent later picks it up from the cart snapshot — the
  // express modal shows the applied discount but no longer collects the code, so
  // there is a single place to enter it and the modal's price summary stays simple.
  function cartDiscountCode(cart) {
    var codes = cart && Array.isArray(cart.discount_codes) ? cart.discount_codes : [];
    for (var index = 0; index < codes.length; index += 1) {
      var code = typeof codes[index] === "string" ? codes[index] : codes[index] && codes[index].code;
      if (code) return String(code).trim().toUpperCase();
    }
    var applications = cart && Array.isArray(cart.cart_level_discount_applications) ? cart.cart_level_discount_applications : [];
    for (var appIndex = 0; appIndex < applications.length; appIndex += 1) {
      var application = applications[appIndex] || {};
      if (String(application.type || "").toLowerCase() === "discount_code" && (application.code || application.title)) {
        return String(application.code || application.title).trim().toUpperCase();
      }
    }
    return "";
  }

  function couponMarkup(cart) {
    var code = cartDiscountCode(cart);
    var savings = Math.max(0, Number(cart && cart.total_discount || 0));
    var transient = state.couponStatus && state.couponStatus.message ? state.couponStatus : null;
    var status = transient
      ? '<p class="loopdesk-cart-drawer__coupon-status" data-state="' + escapeHtml(transient.state || "") + '" aria-live="polite">' + escapeHtml(transient.message) + '</p>'
      : code
        ? '<p class="loopdesk-cart-drawer__coupon-status" data-state="success"><strong>' + escapeHtml(code) + ' applied</strong>' + (savings > 0 ? " · Total savings " + escapeHtml(money(savings, cart && cart.currency)) : "") + ' <button type="button" class="loopdesk-cart-drawer__coupon-remove" data-loopdesk-coupon-remove>Remove</button></p>'
        : '<p class="loopdesk-cart-drawer__coupon-status" aria-live="polite"></p>';
    return '<section class="loopdesk-cart-drawer__coupon" data-loopdesk-coupon><h3 class="loopdesk-cart-drawer__coupon-title">Have a coupon?</h3><form data-loopdesk-coupon-form><div class="loopdesk-cart-drawer__coupon-row"><input class="loopdesk-cart-drawer__coupon-input" name="code" type="text" autocomplete="off" placeholder="Enter coupon code" value="' + escapeHtml(code) + '"><button class="loopdesk-cart-drawer__coupon-button" type="submit"' + (state.couponBusy ? " disabled" : "") + ">Apply</button></div></form>" + status + "</section>";
  }

  function readCartFresh() {
    return fetch("/cart.js?_loopdesk_coupon=" + Date.now(), { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error("Unable to refresh cart"); return response.json(); });
  }

  function updateShopifyCartDiscount(code) {
    return fetch("/cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ discount: code })
    }).then(function (response) { if (!response.ok) throw new Error("Coupon could not be updated"); return response.json(); });
  }

  function applyCoupon(code) {
    if (state.couponBusy) return;
    var normalized = String(code || "").trim().toUpperCase();
    if (!normalized) { state.couponStatus = { message: "Enter a coupon code.", state: "error" }; render(); return; }
    state.couponBusy = true;
    state.couponStatus = { message: "Applying coupon…", state: "" };
    render();
    updateShopifyCartDiscount(normalized)
      .then(function () { return readCartFresh(); })
      .then(function (cart) {
        state.cart = cart;
        maybeRefreshPromotionsForCart(cart);
        var applied = cartDiscountCode(cart);
        if (!applied || applied !== normalized) throw new Error("This coupon is not valid for the current cart");
        state.couponStatus = { message: "", state: "" };
      })
      .catch(function (error) { state.couponStatus = { message: (error && error.message) || "Coupon could not be applied", state: "error" }; })
      .finally(function () { state.couponBusy = false; render(); });
  }

  function removeCoupon() {
    if (state.couponBusy) return;
    state.couponBusy = true;
    state.couponStatus = { message: "Removing coupon…", state: "" };
    render();
    updateShopifyCartDiscount("")
      .then(function () { return readCartFresh(); })
      .then(function (cart) { state.cart = cart; maybeRefreshPromotionsForCart(cart); state.couponStatus = { message: "", state: "" }; })
      .catch(function (error) { state.couponStatus = { message: (error && error.message) || "Coupon could not be removed", state: "error" }; })
      .finally(function () { state.couponBusy = false; render(); });
  }

 function render() {
  var cart = state.cart;
  var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;
  var hasItems = itemCount > 0;

  if (!elements.panel) return;
  elements.panel.setAttribute("aria-hidden", state.open ? "false" : "true");
  elements.overlay.hidden = !state.open;
  if (elements.root) elements.root.classList.toggle("loopdesk-cart-drawer--open", state.open);
  document.documentElement.classList.toggle("loopdesk-cart-drawer-is-open", state.open);
  if (document.body) document.body.classList.toggle("loopdesk-cart-drawer-is-open", state.open);

  var pricing = promotionPricing(cart);
  if (pricing && pricing.warnings && pricing.warnings.length) debugLog("pricing diagnostics", { warnings: pricing.warnings, totalSavings: pricing.totalSavings, finalPayable: pricing.finalPayableSubtotal, cartFingerprint: pricing.cartFingerprint });
  var slotContext = {
    cart: cart,
    pricing: pricing,
    cartIntelligence: config.cartIntelligence,
    promotions: config.promotions,
    state: state,
    money: money
  };

  elements.body.innerHTML = state.error
    ? '<div class="loopdesk-cart-drawer__error">We could not load your cart. You can still use the cart page.</div>'
    : renderCartGoalProgress(cart)
      + renderCartDrawerSlot("BEFORE_CART_LINES", slotContext)
      + renderLines(cart)
      + renderCartDrawerSlot("AFTER_CART_LINES", slotContext)
      + renderTierProgress(cart)
      + renderCartDrawerSlot("BEFORE_PROMOTIONS", slotContext)
      + renderOffers(cart)
      + renderCartDrawerSlot("AFTER_PROMOTIONS", slotContext)
      + renderCartDrawerSlot("BEFORE_COUPON", slotContext)
      + (hasItems ? couponMarkup(cart) : "")
      + '<span data-loopdesk-slot="AFTER_COUPON">'
      + renderCartDrawerSlot("AFTER_COUPON", slotContext)
      + '</span>';

  if (elements.merchandiseSubtotal) elements.merchandiseSubtotal.textContent = money(pricing ? pricing.merchandiseSubtotal : 0, cart && cart.currency);
  if (elements.savingsRow) elements.savingsRow.hidden = !(pricing && pricing.totalSavings > 0);
  if (elements.savings) elements.savings.textContent = pricing ? "-" + money(pricing.totalSavings, cart && cart.currency) : "";
  elements.subtotal.textContent = money(pricing ? pricing.finalPayableSubtotal : (cart ? cart.total_price : 0), cart && cart.currency);
  if (elements.prepaidNudge) {
    var prepaidSavings = prepaidOfferSavingsMinor(pricing ? pricing.merchandiseSubtotal : (cart ? cart.total_price : 0));
    var prepaidText = prepaidSavings > 0 ? prepaidOfferNudgeText(prepaidSavings, cart && cart.currency) : "";
    if (prepaidText) {
      elements.prepaidNudge.textContent = prepaidText;
      elements.prepaidNudge.hidden = false;
    } else {
      elements.prepaidNudge.textContent = "";
      elements.prepaidNudge.hidden = true;
    }
  }
  renderBoundSlot("BEFORE_TOTALS", slotContext);
  renderBoundSlot("AFTER_TOTALS", slotContext);
  renderBoundSlot("BEFORE_CHECKOUT", slotContext);
  renderBoundSlot("AFTER_CHECKOUT", slotContext);
  renderBoundSlot("BEFORE_FOOTER", slotContext);
  renderBoundSlot("AFTER_FOOTER", slotContext);

  elements.trustBelowTotals.innerHTML = renderTrustBadges("BELOW_TOTALS");
  elements.trustBelowCheckout.innerHTML = renderTrustBadges("BELOW_CHECKOUT_BUTTON");

  elements.count.textContent = itemCount ? "(" + itemCount + ")" : "";
  elements.express.hidden = !config.cart.expressCheckoutButtonEnabled;
  elements.express.disabled = !hasItems || state.loading || state.expressCheckoutLock;
  elements.express.setAttribute("aria-disabled", elements.express.disabled ? "true" : "false");
  elements.express.classList.toggle("is-loading", state.expressCheckoutLock);

  if (state.expressCheckoutLock) {
    elements.express.textContent = "Opening checkout...";
  } else if (!hasItems) {
    elements.express.textContent = "Add items to checkout";
  } else {
    elements.express.textContent = config.labels.expressCheckoutText;
  }

  elements.viewCart.hidden = !config.cart.viewCartButtonEnabled;
  if (elements.poweredBy) elements.poweredBy.hidden = config.branding.showPoweredBy === false;
}
  function setOpen(open) {
    state.hostMode = LOOPDESK_HOST_MODE;
    if (open) rememberBodyLockState();
    if (open && !state.open) { try { if (window.LoopDeskAnalytics) window.LoopDeskAnalytics.track("DRAWER_OPEN"); } catch (e) {} }
    state.open = open;
    render();
    if (open) {
      neutralizeThemeDrawers();
      scheduleNativeCartPanelCleanup();
    }
    if (!open) {
      restoreNeutralizedThemeDrawers();
      restoreLoopDeskBodyLock();
    }
    if (open) debugLog("drawer opened", { source: "loopdesk", mode: config.cart.drawerMode }, true);
  }

  function closeDrawerForCheckoutHandoff() {
    if (state.open) debugLog("LoopDesk drawer closed before checkout", {}, true);
    state.open = false;
    if (elements.panel) elements.panel.setAttribute("aria-hidden", "true");
    if (elements.overlay) {
      elements.overlay.hidden = true;
      elements.overlay.classList.remove("active", "is-active", "open");
    }
    restoreNeutralizedThemeDrawers();
    restoreLoopDeskBodyLock();
  }

  function fetchCart() {
    state.loading = true;
    state.error = "";
    render();
    return fetch("/cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Cart request failed");
        return response.json();
      })
      .then(function (cart) { state.cart = cart; maybeRefreshPromotionsForCart(cart); })
      .catch(function (error) {
        state.error = error && error.message ? error.message : "Cart request failed";
      })
      .finally(function () { state.loading = false; render(); });
  }

  function refreshAndMaybeOpen(open) {
    return fetchCart().then(function () { if (open) setOpen(true); });
  }

  function isDrawerAvailable() {
    return Boolean(config.enabled && elements.root && elements.panel);
  }

  function changeLine(index, quantity) {
    state.loading = true;
    render();
    return fetch("/cart/change.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ line: Number(index) + 1, quantity: Math.max(0, Number(quantity) || 0) })
    }).then(function (response) {
      if (!response.ok) throw new Error("Cart update failed");
      return response.json();
    }).then(function (cart) { state.cart = cart; state.error = ""; })
      .catch(function (error) { state.error = error && error.message ? error.message : "Cart update failed"; })
      .finally(function () { state.loading = false; render(); });
  }


  function addOfferToCart(ruleId) {
    var rules = eligiblePromotionRules(state.cart || {});
    var rule = rules.filter(function (candidate) { return candidate.ruleId === ruleId; })[0];
    var variant = rule && selectedVariantForRule(rule);
    if (!rule || !variant) return;
    state.loading = true;
    render();
    return fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: Number(variant.id), quantity: 1, properties: { _loopdesk_promotion_rule_id: rule.ruleId, _loopdesk_promotion_compilation_version: String(rule.compilation.version) } })
    }).then(function (response) {
      if (!response.ok) throw new Error('Offer add failed');
      return fetchCart();
    }).catch(function (error) {
      state.error = error && error.message ? error.message : 'Offer add failed';
    }).finally(function () { state.loading = false; render(); });
  }

  function handleDrawerAction(event) {
    var couponRemove = event.target && event.target.closest && event.target.closest("[data-loopdesk-coupon-remove]");
    if (couponRemove) { event.preventDefault(); return removeCoupon(); }
    var qtyButton = event.target && event.target.closest && event.target.closest("[data-loopdesk-qty]");
    var removeButton = event.target && event.target.closest && event.target.closest("[data-loopdesk-remove]");
    var select = event.target && event.target.closest && event.target.closest("[data-loopdesk-offer-variant]");
    var addOffer = event.target && event.target.closest && event.target.closest("[data-loopdesk-add-offer]");
    if (select) { state.selectedOfferVariants[select.getAttribute("data-loopdesk-offer-rule")] = select.value; if (event.type === "change") render(); return; }
    if (addOffer) { event.preventDefault(); return addOfferToCart(addOffer.getAttribute("data-loopdesk-offer-rule")); }
    var button = qtyButton || removeButton;
    if (!button || !state.cart || !state.cart.items) return;
    event.preventDefault();
    var index = Number(button.getAttribute("data-loopdesk-line"));
    var item = state.cart.items[index];
    if (!item) return;
    var nextQty = removeButton ? 0 : item.quantity + (button.getAttribute("data-loopdesk-qty") === "increase" ? 1 : -1);
    changeLine(index, nextQty);
  }

  function ownCartTriggerEvent(event, trigger, action) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (action === "pointerdown" || action === "touchstart" || action === "mousedown" || action === "keydown") {
      suppressNextCartClickUntil = Date.now() + 750;
      suppressedCartTrigger = trigger;
      debugLogOnce(action + "-suppressed", action + " suppressed", { trigger: getElementDescriptor(trigger) }, true);
    } else if (action === "click") {
      debugLogOnce("click-suppressed", "click suppressed", { trigger: getElementDescriptor(trigger) }, true);
    }
    openLoopDeskCartFromTrigger(trigger, action).then(function () {
      debugLogOnce("loopdesk-drawer-opened-from-trigger", "LoopDesk drawer opened", { trigger: getElementDescriptor(trigger), action: action }, true);
      scheduleNativeCartPanelCleanup();
    });
    return false;
  }

  function sameCartTrigger(left, right) {
    return Boolean(left === right || (left && left.contains && left.contains(right)) || (right && right.contains && right.contains(left)));
  }

  function isDuplicateCartTriggerEvent(event, trigger) {
    if (event.type === "keydown") return Boolean(event.repeat);
    return suppressNextCartClickUntil > Date.now() && sameCartTrigger(suppressedCartTrigger, trigger);
  }

  function clearDeferredCartOpen() {
    deferredCartOpenTimers.forEach(function (timer) { window.clearTimeout(timer); });
    deferredCartOpenTimers = [];
    deferredCartOpen = null;
  }

  function flushDeferredCartOpen() {
    if (!deferredCartOpen || !document.body) return false;
    var pending = deferredCartOpen;
    clearDeferredCartOpen();
    if (!isDrawerAvailable()) mount();
    if (!isDrawerAvailable()) return false;
    refreshAndMaybeOpen(true);
    debugLog("deferred cart open mounted", { trigger: getElementDescriptor(pending.trigger), action: pending.action }, true);
    return true;
  }

  function openLoopDeskCartFromTrigger(trigger, action) {
    if (isDrawerAvailable()) return refreshAndMaybeOpen(true);
    if (document.body) {
      mount();
      if (isDrawerAvailable()) return refreshAndMaybeOpen(true);
    }

    // Parsing can deliver an interaction before body/root mounting. Keep one
    // bounded request and retry only at lifecycle/short fixed checkpoints.
    deferredCartOpen = deferredCartOpen || { trigger: trigger, action: action };
    [0, 50, 150, 300].forEach(function (delay) {
      deferredCartOpenTimers.push(window.setTimeout(flushDeferredCartOpen, delay));
    });
    document.addEventListener("DOMContentLoaded", flushDeferredCartOpen, { once: true });
    debugLog("cart open deferred until mount", { trigger: getElementDescriptor(trigger), action: action }, true);
    return Promise.resolve();
  }

  function handleCartTriggerEvent(event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;

    var trigger = findCartTrigger(event.target);
    if (!trigger) return;

    var capability = getCapabilityResult();
    var active = isLoopDeskDrawerActive();
    debugLog("selected drawer mode", { mode: config.cart.drawerMode, active: active }, true);
    debugLog("capability result", capability, true);
    if (!active) {
      debugLog("fallback theme behavior allowed", { trigger: getElementDescriptor(trigger), reason: capability.reason || "theme-mode" }, true);
      return;
    }

    if (isDuplicateCartTriggerEvent(event, trigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      debugLogOnce(event.type + "-duplicate-suppressed", "open suppressed as duplicate", { eventType: event.type, trigger: getElementDescriptor(trigger), ownershipMode: state.cartOwnershipMode, rootMounted: Boolean(getLoopDeskRoot()) }, true);
      return false;
    }
    if (event.type === "click" || event.type === "pointerdown" || event.type === "mousedown" || event.type === "touchstart" || event.type === "keydown") {
      debugLog("cart trigger intercepted", { eventType: event.type, trigger: getElementDescriptor(trigger), ownershipMode: state.cartOwnershipMode, rootMounted: Boolean(getLoopDeskRoot()), takeoverAlreadyApplied: Boolean(getConnectedTakeoverRecord(trigger) || trigger.getAttribute && trigger.getAttribute("data-loopdesk-cart-trigger") === "true") }, true);
      return ownCartTriggerEvent(event, trigger, event.type);
    }
  }

  function shellHtml() {
    var logo = config.branding.logoUrl ? '<img class="loopdesk-cart-drawer__brand-logo" src="' + escapeHtml(config.branding.logoUrl) + '" alt="" loading="lazy">' : '';
    return [
      '<div class="loopdesk-cart-drawer__overlay" hidden></div>',
      '<aside class="loopdesk-cart-drawer" aria-hidden="true" aria-label="Cart" role="dialog">',
      '<header class="loopdesk-cart-drawer__header"><div class="loopdesk-cart-drawer__brand">' + logo + '<div><h2>' + escapeHtml(config.branding.merchantName || config.branding.storeName) + ' <span data-loopdesk-cart-count></span></h2><p>Your bag</p></div></div><button type="button" class="loopdesk-cart-drawer__close" aria-label="Close cart">×</button></header>',
      '<div class="loopdesk-cart-drawer__body"></div>',
      '<span data-loopdesk-slot="BEFORE_FOOTER"></span>',
      '<footer class="loopdesk-cart-drawer__footer"><span data-loopdesk-slot="BEFORE_TOTALS"></span><div class="loopdesk-cart-drawer__subtotal"><span>Merchandise subtotal</span><strong data-loopdesk-cart-merchandise-subtotal></strong></div><div class="loopdesk-cart-drawer__subtotal" data-loopdesk-cart-savings-row hidden><span>Total savings</span><strong data-loopdesk-cart-savings></strong></div><div class="loopdesk-cart-drawer__subtotal loopdesk-cart-drawer__payable"><span>You pay</span><strong data-loopdesk-cart-subtotal></strong></div><span data-loopdesk-slot="AFTER_TOTALS"></span><div data-loopdesk-trust-below-totals></div><span data-loopdesk-slot="BEFORE_CHECKOUT"></span><p class="loopdesk-cart-drawer__prepaid-nudge" data-loopdesk-prepaid-nudge hidden></p><button type="button" class="loopdesk-cart-drawer__express" data-loopdesk-express-checkout></button><span data-loopdesk-slot="AFTER_CHECKOUT"></span><div data-loopdesk-trust-below-checkout></div><a class="loopdesk-cart-drawer__view-cart" href="/cart"></a><p class="loopdesk-cart-drawer__microcopy"></p><p class="loopdesk-cart-drawer__powered"></p></footer>',
      '<span data-loopdesk-slot="AFTER_FOOTER"></span>',
      '</aside>',
    ].join("");
  }

  function renderBoundSlot(slot, context) {
    var host = elements.root && elements.root.querySelector('[data-loopdesk-slot="' + slot + '"]');
    if (host) host.innerHTML = renderCartDrawerSlot(slot, context);
  }

  function applyCssVariables(target) {
    var root = target || document.documentElement;
    if (!root || !root.style) return;
    root.style.setProperty("--loopdesk-primary", config.branding.primaryColor);
    root.style.setProperty("--loopdesk-secondary", config.branding.secondaryColor);
    root.style.setProperty("--loopdesk-accent", config.branding.accentColor);
    root.style.setProperty("--loopdesk-text", config.branding.textColor);
    root.style.setProperty("--loopdesk-surface", config.branding.surfaceColor);
    root.style.setProperty("--loopdesk-radius", config.branding.borderRadius);
    root.style.setProperty("--loopdesk-font", config.branding.fontFamily);
    root.style.setProperty("--ld-primary", config.branding.primaryColor);
    configDiagnostics("CSS variables applied", {}, true);
  }

  function bindElements(hostRoot) {
    elements = {
      root: getLoopDeskRoot(),
      overlay: hostRoot.querySelector(".loopdesk-cart-drawer__overlay"),
      panel: hostRoot.querySelector(".loopdesk-cart-drawer"),
      body: hostRoot.querySelector(".loopdesk-cart-drawer__body"),
      close: hostRoot.querySelector(".loopdesk-cart-drawer__close"),
      subtotal: hostRoot.querySelector("[data-loopdesk-cart-subtotal]"),
      merchandiseSubtotal: hostRoot.querySelector("[data-loopdesk-cart-merchandise-subtotal]"),
      savingsRow: hostRoot.querySelector("[data-loopdesk-cart-savings-row]"),
      savings: hostRoot.querySelector("[data-loopdesk-cart-savings]"),
      trustBelowTotals: hostRoot.querySelector("[data-loopdesk-trust-below-totals]"),
      trustBelowCheckout: hostRoot.querySelector("[data-loopdesk-trust-below-checkout]"),
      count: hostRoot.querySelector("[data-loopdesk-cart-count]"),
      express: hostRoot.querySelector(".loopdesk-cart-drawer__express"),
      prepaidNudge: hostRoot.querySelector("[data-loopdesk-prepaid-nudge]"),
      viewCart: hostRoot.querySelector(".loopdesk-cart-drawer__view-cart"),
      poweredBy: hostRoot.querySelector(".loopdesk-cart-drawer__powered"),
    };

    if (elements.close) elements.close.addEventListener("click", function () { setOpen(false); });
    if (elements.overlay) elements.overlay.addEventListener("click", function () { setOpen(false); });
    hostRoot.addEventListener("click", function (event) {
      var button = event.target && event.target.closest && event.target.closest("[data-loopdesk-cart-banner-dismiss]");
      if (!button || !hostRoot.contains(button)) return;
      dismissBanner(button.getAttribute("data-loopdesk-cart-banner-dismiss"));
      render();
    });
    if (elements.express) {
      elements.express.textContent = config.labels.expressCheckoutText;
      elements.express.addEventListener("click", function (event) { interceptCheckout(event, "loopdesk-cart-drawer"); });
    }
    if (elements.viewCart) elements.viewCart.textContent = config.labels.viewCartText;
    if (elements.poweredBy) elements.poweredBy.textContent = config.branding.poweredByText;
    var microcopy = hostRoot.querySelector(".loopdesk-cart-drawer__microcopy");
    if (microcopy) microcopy.textContent = config.labels.secureCheckoutText + " • UPI, cards, net banking & COD";
    if (elements.body) {
      elements.body.addEventListener("click", handleDrawerAction);
      elements.body.addEventListener("change", handleDrawerAction);
      elements.body.addEventListener("submit", function (event) {
        var form = event.target && event.target.closest && event.target.closest("[data-loopdesk-coupon-form]");
        if (!form) return;
        event.preventDefault();
        applyCoupon(String(new FormData(form).get("code") || "").trim());
      });
    }
    applyCssVariables(elements.root || document.documentElement);
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = shellHtml();
    document.body.appendChild(root);
    bindElements(root);
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") setOpen(false); });
    document.addEventListener("loopdesk:cart-drawer:open", function () { refreshAndMaybeOpen(true); });
    debugLog("selected drawer mode", { mode: config.cart.drawerMode, active: isLoopDeskDrawerActive() }, true);
    debugLog("capability result", getCapabilityResult(), true);
    refreshPromotionRuntime("init").then(function (applied) { if (!applied && !hasPromotionRules()) schedulePromotionRuntimeRefresh("init-delayed", 750); });
    refreshAndMaybeOpen(consumeCartAddReopenIntent());
    applyCartTriggerTakeover();
    observeCartTriggerTakeoverTargets();
  }

  function acquireHost() {
    state.themeDrawer = detectThemeDrawer();
    state.hostMode = LOOPDESK_HOST_MODE;
    return state.themeDrawer;
  }

  function clearLocalCartDrawerErrors() {
    if (elements && elements.body && state.error) {
      state.error = "";
      render();
    }
    document.querySelectorAll("#" + ROOT_ID + " [data-megaska-checkout-guard-error]").forEach(function (element) {
      element.remove();
    });
  }

  function openLoopDeskExpressCheckout(source) {
    var readiness = window.LoopDeskConfig && window.LoopDeskConfig.express_checkout;
    if (!readiness || readiness.enabled !== true || readiness.ready !== true || readiness.provider !== "razorpay") {
      debugLog("Shopify checkout fallback", { source: source || "checkout-intent", reason: readiness && readiness.ready === false ? "not-ready" : "config-unavailable" }, true);
      window.location.assign("/checkout");
      return;
    }
    if (state.expressCheckoutLock) return;
    state.expressCheckoutLock = true;
    render();
    var checkoutSource = source || "checkout-intent";
    var releaseLock = function () {
      state.expressCheckoutLock = false;
      render();
    };
    clearLocalCartDrawerErrors();
    closeDrawerForCheckoutHandoff();
    debugLog("OTP/checkout handoff started", { source: checkoutSource }, true);
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") {
      debugLog("Express modal API present", { source: checkoutSource });
      window.setTimeout(function () {
        try {
          window.MegaskaExpressCheckout.open({ source: checkoutSource });
        } finally {
          window.setTimeout(releaseLock, 900);
        }
      }, 32);
    } else {
      debugLog("Express modal API missing", { source: checkoutSource });
      window.setTimeout(releaseLock, 900);
      window.location.href = "/apps/loopd2c/checkout";
    }
  }

  function openExpressCheckout(source) {
    openLoopDeskExpressCheckout(source || "checkout-intent");
  }

  function interceptCheckout(event, source) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    if (!state.cart || Number(state.cart.item_count || 0) <= 0 || state.loading) {
      return;
    }
    debugLog("checkout click intercepted with reason", { source: source || "cart-drawer" });
    openExpressCheckout(source);
  }

  var CHECKOUT_INTENT_SELECTOR = [
    'a[href="/checkout"]',
    'a[href^="/checkout"]',
    'a[href*="/checkout"]',
    'button[name="checkout"]',
    'input[name="checkout"]',
    'button[type="submit"][name="checkout"]',
    'input[type="submit"][name="checkout"]',
    '.cart__checkout-button',
    '.checkout-button',
    '[class*="checkout" i]',
    '[id*="checkout" i]',
    '[data-checkout]',
    '[data-testid*="checkout" i]',
    '[aria-label*="checkout" i]'
  ].join(',');

  var CHECKOUT_SUBMIT_SELECTOR = [
    'button[name="checkout"]',
    'input[name="checkout"]',
    'button[type="submit"][name="checkout"]',
    'input[type="submit"][name="checkout"]',
    'button[type="submit"]',
    'input[type="submit"]',
    '.cart__checkout-button',
    '.checkout-button',
    '[class*="checkout" i]',
    '[id*="checkout" i]',
    '[data-checkout]',
    '[data-testid*="checkout" i]',
    '[aria-label*="checkout" i]'
  ].join(',');

  var LOOPDESK_CHECKOUT_CTA_SELECTOR = '[data-loopdesk-checkout-cta="true"]';
  var HIDDEN_NATIVE_CHECKOUT_ATTRIBUTE = 'data-loopdesk-native-checkout-hidden';
  var CHECKOUT_SCAN_DEBOUNCE_MS = 160;
  var checkoutScanTimer = null;
  var checkoutObserver = null;

  var CART_CONTEXT_SELECTOR = [
    'body.template-cart',
    'body.cart',
    'main[data-cart-page]',
    '[data-cart-page]',
    'form[action="/cart"]',
    'form[action^="/cart"]',
    'form[action*="/cart"]',
    '[data-cart-drawer]',
    '[data-drawer="cart"]',
    '[data-section-type="cart-drawer"]',
    '[data-section-id*="cart" i]',
    'cart-drawer',
    'cart-items',
    'cart-notification',
    'mini-cart',
    '#CartDrawer',
    '#cart-drawer',
    '.cart-drawer',
    '#mini-cart',
    '.mini-cart',
    '.ajax-cart',
    '#ajax-cart-container',
    '#cart-sidebar',
    '.cart-sidebar',
    '.side-cart',
    '.drawer--cart',
    '.cart',
    '.cart-page',
    '.cart-section',
    '.cart__contents',
    '.cart__footer',
    '.cart__blocks',
    '.cart-items',
    '.cart-form',
    '#' + ROOT_ID
  ].join(',');

  var lastCheckoutSubmitter = null;

  function isUnsafeCheckoutInjectionArea(element) {
    if (!element || !element.closest) return true;
    if (window.location && /^\/(?:checkout|account)(?:\/|$)/.test(window.location.pathname || '')) return true;
    return Boolean(closestSelector(element, [
      '#' + ROOT_ID,
      'form[action*="/cart/add"]',
      'product-form',
      '[data-product-form]',
      '[class*="product-form" i]',
      '[id*="product-form" i]',
      '[role="search"]',
      '[type="search"]',
      '[class*="search" i]',
      '[id*="search" i]',
      '[aria-label*="search" i]',
      '[aria-haspopup="menu"]',
      '[aria-controls*="menu" i]',
      'nav',
      '[role="navigation"]',
      '[class*="account" i]',
      '[id*="account" i]'
    ].join(',')));
  }

  function getCheckoutCtaInsertParent(control) {
    if (!control || !control.parentNode) return null;
    var parent = control.parentNode;
    if (parent.nodeType !== 1) return null;
    return parent;
  }

  function hasInjectedCheckoutCtaNear(control) {
    var parent = getCheckoutCtaInsertParent(control);
    if (!parent) return false;
    if (control.nextElementSibling && matchesSelector(control.nextElementSibling, LOOPDESK_CHECKOUT_CTA_SELECTOR)) return true;
    if (control.previousElementSibling && matchesSelector(control.previousElementSibling, LOOPDESK_CHECKOUT_CTA_SELECTOR)) return true;
    return Boolean(parent.querySelector(LOOPDESK_CHECKOUT_CTA_SELECTOR));
  }

  function preserveNativeCheckoutState(control) {
    if (!control || control.hasAttribute(HIDDEN_NATIVE_CHECKOUT_ATTRIBUTE)) return;
    control.setAttribute(HIDDEN_NATIVE_CHECKOUT_ATTRIBUTE, 'true');
    control.setAttribute('data-loopdesk-original-display', control.style.display || '');
    control.setAttribute('data-loopdesk-original-visibility', control.style.visibility || '');
    control.setAttribute('data-loopdesk-original-aria-hidden', control.getAttribute('aria-hidden') || '');
  }

  function hideNativeCheckoutControl(control) {
    if (control.hasAttribute(HIDDEN_NATIVE_CHECKOUT_ATTRIBUTE) && control.style.display === 'none' && control.style.visibility === 'hidden') return;
    preserveNativeCheckoutState(control);
    control.style.display = 'none';
    control.style.visibility = 'hidden';
    control.setAttribute('aria-hidden', 'true');
  }

  function createLoopDeskCheckoutCta() {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'loopdesk-checkout-cta';
    button.setAttribute('data-loopdesk-checkout-cta', 'true');
    button.innerHTML = [
      '<span class="loopdesk-checkout-cta__label">' + escapeHtml(config.labels.expressCheckoutText) + '</span>',
      '<span class="loopdesk-checkout-cta__subtext">UPI • Cards • Net Banking • COD</span>',
      '<span class="loopdesk-checkout-cta__trust">Secure checkout powered by LoopD2C</span>'
    ].join('');
    button.addEventListener('click', function (event) {
      interceptCheckout(event, 'drawer');
    });
    return button;
  }

  function shouldInjectCheckoutCta(control) {
    if (!control || !control.closest || matchesSelector(control, LOOPDESK_CHECKOUT_CTA_SELECTOR)) return false;
    if (isUnsafeCheckoutInjectionArea(control)) return false;
    if (isCheckoutExcludedControl(control)) return false;
    if (!getCartContext(control)) return false;
    return true;
  }

  function injectCheckoutCtaForControl(control) {
    if (!shouldInjectCheckoutCta(control)) return false;
    if (hasInjectedCheckoutCtaNear(control)) {
      debugLog('duplicate skipped', { element: getElementDescriptor(control) });
      hideNativeCheckoutControl(control);
      return false;
    }

    var parent = getCheckoutCtaInsertParent(control);
    if (!parent) return false;
    hideNativeCheckoutControl(control);
    parent.insertBefore(createLoopDeskCheckoutCta(), control.nextSibling);
    debugLog('CTA injected', { element: getElementDescriptor(control) });
    return true;
  }

  function scanForCheckoutCtas() {
    var controls = Array.prototype.slice.call(document.querySelectorAll(CHECKOUT_INTENT_SELECTOR))
      .filter(function (control, index, list) {
        return control && list.indexOf(control) === index && shouldInjectCheckoutCta(control);
      });
    if (controls.length) debugLog('native checkout controls found', { count: controls.length });
    controls.forEach(injectCheckoutCtaForControl);
  }

  function scheduleCheckoutCtaScan() {
    if (checkoutScanTimer) window.clearTimeout(checkoutScanTimer);
    checkoutScanTimer = window.setTimeout(function () {
      checkoutScanTimer = null;
      scanForCheckoutCtas();
    }, CHECKOUT_SCAN_DEBOUNCE_MS);
  }

  function observeCheckoutCtaTargets() {
    if (!window.MutationObserver || checkoutObserver) return;
    checkoutObserver = new MutationObserver(function (mutations) {
      var shouldScan = mutations.some(function (mutation) {
        if (!mutation.target || isInsideLoopDeskDrawer(mutation.target)) return false;
        return mutation.type === 'childList' || mutation.type === 'attributes';
      });
      if (shouldScan) scheduleCheckoutCtaScan();
    });
    checkoutObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'open', 'aria-hidden', 'style']
    });
  }

  function getElementDescriptor(element) {
    if (!element) return {};
    return {
      tag: element.tagName ? element.tagName.toLowerCase() : '',
      id: element.id || '',
      className: typeof element.className === 'string' ? element.className : '',
      text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  }

  function getCheckoutText(element) {
    return (element && (element.innerText || element.textContent || '') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function matchesSelector(element, selector) {
    try { return Boolean(element && element.matches && element.matches(selector)); } catch { return false; }
  }

  function closestSelector(element, selector) {
    try { return element && element.closest ? element.closest(selector) : null; } catch { return null; }
  }

  function hasSameOriginPath(value, pathPrefix) {
    if (!value) return false;
    try {
      var url = new URL(value, window.location.origin);
      return url.origin === window.location.origin && url.pathname.indexOf(pathPrefix) === 0;
    } catch {
      return String(value).indexOf(pathPrefix) === 0;
    }
  }

  function getCartContext(element) {
    if (isInsideLoopDeskDrawer(element)) return { sourcePage: 'theme-drawer', element: getLoopDeskRoot() };
    if (window.location && window.location.pathname === '/cart') return { sourcePage: 'cart-page', element: document.body };

    var context = closestSelector(element, CART_CONTEXT_SELECTOR);
    if (!context) return null;

    var sourcePage = 'unknown-cart-context';
    if (matchesSelector(context, 'body.template-cart, body.cart, main[data-cart-page], [data-cart-page], .cart-page')) sourcePage = 'cart-page';
    else if (matchesSelector(context, THEME_CART_DRAWER_SELECTORS.join(',')) || matchesSelector(context, '.mini-cart, mini-cart, .side-cart, #' + ROOT_ID)) sourcePage = 'theme-drawer';
    return { sourcePage: sourcePage, element: context };
  }

  function isCheckoutExcludedControl(element) {
    if (!element || !element.closest) return true;
    return Boolean(closestSelector(element, [
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
      '[role="search"] button',
      '[class*="search" i]',
      '[id*="search" i]',
      '[aria-label*="search" i]',
      '[aria-haspopup="menu"]',
      '[aria-controls*="menu" i]'
    ].join(',')) || /\b(add to cart|add-to-cart|quantity|qty|increase|decrease|remove|discount|coupon|promo|search|menu)\b/i.test(elementText(element)));
  }

  function findCheckoutIntentControl(target) {
    if (!target || !target.closest) return null;
    var control = closestSelector(target, CHECKOUT_INTENT_SELECTOR);
    if (control) return { control: control, reason: 'selector:' + CHECKOUT_INTENT_SELECTOR };

    control = closestSelector(target, 'a, button, input[type="button"], input[type="submit"], [role="button"]');
    if (!control) return null;
    var text = getCheckoutText(control);
    if (/^(checkout|check out|proceed to checkout|continue to checkout|secure checkout)$/.test(text)) {
      return { control: control, reason: 'visible-text:' + text };
    }
    if (text === 'place order') return { control: control, reason: 'visible-text:place order' };
    return null;
  }

  function logCheckoutIntent(reason, control, context, modalApiExists) {
    debugLog('checkout intent intercepted', {
      reason: reason,
      element: getElementDescriptor(control),
      sourcePage: context ? context.sourcePage : 'unknown-cart-context',
      modalApiExists: modalApiExists
    });
  }

  function openExpressCheckoutFromIntent(reason, control, context) {
    var modalApiExists = Boolean(window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === 'function');
    logCheckoutIntent(reason, control, context, modalApiExists);
    openExpressCheckout('checkout-intercept-fallback');
  }

  function interceptCheckoutIntentEvent(event, reason, control, context) {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    openExpressCheckoutFromIntent(reason, control, context);
  }

  function isCartCheckoutForm(form) {
    if (!form || form.nodeName !== 'FORM') return false;
    var action = form.getAttribute('action') || '';
    return hasSameOriginPath(action, '/cart') || hasSameOriginPath(action, '/checkout');
  }

  function listenForCheckoutIntent() {
    document.addEventListener('click', function (event) {
      var match = findCheckoutIntentControl(event.target);
      if (match && matchesSelector(match.control, LOOPDESK_CHECKOUT_CTA_SELECTOR)) return;
      if (!match || isCheckoutExcludedControl(match.control)) return;
      var context = getCartContext(match.control);
      if (!context) return;

      if (matchesSelector(match.control, CHECKOUT_SUBMIT_SELECTOR)) lastCheckoutSubmitter = match.control;
      interceptCheckoutIntentEvent(event, match.reason, match.control, context);
    }, true);

    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!isCartCheckoutForm(form)) return;
      var submitter = event.submitter || (lastCheckoutSubmitter && form.contains(lastCheckoutSubmitter) ? lastCheckoutSubmitter : null);
      var submitterMatch = submitter ? findCheckoutIntentControl(submitter) : null;
      var formActionIsCheckout = hasSameOriginPath(form.getAttribute('action') || '', '/checkout');
      var submitterActionIsCheckout = submitter && hasSameOriginPath(submitter.getAttribute && submitter.getAttribute('formaction') || '', '/checkout');
      var context = getCartContext(form) || getCartContext(submitter);

      if (!context && !formActionIsCheckout && !submitterActionIsCheckout) return;
      if (!formActionIsCheckout && !submitterActionIsCheckout && (!submitterMatch || isCheckoutExcludedControl(submitterMatch.control))) return;

      debugLog('submit intercepted with reason', { reason: submitterActionIsCheckout ? 'submitter-formaction:checkout' : formActionIsCheckout ? 'form-action:checkout' : submitterMatch.reason });
      interceptCheckoutIntentEvent(event, submitterActionIsCheckout ? 'submitter-formaction:checkout' : submitterMatch ? submitterMatch.reason : 'form-action:checkout', submitter || form, context || { sourcePage: 'checkout-form' });
    }, true);
  }

  function patchFormSubmission() {
    if (!window.HTMLFormElement || window.HTMLFormElement.prototype[FORM_MARKER]) return;
    var proto = window.HTMLFormElement.prototype;
    var originalSubmit = proto.submit;
    var originalRequestSubmit = proto.requestSubmit;

    function shouldInterceptProgrammaticSubmit(form, submitter) {
      if (!form || form.nodeName !== 'FORM') return false;
      var formActionIsCheckout = hasSameOriginPath(form.getAttribute('action') || '', '/checkout');
      var submitterActionIsCheckout = submitter && hasSameOriginPath(submitter.getAttribute && submitter.getAttribute('formaction') || '', '/checkout');
      if (formActionIsCheckout || submitterActionIsCheckout) return true;
      if (!isCartCheckoutForm(form)) return false;
      var submitterMatch = submitter ? findCheckoutIntentControl(submitter) : null;
      if (submitterMatch && !isCheckoutExcludedControl(submitterMatch.control)) return true;
      return Boolean(lastCheckoutSubmitter && form.contains(lastCheckoutSubmitter) && findCheckoutIntentControl(lastCheckoutSubmitter));
    }

    proto.submit = function () {
      if (shouldInterceptProgrammaticSubmit(this, null)) {
        debugLog('programmatic submit intercepted', { method: 'submit' });
        openLoopDeskExpressCheckout('programmatic-form-submit');
        return;
      }
      return originalSubmit.apply(this, arguments);
    };

    if (originalRequestSubmit) {
      proto.requestSubmit = function (submitter) {
        if (shouldInterceptProgrammaticSubmit(this, submitter)) {
          debugLog('programmatic submit intercepted', { method: 'requestSubmit' });
          openLoopDeskExpressCheckout('programmatic-request-submit');
          return;
        }
        return originalRequestSubmit.apply(this, arguments);
      };
    }

    proto[FORM_MARKER] = true;
  }

  function patchLocationNavigation() {
    if (!window.location || window.location[LOCATION_MARKER]) return;
    ['assign', 'replace'].forEach(function (method) {
      try {
        var original = window.location[method];
        if (typeof original !== 'function') return;
        window.location[method] = function (target) {
          var url = getSameOriginUrl(target);
          if (url && url.pathname === '/checkout') {
            debugLog('navigation assign/replace intercepted', { method: method, target: String(target) });
            openLoopDeskExpressCheckout('navigation-' + method);
            return;
          }
          if (url && hasCartPath(url.pathname) && isLoopDeskDrawerActive()) {
            debugLog('cart page navigation intercepted', { method: method, target: String(target) });
            refreshAndMaybeOpen(true);
            return;
          }
          return original.apply(window.location, arguments);
        };
      } catch (_error) {}
    });
    try { window.location[LOCATION_MARKER] = true; } catch (_error) {}
  }

  function patchXMLHttpRequest() {
    if (!window.XMLHttpRequest || window.XMLHttpRequest.prototype[XHR_MARKER]) return;
    var proto = window.XMLHttpRequest.prototype;
    var originalOpen = proto.open;
    var originalSend = proto.send;

    proto.open = function (method, url) {
      this.__loopdeskCartRequestUrl = url;
      this.__loopdeskCartRequestMethod = method;
      return originalOpen.apply(this, arguments);
    };

    proto.send = function () {
      var isAdd = isCartAddUrl(this.__loopdeskCartRequestUrl);
      var isMutation = isCartMutationUrl(this.__loopdeskCartRequestUrl);
      if (isMutation) {
        this.addEventListener('load', function () {
          if (this.status >= 200 && this.status < 300) {
            window.setTimeout(function () { refreshAfterCartMutation(isAdd); }, 0);
          }
        });
      }
      return originalSend.apply(this, arguments);
    };

    proto[XHR_MARKER] = true;
    debugLog('XHR patch installed');
  }

  function patchFetch() {
    if (!window.fetch || window.fetch[FETCH_MARKER]) return;
    var originalFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var cartAdd = isCartAddUrl(args[0]);
      var cartMutation = isCartMutationUrl(args[0]);
      return originalFetch.apply(this, args).then(function (response) {
        if (cartMutation && response && response.ok) {
          window.setTimeout(function () { refreshAfterCartMutation(cartAdd); }, 0);
        }
        return response;
      });
    };
    window.fetch[FETCH_MARKER] = true;
    debugLog('fetch patch installed');
  }

  var CART_CUSTOM_EVENTS = [
    'cart:open',
    'cart:toggle',
    'theme:cart:open',
    'cart-drawer:open',
    'cart-drawer:toggle',
    'mini-cart:open',
    'mini-cart:toggle',
    'open-cart',
    'CartDrawer:open',
    'cartOpen',
    'ajaxCart:open',
    'drawer:open'
  ];

  function listenForCartCustomEvents() {
    CART_CUSTOM_EVENTS.forEach(function (eventName) {
      document.addEventListener(eventName, function (event) {
        debugLog('custom cart event observed', { eventName: eventName, detail: event.detail });
        window.setTimeout(function () { refreshAndMaybeOpen(false); }, 0);
        if (!isAppOwnedCartMode()) { debugLog("fallback theme behavior allowed", { eventName: eventName, reason: "inactive-drawer-mode" }, true); return; }
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        refreshAndMaybeOpen(true);
      }, true);
    });
  }


  function computedVisibility(element) {
    var style = element && window.getComputedStyle ? window.getComputedStyle(element) : null;
    return {
      display: style ? style.display : "",
      visibility: style ? style.visibility : "",
      opacity: style ? style.opacity : "",
      transform: style ? style.transform : "",
      zIndex: style ? style.zIndex : ""
    };
  }

  function debugState() {
    var root = getLoopDeskRoot();
    var panel = root ? root.querySelector(".loopdesk-cart-drawer") : null;
    var overlay = root ? root.querySelector(".loopdesk-cart-drawer__overlay") : null;
    return {
      hasRoot: Boolean(root),
      hasPanel: Boolean(panel),
      hasOverlay: Boolean(overlay),
      rootClass: root ? root.className : "",
      panelClass: panel ? panel.className : "",
      bodyClass: document.body ? document.body.className : "",
      ariaHidden: panel ? panel.getAttribute("aria-hidden") : null,
      computed: {
        root: computedVisibility(root),
        panel: computedVisibility(panel),
        overlay: computedVisibility(overlay)
      },
      drawerMode: config.cart.drawerMode,
      ownershipMode: state.cartOwnershipMode || config.cartOwnershipMode || (state.drawerModeActive ? "loopdesk" : "fallback")
    };
  }

  function listenForCartLinks() {
    ["pointerdown", "mousedown", "touchstart", "click", "keydown"].forEach(function (eventName) {
      document.addEventListener(eventName, handleCartTriggerEvent, true);
    });
  }

  function listenForForms() {
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form || form.nodeName !== "FORM") return;
      var action = form.getAttribute("action");
      if (!action || !isCartAddUrl(action)) return;
      if (!config.cart.openAfterAddToCart) return;
      window.setTimeout(function () { refreshAfterCartMutation(true); }, 900);
    }, true);
  }

  window.LoopDeskCartController = {
    open: function () {
      if (!isDrawerAvailable() && document.body) mount();
      return refreshAndMaybeOpen(true);
    },
    close: function () { setOpen(false); },
    render: render,
    refresh: function () { return refreshAndMaybeOpen(false); },
    acquireHost: acquireHost,
    getState: function () { return Object.assign({}, state); },
    debugState: debugState,
  };

  if (bounceBackFromUnwantedCartPageNavigation()) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  patchFetch();
  patchXMLHttpRequest();
  patchFormSubmission();
  patchLocationNavigation();
  listenForForms();
  listenForCartLinks();
  listenForCartCustomEvents();
  listenForCheckoutIntent();
  listenForCartAddFormSubmissions();
  scheduleCheckoutCtaScan();
  observeCheckoutCtaTargets();
  // Delegation is authoritative; this synchronous compatibility takeover only
  // replaces triggers that are already present and owned by LoopDesk.
  applyCartTriggerTakeover();
  observeCartTriggerTakeoverTargets();
})();
