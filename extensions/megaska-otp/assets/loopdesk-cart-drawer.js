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
  var LOOPDESK_HOST_MODE = "NO_THEME_DRAWER";

  var THEME_CART_DRAWER_SELECTORS = [
    "cart-drawer",
    "#CartDrawer",
    "#cart-drawer",
    ".cart-drawer",
    "[data-cart-drawer]",
    "[data-drawer='cart']",
    "#mini-cart",
    ".mini-cart",
    ".ajax-cart",
    "#ajax-cart-container",
    "[data-section-type='cart-drawer']",
    "#cart-sidebar",
    ".cart-sidebar",
    ".drawer--cart",
  ];
  var THEME_CART_DRAWER_OPEN_CLASSES = ["active", "open", "is-open", "menu-opening", "drawer--open"];

  if (!config.enabled || window.__LOOPDESK_CART_DRAWER_LOADED__) return;
  window.__LOOPDESK_CART_DRAWER_LOADED__ = true;

  var state = { open: false, loading: false, cart: null, error: "", hostMode: LOOPDESK_HOST_MODE, themeDrawer: null, fallbackReason: "" };
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

  function detectThemeDrawer() {
    var drawers = Array.prototype.slice.call(document.querySelectorAll(THEME_CART_DRAWER_SELECTORS.join(",")))
      .filter(function (drawer, index, list) { return drawer && !isLoopDeskOwned(drawer) && list.indexOf(drawer) === index; });
    var drawer = drawers[0] || null;
    state.themeDrawer = drawer;
    debugLog("theme drawer detected " + (drawer ? "yes" : "no"), { element: drawer, visible: drawer ? isThemeDrawerVisible(drawer) : false });
    return drawer;
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
    var cart = state.cart;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;


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
    state.hostMode = LOOPDESK_HOST_MODE;
    state.open = open;
    render();
    if (open) debugLog("fallback drawer open", { source: "loopdesk-fallback" });
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

    if (detectThemeDrawer()) {
      debugLog("cart icon mode: theme-pass-through", { trigger: trigger });
      return;
    }

    debugLog("cart icon mode: loopdesk-fallback", { trigger: trigger });
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
    if (elements.express) elements.express.addEventListener("click", function (event) { interceptCheckout(event, "loopdesk-cart-drawer"); });
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

  function openExpressCheckout(source) {
    clearLocalCartDrawerErrors();
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") {
      window.MegaskaExpressCheckout.open({ source: source || "cart-checkout-intercept" });
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

  function listenForCheckoutIntent() {
    var checkoutSelector = 'a[href="/checkout"], a[href^="/checkout"], button[name="checkout"], input[name="checkout"], .cart__checkout-button, .checkout-button';
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var control = target.closest(checkoutSelector);
      if (!control) return;
      interceptCheckout(event, "cart-checkout-intercept");
    }, true);
    document.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form || form.nodeName !== "FORM") return;
      var action = form.getAttribute("action") || "";
      var submitter = event.submitter;
      var actionUrl;
      try { actionUrl = new URL(action, window.location.origin); } catch (_error) { actionUrl = null; }
      var actionIsCheckout = actionUrl ? actionUrl.origin === window.location.origin && actionUrl.pathname.indexOf("/checkout") === 0 : action.indexOf("/checkout") === 0;
      var submitterIsCheckout = Boolean(submitter && submitter.matches && submitter.matches(checkoutSelector));
      if (!actionIsCheckout && !submitterIsCheckout) return;
      interceptCheckout(event, "cart-checkout-intercept");
    }, true);
  }

  function patchFetch() {
    if (!window.fetch || window.fetch[FETCH_MARKER]) return;
    var originalFetch = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var cartAdd = isCartAddUrl(args[0]);
      return originalFetch.apply(this, args).then(function (response) {
        if (cartAdd && response && response.ok && config.openAfterAddToCart && !detectThemeDrawer()) {
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
      if (!form || form.nodeName !== "FORM") return;
      var action = form.getAttribute("action");
      if (!action || !isCartAddUrl(action)) return;
      if (!config.openAfterAddToCart || detectThemeDrawer()) return;
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
