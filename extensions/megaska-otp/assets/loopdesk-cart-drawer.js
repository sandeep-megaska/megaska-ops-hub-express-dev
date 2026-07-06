(function () {
  var DEFAULT_CONFIG = {
    enabled: true,
    openAfterAddToCart: true,
    expressCheckoutButtonEnabled: true,
    viewCartButtonEnabled: true,
  };
  var config = Object.assign({}, DEFAULT_CONFIG, window.LOOPDESK_CART_DRAWER_CONFIG || {});
  var ROOT_ID = "loopdesk-cart-drawer-root";
  var FETCH_MARKER = "__loopdeskCartDrawerPatched";
  var THEME_HOST_MODE = "THEME_DRAWER_PRESENT";
  var LOOPDESK_HOST_MODE = "NO_THEME_DRAWER";

  var THEME_CART_HOST_SELECTORS = [
    "cart-drawer",
    "#CartDrawer",
    "#cart-drawer",
    ".cart-drawer",
    "[data-cart-drawer]",
    "[data-drawer='cart']",
  ];
  var NATIVE_CART_DRAWER_OPEN_CLASSES = [
    "active",
    "open",
    "is-open",
    "drawer--open",
    "menu-opening",
    "animate",
  ];
  var NATIVE_CART_DRAWER_CLOSE_SELECTORS = [
    "button[name='close']",
    ".drawer__close",
    ".cart-drawer__close",
    "[aria-label*='close' i]",
  ];
  var CART_BODY_LOCK_CLASSES = [
    "cart-open",
    "cart-drawer-open",
    "drawer-open",
    "js-drawer-open",
    "js-drawer-open-cart",
    "mini-cart-open",
    "no-scroll",
    "overflow-hidden",
  ];

  if (!config.enabled || window.__LOOPDESK_CART_DRAWER_LOADED__) return;
  window.__LOOPDESK_CART_DRAWER_LOADED__ = true;

  var state = { open: false, loading: false, cart: null, error: "", hostMode: LOOPDESK_HOST_MODE, themeHost: null, fallbackReason: "" };
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

  function isCartAddUrl(input) {
    try {
      var url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      return url.origin === window.location.origin && (url.pathname === "/cart/add" || url.pathname === "/cart/add.js");
    } catch (_error) {
      return false;
    }
  }


  function debugLog(message, payload) {
    if (window.LOOPDESK_CART_DRAWER_DEBUG !== true || !window.console) return;
    window.console.debug("[LoopDesk Cart Drawer] " + message, payload || {});
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

  function isNativeCartDrawerActive(drawer) {
    if (!drawer || isLoopDeskOwned(drawer)) return false;
    return drawer.hasAttribute("open") ||
      drawer.getAttribute("aria-hidden") === "false" ||
      NATIVE_CART_DRAWER_OPEN_CLASSES.some(function (className) { return drawer.classList.contains(className); });
  }

  function releaseNativeCartDrawerPageLocks() {
    [document.documentElement, document.body].forEach(function (owner) {
      if (!owner) return;
      CART_BODY_LOCK_CLASSES.forEach(function (className) { owner.classList.remove(className); });
      if (owner.hasAttribute("inert")) owner.removeAttribute("inert");
      if (owner.style && owner.style.overflow === "hidden") owner.style.overflow = "";
    });
  }

  function closeNativeCartDrawers() {
    var nativeDrawerWasActive = false;
    var drawers = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_HOST_SELECTORS.join(",")))
      .filter(function (drawer, index, list) {
        return drawer && !isLoopDeskOwned(drawer) && list.indexOf(drawer) === index;
      });

    drawers.forEach(function (drawer) {
      var wasActive = isNativeCartDrawerActive(drawer);
      nativeDrawerWasActive = nativeDrawerWasActive || wasActive;

      NATIVE_CART_DRAWER_CLOSE_SELECTORS.forEach(function (selector) {
        var closeButton = drawer.querySelector(selector);
        if (closeButton && typeof closeButton.click === "function") closeButton.click();
      });

      NATIVE_CART_DRAWER_OPEN_CLASSES.forEach(function (className) { drawer.classList.remove(className); });
      drawer.removeAttribute("open");
      drawer.setAttribute("aria-hidden", "true");
    });

    if (nativeDrawerWasActive) {
      releaseNativeCartDrawerPageLocks();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      releaseNativeCartDrawerPageLocks();
    }
  }

  function scheduleNativeCartDrawerClosure() {
    closeNativeCartDrawers();
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(closeNativeCartDrawers);
    } else {
      window.setTimeout(closeNativeCartDrawers, 0);
    }
    window.setTimeout(closeNativeCartDrawers, 100);
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

    var trigger = target.closest([
      "a[aria-label*='cart' i]",
      "a[aria-label*='bag' i]",
      "button[aria-label*='cart' i]",
      "button[aria-label*='bag' i]",
      "[role='button'][aria-label*='cart' i]",
      "[role='button'][aria-label*='bag' i]",
      "[class*='cart-icon' i]",
      "[id*='cart-icon' i]",
      "[class*='cart' i]",
      "[id*='cart' i]",
      "[class*='bag' i]",
      "[id*='bag' i]",
    ].join(","));
    if (!trigger || isInsideLoopDeskDrawer(trigger) || isExcludedCartControl(trigger)) return null;

    var text = elementText(trigger);
    if (!/\b(cart|bag)\b|cart-icon/.test(text)) return null;
    return trigger;
  }

  function fallbackToCartPage(trigger) {
    var href = trigger && trigger.getAttribute && trigger.getAttribute("href");
    window.location.href = href && hasCartPath(href) ? href : "/cart";
  }

  function renderLines(cart) {
    if (!cart || !cart.items || cart.items.length === 0) {
      return '<div class="loopdesk-cart-drawer__empty">Your cart is empty.</div>';
    }

    return cart.items.map(function (item) {
      var variant = item.variant_title && item.variant_title !== "Default Title"
        ? '<div class="loopdesk-cart-drawer__variant">' + escapeHtml(item.variant_title) + "</div>"
        : "";
      return [
        '<div class="loopdesk-cart-drawer__line">',
        '<div class="loopdesk-cart-drawer__line-main">',
        '<div class="loopdesk-cart-drawer__title">' + escapeHtml(item.product_title || item.title) + "</div>",
        variant,
        '<div class="loopdesk-cart-drawer__quantity">Qty ' + escapeHtml(item.quantity) + "</div>",
        "</div>",
        '<div class="loopdesk-cart-drawer__price">' + money(item.final_line_price, cart.currency) + "</div>",
        "</div>",
      ].join("");
    }).join("");
  }

  function render() {
    ensureActiveHostElements();
    var cart = state.cart;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;

    if (state.hostMode === THEME_HOST_MODE) {
      if (elements.panel) elements.panel.setAttribute("aria-hidden", "true");
      if (elements.overlay) elements.overlay.hidden = true;
      document.documentElement.classList.remove("loopdesk-cart-drawer-is-open");
      updateThemeBranding(cart);
      return;
    }

    if (!elements.panel) return;
    elements.panel.setAttribute("aria-hidden", state.open ? "false" : "true");
    elements.overlay.hidden = !state.open;
    document.documentElement.classList.toggle("loopdesk-cart-drawer-is-open", state.open);

    elements.body.innerHTML = state.loading
      ? '<div class="loopdesk-cart-drawer__loading">Loading your cart…</div>'
      : state.error
        ? '<div class="loopdesk-cart-drawer__error">We could not load your cart. You can still use the cart page.</div>'
        : renderLines(cart);

    elements.subtotal.textContent = money(cart ? cart.total_price : 0, cart && cart.currency);
    elements.count.textContent = itemCount ? "(" + itemCount + ")" : "";
    elements.express.hidden = !config.expressCheckoutButtonEnabled || itemCount === 0;
    elements.viewCart.hidden = !config.viewCartButtonEnabled;
  }

  function setOpen(open) {
    if (open) acquireHost();
    if (open && state.hostMode === LOOPDESK_HOST_MODE) closeNativeCartDrawers();
    state.open = open;
    render();
    if (open && state.hostMode === LOOPDESK_HOST_MODE) scheduleNativeCartDrawerClosure();
    if (!open) closeThemeHost();
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

  function handleCartIconClick(event) {
    if (!isDrawerAvailable()) return;

    var trigger = findCartTrigger(event.target);
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    fetchCart().then(function () {
      if (state.error) {
        fallbackToCartPage(trigger);
        return;
      }
      setOpen(true);
    }).catch(function () {
      fallbackToCartPage(trigger);
    });
  }

  function shellHtml() {
    return [
      '<div class="loopdesk-cart-drawer__overlay" hidden></div>',
      '<aside class="loopdesk-cart-drawer" aria-hidden="true" aria-label="Cart" role="dialog">',
      '<header class="loopdesk-cart-drawer__header"><div><h2>Your bag <span data-loopdesk-cart-count></span></h2><p>Cart</p></div><button type="button" class="loopdesk-cart-drawer__close" aria-label="Close cart">×</button></header>',
      '<div class="loopdesk-cart-drawer__body"></div>',
      '<footer class="loopdesk-cart-drawer__footer"><div class="loopdesk-cart-drawer__subtotal"><span>Subtotal</span><strong data-loopdesk-cart-subtotal></strong></div><button type="button" class="loopdesk-cart-drawer__express" data-loopdesk-express-checkout>Express Checkout</button><a class="loopdesk-cart-drawer__view-cart" href="/cart">View cart</a></footer>',
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
    };

    if (elements.close) elements.close.addEventListener("click", function () { setOpen(false); });
    if (elements.overlay) elements.overlay.addEventListener("click", function () { setOpen(false); });
    if (elements.express) elements.express.addEventListener("click", function (event) { interceptCheckout(event, "cart-drawer"); });
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
    refreshAndMaybeOpen(false);
  }

  function findThemeHost() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_HOST_SELECTORS.join(",")))
      .filter(function (host, index, list) { return host && !isLoopDeskOwned(host) && list.indexOf(host) === index; });
    return hosts[0] || null;
  }

  function findThemeBody(host) {
    if (!host || isLoopDeskOwned(host)) return null;
    return host.querySelector("[data-loopdesk-cart-host='theme']") ||
      host.querySelector(".cart-drawer__body, .drawer__contents, .drawer__content, .drawer__inner, form[action*='/cart'], [data-cart-drawer-content]") ||
      host;
  }

  function openThemeHost(host) {
    if (!host) return;
    host.setAttribute("open", "");
    host.setAttribute("aria-hidden", "false");
    NATIVE_CART_DRAWER_OPEN_CLASSES.forEach(function (className) { host.classList.add(className); });
  }

  function closeThemeHost() {
    var host = state.themeHost;
    if (!host) return;
    host.removeAttribute("open");
    host.setAttribute("aria-hidden", "true");
    NATIVE_CART_DRAWER_OPEN_CLASSES.forEach(function (className) { host.classList.remove(className); });
  }

  function ensureActiveHostElements() {
    if (state.hostMode !== THEME_HOST_MODE) return;
    var host = state.themeHost;
    if (!host || !document.documentElement.contains(host) || isLoopDeskOwned(host)) {
      fallbackToLoopDeskHost("theme host disappeared or is LoopDesk-owned");
      return;
    }
    openThemeHost(host);
  }

  function fallbackToLoopDeskHost(reason) {
    state.hostMode = LOOPDESK_HOST_MODE;
    state.themeHost = null;
    state.fallbackReason = reason || "theme host unavailable";
    debugLog("fallback reason", { reason: state.fallbackReason });
    var root = getLoopDeskRoot();
    if (root && !root.querySelector(".loopdesk-cart-drawer")) root.innerHTML = shellHtml();
    if (root) bindElements(root);
  }

  function acquireHost() {
    var host = findThemeHost();
    if (!host) {
      fallbackToLoopDeskHost("no compatible theme host detected");
      debugLog("detected host mode", { mode: state.hostMode });
      return;
    }
    state.hostMode = THEME_HOST_MODE;
    state.themeHost = host;
    openThemeHost(host);
    injectThemeBranding(host);
    debugLog("detected host mode", { mode: state.hostMode });
    debugLog("selected host element", { element: host });
  }

  function injectThemeBranding(host) {
    var body = findThemeBody(host);
    if (!body) return;
    var existing = host.querySelector("[data-loopdesk-theme-branding]");
    if (!existing) {
      existing = document.createElement("div");
      existing.setAttribute("data-loopdesk-theme-branding", "");
      existing.className = "loopdesk-cart-drawer__theme-branding";
      existing.textContent = "Secure express checkout available with LoopDesk.";
      body.appendChild(existing);
    }
  }

  function updateThemeBranding(cart) {
    var host = state.themeHost;
    var branding = host && host.querySelector("[data-loopdesk-theme-branding]");
    if (!branding) return;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;
    branding.hidden = itemCount === 0;
  }

  function openExpressCheckout(source) {
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") {
      window.MegaskaExpressCheckout.open({ source: source || "cart-drawer" });
    } else {
      window.location.href = "/apps/megaska/checkout";
    }
  }

  function interceptCheckout(event, source) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    }
    debugLog("checkout interception", { source: source || "cart-drawer" });
    openExpressCheckout(source);
  }

  function activeThemeHostFor(element) {
    if (!element || !element.closest) return null;
    var host = element.closest(THEME_CART_HOST_SELECTORS.join(","));
    if (!host || isLoopDeskOwned(host)) return null;
    return isNativeCartDrawerActive(host) || host === state.themeHost ? host : null;
  }

  function listenForCheckoutIntent() {
    var checkoutSelector = 'a[href="/checkout"], a[href^="/checkout"], button[name="checkout"], input[name="checkout"], .cart__checkout-button, .checkout-button';
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var control = target.closest(checkoutSelector);
      if (!control) return;
      if (isInsideLoopDeskDrawer(control)) return interceptCheckout(event, "cart-drawer");
      var themeHost = activeThemeHostFor(control);
      if (!themeHost) return;
      state.hostMode = THEME_HOST_MODE;
      state.themeHost = themeHost;
      interceptCheckout(event, "theme-cart-drawer");
    }, true);
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form || form.nodeName !== "FORM") return;
      var action = form.getAttribute("action") || "";
      var submitter = event.submitter;
      var isNotCheckoutSubmit = action.indexOf("/checkout") !== 0 && !(submitter && submitter.matches && submitter.matches(checkoutSelector));
      if (isNotCheckoutSubmit) return;
      if (isInsideLoopDeskDrawer(form)) return interceptCheckout(event, "cart-drawer");
      var themeHost = activeThemeHostFor(form);
      if (!themeHost) return;
      state.hostMode = THEME_HOST_MODE;
      state.themeHost = themeHost;
      interceptCheckout(event, "theme-cart-drawer");
    }, true);
  }

  function patchFetch() {
    if (!window.fetch || window.fetch[FETCH_MARKER]) return;
    var originalFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var cartAdd = isCartAddUrl(args[0]);
      return originalFetch.apply(this, args).then(function (response) {
        if (cartAdd && response && response.ok && config.openAfterAddToCart) {
          window.setTimeout(function () { refreshAndMaybeOpen(true); }, 0);
        }
        return response;
      });
    };
    window.fetch[FETCH_MARKER] = true;
  }


  function listenForCartLinks() {
    document.addEventListener("click", handleCartIconClick, true);
  }

  function listenForForms() {
    document.addEventListener("submit", function (event) {
      var form = event.target;
      var action = form.getAttribute("action");
      if (!form || form.nodeName !== "FORM" || !action || !isCartAddUrl(action)) return;
      if (!config.openAfterAddToCart) return;
      window.setTimeout(function () { refreshAndMaybeOpen(true); }, 900);
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
  listenForForms();
  listenForCartLinks();
  listenForCheckoutIntent();
})();
