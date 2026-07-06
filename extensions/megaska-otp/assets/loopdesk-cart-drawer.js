(function () {
  var DEFAULT_CONFIG = {
    enabled: true,
    primaryColor: "#111827",
    buttonText: "Express Checkout",
    checkoutButtonText: "",
    showPoweredBy: true,
    drawerMode: "auto",
    openAfterAddToCart: false,
    expressCheckoutButtonEnabled: true,
    viewCartButtonEnabled: true,
    cartOwnershipMode: "fallback",
  };
  var config = normalizeConfig(Object.assign({}, DEFAULT_CONFIG, window.LOOPDESK_CART_DRAWER_CONFIG || window.LoopDeskCartDrawerConfig || {}));
  var ROOT_ID = "loopdesk-cart-drawer-root";
  var FETCH_MARKER = "__loopdeskCartDrawerPatched";
  var XHR_MARKER = "__loopdeskCartDrawerXhrPatched";
  var FORM_MARKER = "__loopdeskCartDrawerFormPatched";
  var LOCATION_MARKER = "__loopdeskCartDrawerLocationPatched";
  var LOOPDESK_HOST_MODE = "NO_THEME_DRAWER";

  var THEME_CART_DRAWER_SELECTORS = [
    "cart-drawer",
    "cart-notification",
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
    "[id*='CartDrawer']",
    "[id*='cart-drawer' i]",
    "[class*='cart-drawer' i]",
    "[class*='cart-notification' i]",
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

  var state = { open: false, loading: false, cart: null, error: "", hostMode: LOOPDESK_HOST_MODE, themeDrawer: null, fallbackReason: "", expressCheckoutLock: false, capability: null, drawerModeActive: false, neutralizedThemeDrawers: [], bodyLockSnapshot: null, removedThemeBodyClasses: [] };
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


  function normalizeConfig(rawConfig) {
    var mode = rawConfig.drawerMode || rawConfig.cartDrawerMode;
    if (!mode && rawConfig.cartOwnershipMode === "theme") mode = "theme";
    if (!mode && rawConfig.cartOwnershipMode === "app") mode = "loopdesk";
    if (!mode || ["theme", "loopdesk", "auto"].indexOf(mode) === -1) mode = "auto";
    rawConfig.drawerMode = mode;
    rawConfig.checkoutButtonText = rawConfig.buttonText || rawConfig.checkoutButtonText || DEFAULT_CONFIG.buttonText;
    rawConfig.primaryColor = rawConfig.primaryColor || DEFAULT_CONFIG.primaryColor;
    return rawConfig;
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

  debugLog("config loaded", { drawerMode: config.drawerMode, openAfterAddToCart: config.openAfterAddToCart, expressCheckoutButtonEnabled: config.expressCheckoutButtonEnabled, viewCartButtonEnabled: config.viewCartButtonEnabled }, true);

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

  function canUseCartAjax() {
    return typeof window.fetch === "function";
  }

  function canUseExpressCheckoutBridge() {
    return Boolean(window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") || true;
  }

  function getCapabilityResult() {
    var root = getLoopDeskRoot();
    var result = {
      assetsLoaded: Boolean(window.__LOOPDESK_CART_DRAWER_LOADED__),
      cartAjaxAvailable: canUseCartAjax(),
      rootAvailable: Boolean(root || document.body),
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

  function isLoopDeskDrawerActive() {
    var capability = getCapabilityResult();
    if (config.drawerMode === "theme") return false;
    if (config.drawerMode === "loopdesk") return capability.safe;
    return capability.safe;
  }

  function shouldOpenLoopDeskAfterCartAdd() {
    return Boolean(config.openAfterAddToCart && isLoopDeskDrawerActive());
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
      debugLogOnce("native-split-panel-cleanup", "native split panel cleanup applied", { element: getElementDescriptor(drawer) }, true);
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

  function renderLines(cart) {
    if (state.loading) return '<div class="loopdesk-cart-drawer__loading"><span></span>Loading your cart…</div>';
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

  function render() {
    var cart = state.cart;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;


    if (!elements.panel) return;
    elements.panel.setAttribute("aria-hidden", state.open ? "false" : "true");
    elements.overlay.hidden = !state.open;
    document.documentElement.classList.toggle("loopdesk-cart-drawer-is-open", state.open);
    if (document.body) document.body.classList.toggle("loopdesk-cart-drawer-is-open", state.open);

    elements.body.innerHTML = state.error
      ? '<div class="loopdesk-cart-drawer__error">We could not load your cart. You can still use the cart page.</div>'
      : renderLines(cart);

    elements.subtotal.textContent = money(cart ? cart.total_price : 0, cart && cart.currency);
    elements.count.textContent = itemCount ? "(" + itemCount + ")" : "";
    elements.express.hidden = !config.expressCheckoutButtonEnabled || itemCount === 0;
    elements.viewCart.hidden = !config.viewCartButtonEnabled;
    if (elements.poweredBy) elements.poweredBy.hidden = config.showPoweredBy === false;
  }

  function setOpen(open) {
    state.hostMode = LOOPDESK_HOST_MODE;
    if (open) rememberBodyLockState();
    state.open = open;
    render();
    if (open) neutralizeThemeDrawers();
    if (!open) {
      restoreNeutralizedThemeDrawers();
      restoreLoopDeskBodyLock();
    }
    if (open) debugLog("drawer opened", { source: "loopdesk", mode: config.drawerMode }, true);
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

  function handleDrawerAction(event) {
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
      window.setTimeout(neutralizeThemeDrawers, 0);
      window.setTimeout(neutralizeThemeDrawers, 60);
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
    debugLog("selected drawer mode", { mode: config.drawerMode, active: active }, true);
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
    return [
      '<div class="loopdesk-cart-drawer__overlay" hidden></div>',
      '<aside class="loopdesk-cart-drawer" aria-hidden="true" aria-label="Cart" role="dialog">',
      '<header class="loopdesk-cart-drawer__header"><div><h2>Your bag <span data-loopdesk-cart-count></span></h2><p>Cart</p></div><button type="button" class="loopdesk-cart-drawer__close" aria-label="Close cart">×</button></header>',
      '<div class="loopdesk-cart-drawer__body"></div>',
      '<footer class="loopdesk-cart-drawer__footer"><div class="loopdesk-cart-drawer__subtotal"><span>Subtotal</span><strong data-loopdesk-cart-subtotal></strong></div><button type="button" class="loopdesk-cart-drawer__express" data-loopdesk-express-checkout>' + escapeHtml(config.checkoutButtonText || config.buttonText || 'Express Checkout') + '</button><a class="loopdesk-cart-drawer__view-cart" href="/cart">View cart</a><p class="loopdesk-cart-drawer__microcopy">Secure checkout • UPI, cards, net banking & COD</p><p class="loopdesk-cart-drawer__powered">Powered by LoopDesk</p></footer>',
      '</aside>',
    ].join("");
  }

  function bindElements(hostRoot) {
    elements = {
      root: getLoopDeskRoot(),
      overlay: hostRoot.querySelector(".loopdesk-cart-drawer__overlay"),
      panel: hostRoot.querySelector(".loopdesk-cart-drawer"),
      body: hostRoot.querySelector(".loopdesk-cart-drawer__body"),
      close: hostRoot.querySelector(".loopdesk-cart-drawer__close"),
      subtotal: hostRoot.querySelector("[data-loopdesk-cart-subtotal]"),
      count: hostRoot.querySelector("[data-loopdesk-cart-count]"),
      express: hostRoot.querySelector(".loopdesk-cart-drawer__express"),
      viewCart: hostRoot.querySelector(".loopdesk-cart-drawer__view-cart"),
      poweredBy: hostRoot.querySelector(".loopdesk-cart-drawer__powered"),
    };

    if (elements.close) elements.close.addEventListener("click", function () { setOpen(false); });
    if (elements.overlay) elements.overlay.addEventListener("click", function () { setOpen(false); });
    if (elements.express) elements.express.addEventListener("click", function (event) { interceptCheckout(event, "loopdesk-cart-drawer"); });
    if (elements.body) elements.body.addEventListener("click", handleDrawerAction);
    if (elements.root) elements.root.style.setProperty("--ld-primary", config.primaryColor);
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
    debugLog("selected drawer mode", { mode: config.drawerMode, active: isLoopDeskDrawerActive() }, true);
    debugLog("capability result", getCapabilityResult(), true);
    refreshAndMaybeOpen(false);
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
    var checkoutSource = source || "checkout-intent";
    var releaseLock = function () { state.expressCheckoutLock = false; };
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
      '<span class="loopdesk-checkout-cta__label">' + escapeHtml(config.checkoutButtonText || 'Express Checkout') + '</span>',
      '<span class="loopdesk-checkout-cta__subtext">UPI • Cards • Net Banking • COD</span>',
      '<span class="loopdesk-checkout-cta__trust">Secure checkout powered by LoopDesk</span>'
    ].join('');
    button.addEventListener('click', function (event) {
      interceptCheckout(event, 'loopdesk-checkout-cta');
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
      if (!config.openAfterAddToCart) return;
      window.setTimeout(function () { refreshAfterCartMutation(true); }, 900);
    }, true);
  }

  window.LoopDeskCartController = {
    open: function () { return refreshAndMaybeOpen(true); },
    close: function () { setOpen(false); },
    render: render,
    refresh: function () { return refreshAndMaybeOpen(false); },
    acquireHost: acquireHost,
    getState: function () { return Object.assign({}, state); },
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
})();
