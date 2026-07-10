(function () {
  var DEFAULT_CONFIG = {
    branding: {
      merchantName: "LoopDesk",
      storeName: "LoopDesk",
      logoUrl: null,
      primaryColor: "#111827",
      secondaryColor: "#374151",
      accentColor: "#2563eb",
      textColor: "#111827",
      surfaceColor: "#ffffff",
      borderRadius: "16px",
      fontFamily: "inherit",
      showPoweredBy: true,
      poweredByText: "Powered by LoopDesk"
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
      nativeDrawerDisabledRequiredMessage: "To use LoopDesk Enhanced Drawer, set your theme cart type to Page in Shopify theme settings."
    },
    checkout: {
      showSecureBadge: true,
      showTrustCopy: true
    },
    enabled: true,
    cartOwnershipMode: "fallback"
  };
  var config = normalizeConfig(window.LoopDeskConfig || window.LOOPDESK_CART_DRAWER_CONFIG || window.LoopDeskCartDrawerConfig || {});
  if (window.console) {
    window.console.info("[LoopDesk Runtime] promotion_rules_config before merge", {
      source: window.LoopDeskConfig && window.LoopDeskConfig.promotion_rules_config,
      legacy: window.LOOPDESK_CART_DRAWER_CONFIG && window.LOOPDESK_CART_DRAWER_CONFIG.promotion_rules_config
    });
    window.console.info("[LoopDesk Runtime] promotion_rules_config after merge", config.promotion_rules_config);
    window.console.info("[LoopDesk Runtime] assigning window.LoopDeskConfig", config);
  }
  window.LoopDeskConfig = config;
  window.LOOPDESK_CART_DRAWER_CONFIG = Object.assign({}, window.LOOPDESK_CART_DRAWER_CONFIG || {}, {
    enabled: config.enabled,
    drawerMode: config.cart.drawerMode,
    openAfterAddToCart: config.cart.openAfterAddToCart,
    expressCheckoutButtonEnabled: config.cart.expressCheckoutButtonEnabled,
    viewCartButtonEnabled: config.cart.viewCartButtonEnabled,
    primaryColor: config.branding.primaryColor,
    checkoutButtonText: config.labels.expressCheckoutText,
    buttonText: config.labels.expressCheckoutText,
    showPoweredBy: config.branding.showPoweredBy,
    promotion_rules_config: config.promotion_rules_config,
    promotionRules: config.promotion_rules_config
  });
  if (window.console) {
    window.console.info("[LoopDesk Runtime] legacy drawer config projection", window.LOOPDESK_CART_DRAWER_CONFIG);
  }
  var ROOT_ID = "loopdesk-cart-drawer-root";
  var FETCH_MARKER = "__loopdeskCartDrawerPatched";
  var XHR_MARKER = "__loopdeskCartDrawerXhrPatched";
  var FORM_MARKER = "__loopdeskCartDrawerFormPatched";
  var LOCATION_MARKER = "__loopdeskCartDrawerLocationPatched";
  var LOOPDESK_HOST_MODE = "NO_THEME_DRAWER";

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
    '[aria-controls*="cart" i]',
    '[id*="cart-icon" i]',
    '[class*="cart-icon" i]',
    '[class*="header__icon--cart" i]',
    '[data-cart]',
    '[data-cart-drawer]',
    '[data-action*="cart" i]',
    'summary',
    'button'
  ].join(',');

  if (!config.enabled || window.__LOOPDESK_CART_DRAWER_LOADED__) return;
  window.__LOOPDESK_CART_DRAWER_LOADED__ = true;

  var state = { open: false, loading: false, cart: null, error: "", offerError: "", offerAdding: false, hostMode: LOOPDESK_HOST_MODE, themeDrawer: null, fallbackReason: "", expressCheckoutLock: false, capability: null, drawerModeActive: false, neutralizedThemeDrawers: [], bodyLockSnapshot: null, removedThemeBodyClasses: [], cartTriggerTakeovers: [] };
  var cartTriggerObserver = null;
  var cartTriggerTakeoverTimer = null;
  var suppressNextCartClickUntil = 0;
  var suppressedCartTrigger = null;
  var diagnosticActions = {};
  var elements = {};

  function money(cents, currency) {
    var amount = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || (state.cart && state.cart.currency) || "INR",
      }).format(amount);
    } catch (_error) {
      return amount.toFixed(2);
    }
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


  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

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


  function normalizePromotionConfig(rawConfig) {
    var raw = isPlainObject(rawConfig) ? rawConfig : {};
    return {
      enabled: bool(raw.enabled, false),
      maxVisibleOffers: Math.max(1, Math.min(20, Number(raw.maxVisibleOffers) || 1)),
      conflictStrategy: raw.conflictStrategy === "priority_first" ? "priority_first" : "priority_first",
      rules: Array.isArray(raw.rules) ? raw.rules : []
    };
  }

  function getRuntimeConfigUrl() {
    var shopDomain = (window.LoopDeskConfig && window.LoopDeskConfig.shopDomain) || (window.LOOPDESK_CART_DRAWER_CONFIG && window.LOOPDESK_CART_DRAWER_CONFIG.shopDomain) || window.MEGASKA_SHOP_DOMAIN || (window.Shopify && window.Shopify.shop) || "";
    if (!shopDomain) return null;
    return "/apps/megaska/api/runtime/config?shop=" + encodeURIComponent(shopDomain);
  }

  function mergeFetchedRuntimeConfig(payload) {
    if (!payload || payload.ok !== true || !isPlainObject(payload.config)) return;
    if (window.console) {
      window.console.info("[LoopDesk Runtime] fetched config", payload);
      window.console.info("[LoopDesk Runtime] promotion_rules_config before merge", {
        current: config && config.promotion_rules_config,
        fetched: payload.config.promotion_rules_config
      });
    }
    config = normalizeConfig(Object.assign({}, config || {}, payload.config, {
      branding: Object.assign({}, (config && config.branding) || {}, payload.config.branding || {}),
      labels: Object.assign({}, (config && config.labels) || {}, payload.config.labels || {}),
      cart: Object.assign({}, (config && config.cart) || {}, payload.config.cart || {}),
      checkout: Object.assign({}, (config && config.checkout) || {}, payload.config.checkout || {})
    }));
    window.LoopDeskConfig = config;
    window.LOOPDESK_CART_DRAWER_CONFIG = Object.assign({}, window.LOOPDESK_CART_DRAWER_CONFIG || {}, {
      enabled: config.enabled,
      drawerMode: config.cart.drawerMode,
      openAfterAddToCart: config.cart.openAfterAddToCart,
      expressCheckoutButtonEnabled: config.cart.expressCheckoutButtonEnabled,
      viewCartButtonEnabled: config.cart.viewCartButtonEnabled,
      primaryColor: config.branding.primaryColor,
      checkoutButtonText: config.labels.expressCheckoutText,
      buttonText: config.labels.expressCheckoutText,
      showPoweredBy: config.branding.showPoweredBy,
      promotion_rules_config: config.promotion_rules_config,
      promotionRules: config.promotion_rules_config
    });
    if (window.console) {
      window.console.info("[LoopDesk Runtime] promotion_rules_config after merge", config.promotion_rules_config);
      window.console.info("[LoopDesk Runtime] assigning window.LoopDeskConfig", window.LoopDeskConfig);
      window.console.info("[LoopDesk Runtime] legacy drawer config projection", window.LOOPDESK_CART_DRAWER_CONFIG);
    }
    if (state && state.cart) render();
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
        nativeDrawerDisabledRequiredMessage: text(cart.nativeDrawerDisabledRequiredMessage, DEFAULT_CONFIG.cart.nativeDrawerDisabledRequiredMessage)
      },
      checkout: {
        showSecureBadge: bool(checkout.showSecureBadge, DEFAULT_CONFIG.checkout.showSecureBadge),
        showTrustCopy: bool(checkout.showTrustCopy, DEFAULT_CONFIG.checkout.showTrustCopy)
      },
      promotion_rules_config: normalizePromotionConfig(raw.promotion_rules_config || raw.promotionRules),
      enabled: bool(firstDefined(raw.enabled, legacy.enabled), DEFAULT_CONFIG.enabled),
      cartOwnershipMode: text(cart.cartOwnershipMode || legacy.cartOwnershipMode, DEFAULT_CONFIG.cartOwnershipMode)
    };
    configDiagnostics("runtime config normalized", { drawerMode: normalized.cart.drawerMode }, true);
    if (Object.keys(legacy).length) configDiagnostics("legacy config merged", { keys: Object.keys(legacy) }, true);
    configDiagnostics("defaults applied", { merchantName: normalized.branding.merchantName }, true);
    return normalized;
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

  debugLog("config loaded", { drawerMode: config.cart.drawerMode, openAfterAddToCart: config.cart.openAfterAddToCart, expressCheckoutButtonEnabled: config.cart.expressCheckoutButtonEnabled, viewCartButtonEnabled: config.cart.viewCartButtonEnabled }, true);

  if (typeof window.fetch === "function" && (!config.promotion_rules_config.enabled || !config.promotion_rules_config.rules.length)) {
    var runtimeConfigUrl = getRuntimeConfigUrl();
    if (runtimeConfigUrl) {
      window.fetch(runtimeConfigUrl, { credentials: "same-origin", cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(mergeFetchedRuntimeConfig)
        .catch(function (error) {
          if (window.console) window.console.info("[LoopDesk Runtime] fetched config", { ok: false, error: error && error.message ? error.message : String(error || "unknown") });
        });
    }
  }

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
    window.LoopDeskConfig = config;
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
    var rootAvailable = Boolean(root || document.body);
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
      return url.origin === window.location.origin && url.pathname.indexOf("/cart") !== -1;
    } catch (_error) {
      return String(href).indexOf("/cart") !== -1;
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
    ].join(","));
    if (excluded) return true;
    var text = elementText(element);
    return /\b(checkout|quantity|qty|increase|decrease|remove|discount|coupon|promo)\b/.test(text) || /\badd(?:\s|-|_)to(?:\s|-|_)cart\b/.test(text);
  }

  function findCartTrigger(target) {
    if (!target || !target.closest || isInsideLoopDeskDrawer(target)) return null;
    var link = target.closest("a[href]");
    if (link && hasCartPath(link.getAttribute("href")) && !isExcludedCartControl(link)) return link;

    var trigger = closestSelector(target, CART_TRIGGER_SELECTOR);
    if (!trigger || isInsideLoopDeskDrawer(trigger) || isExcludedCartControl(trigger)) return null;

    var wrapper = trigger.closest && trigger.closest("[class*='cart-icon' i], [id*='cart-icon' i], [class*='header__icon--cart' i], [data-cart], [data-cart-drawer], [aria-controls*='cart' i]");
    var text = elementText(trigger) + " " + elementText(wrapper || null);
    if (!hasCartPath(trigger.getAttribute && trigger.getAttribute("href")) && !/\b(cart|bag)\b|cart-icon|header__icon--cart/.test(text)) return null;
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
    var triggers = Array.prototype.slice.call(document.querySelectorAll(CART_TRIGGER_SELECTOR))
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

  function fallbackToCartPage(trigger) {
    var href = trigger && trigger.getAttribute && trigger.getAttribute("href");
    window.location.href = href && hasCartPath(href) ? href : "/cart";
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

  function idTail(value) {
    var textValue = String(value || "");
    return textValue.split("/").pop();
  }

  function sameShopifyId(left, right) {
    if (!left || !right) return false;
    return String(left) === String(right) || idTail(left) === idTail(right);
  }

  function cartContainsProduct(cart, productGid) {
    return Boolean(cart && Array.isArray(cart.items) && cart.items.some(function (item) { return sameShopifyId(item.product_id, productGid) || sameShopifyId(item.product_gid, productGid) || sameShopifyId(item.productGid, productGid); }));
  }

  function cartContainsVariant(cart, variantGid) {
    return Boolean(cart && Array.isArray(cart.items) && cart.items.some(function (item) { return sameShopifyId(item.variant_id, variantGid) || sameShopifyId(item.variant_gid, variantGid) || sameShopifyId(item.variantGid, variantGid) || sameShopifyId(item.id, variantGid); }));
  }

  function cartVariantQuantity(cart, variantGid) {
    if (!cart || !Array.isArray(cart.items) || !variantGid) return 0;
    return cart.items.reduce(function (total, item) {
      return total + (sameShopifyId(item.variant_id, variantGid) || sameShopifyId(item.variant_gid, variantGid) || sameShopifyId(item.variantGid, variantGid) || sameShopifyId(item.id, variantGid) ? Math.max(0, Number(item.quantity) || 0) : 0);
    }, 0);
  }

  function firstAvailableVariantGidFromMetadata(product) {
    if (!isPlainObject(product)) return "";
    var direct = product.firstAvailableVariantGid || product.firstAvailableVariantId || product.availableVariantGid;
    if (direct) return String(direct);
    var directVariant = isPlainObject(product.firstAvailableVariant) ? product.firstAvailableVariant : isPlainObject(product.selectedOrFirstAvailableVariant) ? product.selectedOrFirstAvailableVariant : null;
    if (directVariant && (directVariant.gid || directVariant.id)) return String(directVariant.gid || directVariant.id);
    var variants = Array.isArray(product.variants) ? product.variants : [];
    for (var i = 0; i < variants.length; i += 1) {
      var variant = variants[i];
      if (!isPlainObject(variant)) continue;
      var availabilityKnown = typeof variant.available === "boolean" || typeof variant.availableForSale === "boolean";
      var available = variant.available === true || variant.availableForSale === true;
      if (availabilityKnown && available && (variant.gid || variant.id)) return String(variant.gid || variant.id);
    }
    return "";
  }

  function resolvePromotionOfferVariantGid(reward) {
    if (!isPlainObject(reward)) return "";
    if (reward.variantGid) return String(reward.variantGid);
    return firstAvailableVariantGidFromMetadata(reward.product);
  }

  function promotionOfferRemainingQuantity(cart, rule, variantGid) {
    var reward = isPlainObject(rule && rule.reward) ? rule.reward : {};
    var limits = isPlainObject(rule && rule.limits) ? rule.limits : {};
    var desired = Math.max(1, Number(reward.quantity) || 1);
    var max = Math.max(1, Number(limits.maxQuantityPerCart) || 1);
    var existing = cartVariantQuantity(cart, variantGid);
    return Math.max(0, Math.min(desired, max - existing));
  }

  function arrayField(item, names) {
    for (var i = 0; i < names.length; i += 1) {
      var value = item && item[names[i]];
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === "string" && value.trim()) return value.split(",").map(function (part) { return part.trim(); });
    }
    return null;
  }

  function itemHasMetadataValue(cart, names, expected, diagnosticKey, label) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    var available = false;
    var matched = items.some(function (item) {
      var values = arrayField(item, names);
      if (!values) return false;
      available = true;
      return values.some(function (value) { return sameShopifyId(value, expected) || String(value).toLowerCase() === String(expected || "").toLowerCase(); });
    });
    if (!available) debugLogOnce(diagnosticKey, "Promotion trigger skipped because storefront cart metadata is unavailable", { trigger: label }, true);
    return matched;
  }

  function itemHasProductType(cart, expected) {
    var items = cart && Array.isArray(cart.items) ? cart.items : [];
    var available = false;
    var matched = items.some(function (item) {
      var value = item && (item.product_type || item.productType || item.type);
      if (!value) return false;
      available = true;
      return String(value).toLowerCase() === String(expected || "").toLowerCase();
    });
    if (!available) debugLogOnce("promotion-product-type-unavailable", "Promotion trigger skipped because storefront cart metadata is unavailable", { trigger: "product_type" }, true);
    return matched;
  }

  function isPromotionScheduled(rule, now) {
    var schedule = isPlainObject(rule.schedule) ? rule.schedule : {};
    if (schedule.alwaysActive !== false) return true;
    var time = now ? now.getTime() : Date.now();
    var start = schedule.startAt ? Date.parse(schedule.startAt) : NaN;
    var end = schedule.endAt ? Date.parse(schedule.endAt) : NaN;
    if (Number.isFinite(start) && time < start) return false;
    if (Number.isFinite(end) && time > end) return false;
    return true;
  }

  function triggerMatches(trigger, cart) {
    var type = trigger && trigger.type;
    var value = trigger && (trigger.value || trigger.productGid || trigger.variantGid || trigger.collectionGid || trigger.productType || trigger.tag || trigger.subtotalGte || trigger.quantityGte);
    if (!type || type === "always") return true;
    if (type === "cart_contains_product") return cartContainsProduct(cart, trigger.productGid || value);
    if (type === "cart_contains_variant") return cartContainsVariant(cart, trigger.variantGid || value);
    if (type === "cart_contains_collection") return itemHasMetadataValue(cart, ["collections", "collection_ids", "collectionGids"], trigger.collectionGid || value, "promotion-collections-unavailable", "cart_contains_collection");
    if (type === "cart_contains_product_type" || type === "product_type") return itemHasProductType(cart, trigger.productType || value);
    if (type === "cart_contains_tag" || type === "tag") return itemHasMetadataValue(cart, ["tags", "product_tags", "productTags"], trigger.tag || value, "promotion-tags-unavailable", "tag");
    if (type === "cart_subtotal_gte" || type === "cart_subtotal_min") return cartRawSubtotal(cart) >= Number(trigger.subtotalGte || value || 0);
    if (type === "cart_quantity_gte" || type === "cart_quantity_min") return Number(cart && cart.item_count || 0) >= Number(trigger.quantityGte || value || 0);
    return false;
  }

  function getEligiblePromotionRules(cart, placement, now) {
    var promotionConfig = normalizePromotionConfig(config.promotion_rules_config || config.promotionRules);
    if (!promotionConfig.enabled) return [];
    return promotionConfig.rules.filter(function (rule) {
      var display = isPlainObject(rule.display) ? rule.display : {};
      var reward = isPlainObject(rule.reward) ? rule.reward : {};
      var eligibility = isPlainObject(rule.eligibility) ? rule.eligibility : {};
      var rulePlacement = display.placement || "drawer";
      var triggers = Array.isArray(eligibility.triggers) && eligibility.triggers.length ? eligibility.triggers : [{ type: "always" }];
      var matched = eligibility.match === "all" ? triggers.every(function (trigger) { return triggerMatches(trigger, cart); }) : triggers.some(function (trigger) { return triggerMatches(trigger, cart); });
      var offerVariantGid = resolvePromotionOfferVariantGid(reward);
      return rule && rule.enabled === true && rule.status === "active" && (rulePlacement === placement || rulePlacement === "both") && reward.productGid && offerVariantGid && promotionOfferRemainingQuantity(cart, rule, offerVariantGid) > 0 && isPromotionScheduled(rule, now) && !(display.hideIfOfferProductAlreadyInCart !== false && (cartContainsProduct(cart, reward.productGid) || cartContainsVariant(cart, offerVariantGid))) && matched;
    }).sort(function (a, b) { return (Number(a.priority) || 0) - (Number(b.priority) || 0); }).slice(0, promotionConfig.maxVisibleOffers);
  }


  function parseDisplayMoney(value) {
    var raw = text(value, "");
    if (!raw) return null;
    var match = raw.match(/(-?\d+(?:[,.]\d+)?)/);
    if (!match) return null;
    var amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) return null;
    return { amount: amount, prefix: raw.slice(0, match.index), suffix: raw.slice((match.index || 0) + match[0].length) };
  }

  function formatDisplayMoneyLike(template, amount) {
    var rounded = Math.round(Math.max(0, amount) * 100) / 100;
    var rendered = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return String(template.prefix || "") + rendered + String(template.suffix || "");
  }

  function promotionPricingHelper() { return window.LoopDeskPromotionPricing || null; }

  function centsFromDisplayMoney(value) {
    var parsed = parseDisplayMoney(value);
    return parsed ? Math.round(parsed.amount * 100) : 0;
  }

  function resolvePromotionRewardVariantPrice(rule, reward, display) {
    reward = isPlainObject(reward) ? reward : {};
    display = isPlainObject(display) ? display : {};
    var product = isPlainObject(reward.product) ? reward.product : {};
    var paths = [
      { value: product.variantPrice, source: "reward.product.variantPrice" },
      { value: reward.variantPrice, source: "reward.variantPrice" },
      { value: rule && rule.rewardProductVariantPrice, source: "rewardProductVariantPrice" },
      { value: display.comparePriceDisplay, source: "legacy_compare" }
    ];
    for (var i = 0; i < paths.length; i += 1) {
      if (text(paths[i].value, "")) return paths[i];
    }
    return { value: "", source: "unavailable" };
  }

  function resolvePromotionOfferPriceDisplay(display, reward, rule, cart, offerQuantity) {
    var configuredPrice = resolvePromotionRewardVariantPrice(rule, reward, display);
    var originalUnit = centsFromDisplayMoney(configuredPrice.value);
    var helper = promotionPricingHelper();
    var resolved = helper && helper.resolvePromotionDisplayPricing ? helper.resolvePromotionDisplayPricing({ cart: cart, rule: rule, rewardVariantGid: resolvePromotionOfferVariantGid(reward), rewardUnitPrice: originalUnit, rewardQuantity: Math.max(1, Number(offerQuantity) || Number(reward && reward.quantity) || 1) }) : null;
    if (resolved && resolved.isEligible && resolved.promotionalUnitPrice !== null) {
      return { value: money(resolved.promotionalUnitPrice, cart && cart.currency), source: "shared_resolver", resolved: resolved };
    }
    var override = text(display && display.offerPriceDisplay, "");
    if (override) return { value: override, source: "merchant_admin", resolved: null };
    return { value: "", source: "unavailable", resolved: null };
  }

  function renderPromotionOffers(cart) {
    var offers = getEligiblePromotionRules(cart, "drawer", new Date());
    if (!offers.length) return "";
    return '<section class="loopdesk-cart-drawer__offers" aria-label="Available offers">' + offers.map(function (rule) {
      var display = isPlainObject(rule.display) ? rule.display : {};
      var reward = isPlainObject(rule.reward) ? rule.reward : {};
      var product = isPlainObject(reward.product) ? reward.product : {};
      var offerVariantGid = resolvePromotionOfferVariantGid(reward);
      var offerQuantity = promotionOfferRemainingQuantity(cart, rule, offerVariantGid);
      var adding = state.offerAdding === String(rule.id || offerVariantGid);
      var image = display.imageOverrideUrl || product.imageUrl || product.image || "";
      var title = product.title || rule.name || "Offer product";
      var resolvedOfferPrice = resolvePromotionOfferPriceDisplay(display, reward, rule, cart, offerQuantity);
      var offerPrice = resolvedOfferPrice.value;
      var configuredComparePrice = resolvePromotionRewardVariantPrice(rule, reward, display);
      var comparePrice = text(configuredComparePrice.value, "");
      var comparePriceSource = configuredComparePrice.source;
      var displayPriceSource = offerPrice ? resolvedOfferPrice.source : "unavailable";
      var pricing = offerPrice ? '<div class="loopdesk-cart-drawer__offer-prices" data-loopdesk-display-price-source="' + escapeHtml(displayPriceSource) + '" data-loopdesk-compare-price-source="' + escapeHtml(comparePriceSource) + '"><span>Get it for ' + escapeHtml(offerPrice) + '</span>' + (comparePrice ? '<s aria-label="Usually ' + escapeHtml(comparePrice) + '">Usually ' + escapeHtml(comparePrice) + '</s>' : '') + '</div>' : '';
      var deferred = reward.requiresDiscountEnforcement ? ' data-loopdesk-promotion-enforcement="deferred"' : '';
      return ['<article class="loopdesk-cart-drawer__offer" data-loopdesk-promotion-rule="' + escapeHtml(rule.id || '') + '"' + deferred + '>', display.badge ? '<div class="loopdesk-cart-drawer__offer-badge">' + escapeHtml(display.badge) + '</div>' : '', '<div class="loopdesk-cart-drawer__offer-content">', image ? '<img class="loopdesk-cart-drawer__offer-image" src="' + escapeHtml(image) + '" alt="' + escapeHtml(title) + '" loading="lazy">' : '<div class="loopdesk-cart-drawer__offer-image loopdesk-cart-drawer__offer-image--placeholder"></div>', '<div class="loopdesk-cart-drawer__offer-copy"><h3>' + escapeHtml(display.heading || rule.name || 'Special offer') + '</h3>', display.description ? '<p>' + escapeHtml(display.description) + '</p>' : '', '<strong>' + escapeHtml(title) + '</strong>' + pricing + '</div></div>', state.offerError ? '<div class="loopdesk-cart-drawer__offer-error" role="alert">' + escapeHtml(state.offerError) + '</div>' : '', '<button type="button" class="loopdesk-cart-drawer__offer-cta" data-loopdesk-offer-add data-loopdesk-offer-key="' + escapeHtml(rule.id || offerVariantGid) + '" data-loopdesk-offer-variant="' + escapeHtml(offerVariantGid) + '" data-loopdesk-offer-quantity="' + escapeHtml(offerQuantity) + '"' + (adding ? ' disabled aria-busy="true"' : '') + '>' + escapeHtml(adding ? 'Adding…' : display.ctaLabel || 'Add offer') + '</button></article>'].join('');
    }).join('') + '</section>';
  }


  function promotionViewModel(cart) {
    var helper = promotionPricingHelper();
    var rules = normalizePromotionConfig(config.promotion_rules_config || config.promotionRules).rules || [];
    if (!helper || !helper.buildPromotionViewModel) return null;
    var vm = helper.buildPromotionViewModel({ cart: cart || {}, rules: rules, currency: cart && cart.currency });
    if (window.LOOPDESK_CONFIG_DEBUG === true && window.console && window.console.debug) {
      window.console.debug("[LoopDesk Promotion VM]", {
        cartItemCount: Array.isArray(cart && cart.items) ? cart.items.length : 0,
        rulesCount: rules.length,
        hasPromotion: Boolean(vm && vm.totals && vm.totals.promotionDiscountTotal > 0)
      });
    }
    return vm;
  }

  function loopdeskOfferHandoffPayload(cart) {
    var vm = promotionViewModel(cart || state.cart || {});
    var totals = vm && vm.totals ? vm.totals : null;
    var offerDiscount = Number(totals && totals.promotionDiscountTotal);
    var adjustedTotal = Number(totals && totals.estimatedAfterOffer);
    var baseSubtotal = Number(totals && totals.shopifySubtotal);
    if (!(offerDiscount > 0) || !(adjustedTotal >= 0) || !(baseSubtotal > 0)) return null;
    return {
      loopdeskOfferDiscountAmountPaise: Math.round(offerDiscount),
      loopdeskOfferAdjustedTotalAmountPaise: Math.round(adjustedTotal),
      loopdeskOfferBaseSubtotalAmountPaise: Math.round(baseSubtotal)
    };
  }

  function promotionViewModelLine(vm, item) {
    if (!vm || !Array.isArray(vm.cartLines)) return null;
    var itemKey = item && item.key;
    var itemVariant = item && (item.variant_id || item.variant_gid || item.variantGid || item.id);
    for (var i = 0; i < vm.cartLines.length; i += 1) {
      var line = vm.cartLines[i];
      if ((itemKey && line.lineKey === itemKey) || sameShopifyId(line.variantId, itemVariant)) return line;
    }
    return null;
  }

  function promotionDiscountValueCents(discount) {
    if (!isPlainObject(discount)) return NaN;
    var cents = discount.valueCents || discount.amountCents || discount.fixedPriceCents || discount.fixedAmountCents;
    if (cents !== undefined && cents !== null && cents !== "") return Number(cents);
    var value = Number(discount.value);
    if (!Number.isFinite(value)) return NaN;
    return Math.round(value * 100);
  }

  function cartWithoutItem(cart, excludedItem) {
    if (!cart || !Array.isArray(cart.items)) return cart;
    var quantity = cart.items.reduce(function (total, item) {
      if (item === excludedItem || item.key === excludedItem.key) return total;
      return total + (Math.max(0, Number(item.quantity) || 0));
    }, 0);
    var clone = Object.assign({}, cart, {
      items: cart.items.filter(function (item) { return !(item === excludedItem || item.key === excludedItem.key); }),
      item_count: quantity
    });
    return clone;
  }

  function triggerMatchesRewardLine(trigger, cart, item) {
    var type = trigger && trigger.type;
    if (type === "cart_contains_product" || type === "cart_contains_variant") return triggerMatches(trigger, cartWithoutItem(cart, item));
    return triggerMatches(trigger, cart);
  }

  function promotionRuleMatchesRewardLine(rule, cart, item, now) {
    var reward = isPlainObject(rule && rule.reward) ? rule.reward : {};
    var eligibility = isPlainObject(rule && rule.eligibility) ? rule.eligibility : {};
    var offerVariantGid = resolvePromotionOfferVariantGid(reward);
    if (!rule || rule.enabled !== true || rule.status !== "active" || !isPromotionScheduled(rule, now) || !offerVariantGid) return false;
    if (!(sameShopifyId(item.variant_id, offerVariantGid) || sameShopifyId(item.variant_gid, offerVariantGid) || sameShopifyId(item.variantGid, offerVariantGid) || sameShopifyId(item.id, offerVariantGid))) return false;
    var triggers = Array.isArray(eligibility.triggers) && eligibility.triggers.length ? eligibility.triggers : [{ type: "always" }];
    return eligibility.match === "all" ? triggers.every(function (trigger) { return triggerMatchesRewardLine(trigger, cart, item); }) : triggers.some(function (trigger) { return triggerMatchesRewardLine(trigger, cart, item); });
  }

  function promotionRewardLineAdjustment(rule, item, cart) {
    var reward = isPlainObject(rule && rule.reward) ? rule.reward : {};
    var quantity = Math.max(1, Number(item.quantity) || 1);
    var originalLine = Number(item.final_line_price || item.original_line_price || item.line_price || 0);
    var originalUnit = Math.round(originalLine / quantity);
    var helper = promotionPricingHelper();
    if (!helper || typeof helper.resolvePromotionDisplayPricing !== "function") return null;
    var resolved = helper.resolvePromotionDisplayPricing({ cart: cart, rule: rule, rewardVariantGid: resolvePromotionOfferVariantGid(reward), rewardUnitPrice: originalUnit, rewardQuantity: quantity });
    if (!resolved || !resolved.isEligible || resolved.promotionalUnitPrice === null) return null;
    return { rule: rule, originalUnit: resolved.originalUnitPrice, adjustedUnit: resolved.promotionalUnitPrice, eligibleQuantity: resolved.eligibleQuantity, quantity: quantity, type: resolved.discountType, resolved: resolved };
  }

  function findPromotionRewardLineAdjustment(cart, item) {
    var promotionConfig = normalizePromotionConfig(config.promotion_rules_config || config.promotionRules);
    if (!promotionConfig.enabled || !Array.isArray(promotionConfig.rules)) return null;
    var now = new Date();
    var rules = promotionConfig.rules.slice().sort(function (a, b) { return (Number(a.priority) || 0) - (Number(b.priority) || 0); });
    for (var i = 0; i < rules.length; i += 1) {
      if (!promotionRuleMatchesRewardLine(rules[i], cart, item, now)) continue;
      var adjustment = promotionRewardLineAdjustment(rules[i], item, cart);
      if (adjustment) return adjustment;
    }
    return null;
  }

  function rewardLinePriceHtml(item, cart, viewModel) {
    var vmLine = promotionViewModelLine(viewModel, item);
    if (!vmLine || !vmLine.isPromotionAdjusted) return money(item.final_line_price, cart.currency) + lineSavingsHtml(item, cart);
    var quantityNote = vmLine.quantity > vmLine.eligibleQuantity ? '<div class="loopdesk-cart-drawer__reward-note">Promotion applies to ' + escapeHtml(vmLine.eligibleQuantity) + ' item' + (vmLine.eligibleQuantity === 1 ? '' : 's') + '</div>' : '';
    return '<div class="loopdesk-cart-drawer__reward-price"><span>' + money(vmLine.displayLineTotal, cart.currency) + '</span><s aria-label="Original price ' + escapeHtml(money(vmLine.originalLineTotal, cart.currency)) + '">' + money(vmLine.originalLineTotal, cart.currency) + '</s></div><div class="loopdesk-cart-drawer__reward-badge">' + escapeHtml(vmLine.labelText || "Offer applied") + '</div><div class="loopdesk-cart-drawer__reward-note">Discount applied at checkout</div>' + quantityNote;
  }

  function renderLines(cart, promotionVm) {
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
        '<div class="loopdesk-cart-drawer__line-top"><div><div class="loopdesk-cart-drawer__title">' + escapeHtml(item.product_title || item.title) + "</div>" + variant + '</div><div class="loopdesk-cart-drawer__price">' + rewardLinePriceHtml(item, cart, promotionVm) + '</div></div>',
        '<div class="loopdesk-cart-drawer__line-actions"><div class="loopdesk-cart-drawer__qty" aria-label="Quantity controls"><button type="button" data-loopdesk-qty="decrease" data-loopdesk-line="' + index + '">−</button><span>' + escapeHtml(item.quantity) + '</span><button type="button" data-loopdesk-qty="increase" data-loopdesk-line="' + index + '">+</button></div><button type="button" class="loopdesk-cart-drawer__remove" data-loopdesk-remove data-loopdesk-line="' + index + '">Remove</button></div>',
        "</div>",
        "</article>",
      ].join("");
    }).join("");
  }

  function cartRawSubtotal(cart) {
    var fields = ["original_total_price", "items_subtotal_price", "total_price"];
    for (var i = 0; i < fields.length; i += 1) {
      var value = cart && cart[fields[i]];
      if (value !== undefined && value !== null && value !== "") {
        var cents = Number(value);
        if (Number.isFinite(cents)) return cents;
      }
    }
    return 0;
  }

  function render() {
    var cart = state.cart;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;


    if (!elements.panel) return;
    elements.panel.setAttribute("aria-hidden", state.open ? "false" : "true");
    elements.overlay.hidden = !state.open;
    if (elements.root) elements.root.classList.toggle("loopdesk-cart-drawer--open", state.open);
    document.documentElement.classList.toggle("loopdesk-cart-drawer-is-open", state.open);
    if (document.body) document.body.classList.toggle("loopdesk-cart-drawer-is-open", state.open);

    var offerViewModel = promotionViewModel(cart || {});
    elements.body.innerHTML = state.error
      ? '<div class="loopdesk-cart-drawer__error">We could not load your cart. You can still use the cart page.</div>'
      : renderLines(cart, offerViewModel) + renderPromotionOffers(cart);

    elements.subtotal.textContent = money(cartRawSubtotal(cart), cart && cart.currency);
    if (elements.offerEstimate) {
      var offerTotals = offerViewModel && offerViewModel.totals ? offerViewModel.totals : { promotionDiscountTotal: 0, estimatedAfterOffer: 0 };
      elements.offerEstimate.hidden = !(offerTotals.promotionDiscountTotal > 0);
      elements.offerEstimate.innerHTML = offerTotals.promotionDiscountTotal > 0 ? '<div><span>Offer discount</span><strong>-' + escapeHtml(money(offerTotals.promotionDiscountTotal, cart && cart.currency)) + '</strong></div><div><span>Estimated after offer</span><strong>' + escapeHtml(money(offerTotals.estimatedAfterOffer, cart && cart.currency)) + '</strong></div><p>Final discount is applied at checkout.</p>' : '';
    }
    elements.count.textContent = itemCount ? "(" + itemCount + ")" : "";
    elements.express.hidden = !config.cart.expressCheckoutButtonEnabled || itemCount === 0;
    elements.express.disabled = state.expressCheckoutLock;
    elements.express.classList.toggle("is-loading", state.expressCheckoutLock);
    elements.express.textContent = state.expressCheckoutLock ? "Opening checkout..." : config.labels.expressCheckoutText;
    elements.viewCart.hidden = !config.cart.viewCartButtonEnabled;
    if (elements.poweredBy) elements.poweredBy.hidden = config.branding.showPoweredBy === false;
  }

  function setOpen(open) {
    state.hostMode = LOOPDESK_HOST_MODE;
    if (open) rememberBodyLockState();
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
      .then(function (cart) { state.cart = cart; })
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


  function addPromotionOffer(variantGid, quantity, offerKey) {
    var id = idTail(variantGid);
    if (!id || !canUseCartAjax() || state.offerAdding) return;
    state.offerAdding = String(offerKey || variantGid || "offer");
    state.offerError = "";
    render();
    return fetch("/cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: id, quantity: Math.max(1, Number(quantity) || 1) })
    }).then(function (response) {
      if (!response.ok) throw new Error("Offer add failed");
      return fetchCart();
    }).catch(function (error) {
      state.offerError = error && error.message ? error.message : "Offer add failed";
    }).finally(function () { state.offerAdding = false; render(); });
  }

  function handleDrawerAction(event) {
    var offerButton = event.target && event.target.closest && event.target.closest("[data-loopdesk-offer-add]");
    if (offerButton) {
      event.preventDefault();
      return addPromotionOffer(offerButton.getAttribute("data-loopdesk-offer-variant"), offerButton.getAttribute("data-loopdesk-offer-quantity"), offerButton.getAttribute("data-loopdesk-offer-key"));
    }
    var qtyButton = event.target && event.target.closest && event.target.closest("[data-loopdesk-qty]");
    var removeButton = event.target && event.target.closest && event.target.closest("[data-loopdesk-remove]");
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
    if (action === "pointerdown" || action === "touchstart" || action === "mousedown") {
      suppressNextCartClickUntil = Date.now() + 750;
      suppressedCartTrigger = trigger;
      debugLogOnce(action + "-suppressed", action + " suppressed", { trigger: getElementDescriptor(trigger) }, true);
    } else if (action === "click") {
      debugLogOnce("click-suppressed", "click suppressed", { trigger: getElementDescriptor(trigger) }, true);
    } else if (action === "keydown") {
      debugLogOnce("keydown-suppressed", "keydown suppressed", { trigger: getElementDescriptor(trigger), key: event.key }, true);
    }
    fetchCart().then(function () {
      if (state.error) {
        fallbackToCartPage(trigger);
        return;
      }
      setOpen(true);
      debugLogOnce("loopdesk-drawer-opened-from-trigger", "LoopDesk drawer opened", { trigger: getElementDescriptor(trigger), action: action }, true);
      scheduleNativeCartPanelCleanup();
    }).catch(function () {
      fallbackToCartPage(trigger);
    });
    return false;
  }

  function handleCartTriggerEvent(event) {
    if (!isDrawerAvailable()) return;
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

    if (event.type === "click" && suppressNextCartClickUntil > Date.now() && (suppressedCartTrigger === trigger || (suppressedCartTrigger && suppressedCartTrigger.contains && suppressedCartTrigger.contains(trigger)) || (trigger.contains && trigger.contains(suppressedCartTrigger)))) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      debugLogOnce("click-suppressed", "click suppressed", { trigger: getElementDescriptor(trigger) }, true);
      return false;
    }
    if (event.type === "click" || event.type === "pointerdown" || event.type === "mousedown" || event.type === "touchstart" || event.type === "keydown") {
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
      '<footer class="loopdesk-cart-drawer__footer"><div class="loopdesk-cart-drawer__subtotal"><span>Subtotal</span><strong data-loopdesk-cart-subtotal></strong></div><div class="loopdesk-cart-drawer__offer-estimate" data-loopdesk-offer-estimate hidden></div><button type="button" class="loopdesk-cart-drawer__express" data-loopdesk-express-checkout></button><a class="loopdesk-cart-drawer__view-cart" href="/cart"></a><p class="loopdesk-cart-drawer__microcopy"></p><p class="loopdesk-cart-drawer__powered"></p></footer>',
      '</aside>',
    ].join("");
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
      offerEstimate: hostRoot.querySelector("[data-loopdesk-offer-estimate]"),
      count: hostRoot.querySelector("[data-loopdesk-cart-count]"),
      express: hostRoot.querySelector(".loopdesk-cart-drawer__express"),
      viewCart: hostRoot.querySelector(".loopdesk-cart-drawer__view-cart"),
      poweredBy: hostRoot.querySelector(".loopdesk-cart-drawer__powered"),
    };

    if (elements.close) elements.close.addEventListener("click", function () { setOpen(false); });
    if (elements.overlay) elements.overlay.addEventListener("click", function () { setOpen(false); });
    if (elements.express) {
      elements.express.textContent = config.labels.expressCheckoutText;
      elements.express.addEventListener("click", function (event) { interceptCheckout(event, "drawer"); });
    }
    if (elements.viewCart) elements.viewCart.textContent = config.labels.viewCartText;
    if (elements.poweredBy) elements.poweredBy.textContent = config.branding.poweredByText;
    var microcopy = hostRoot.querySelector(".loopdesk-cart-drawer__microcopy");
    if (microcopy) microcopy.textContent = config.labels.secureCheckoutText + " • UPI, cards, net banking & COD";
    if (elements.body) elements.body.addEventListener("click", handleDrawerAction);
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
    refreshAndMaybeOpen(false);
    scheduleCartTriggerTakeover("mount");
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
    var loopdeskOfferPricing = loopdeskOfferHandoffPayload(state.cart);
    debugLog("OTP/checkout handoff started", { source: checkoutSource, loopdeskOfferPricing: loopdeskOfferPricing }, true);
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") {
      debugLog("Express modal API present", { source: checkoutSource });
      window.setTimeout(function () {
        try {
          window.MegaskaExpressCheckout.open({ source: checkoutSource, loopdeskOfferPricing: loopdeskOfferPricing });
        } finally {
          window.setTimeout(releaseLock, 900);
        }
      }, 32);
    } else {
      debugLog("Express modal API missing", { source: checkoutSource });
      window.setTimeout(releaseLock, 900);
      window.location.href = "/apps/megaska/checkout";
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
      '<span class="loopdesk-checkout-cta__trust">Secure checkout powered by LoopDesk</span>'
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
  scheduleCheckoutCtaScan();
  observeCheckoutCtaTargets();
  scheduleCartTriggerTakeover("init");
  observeCartTriggerTakeoverTargets();
})();
