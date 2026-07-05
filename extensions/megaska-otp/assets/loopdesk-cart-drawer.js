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

  if (!config.enabled || window.__LOOPDESK_CART_DRAWER_LOADED__) return;
  window.__LOOPDESK_CART_DRAWER_LOADED__ = true;

  var state = { open: false, loading: false, cart: null, error: "" };
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
    if (!elements.panel) return;
    var cart = state.cart;
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : 0;
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
    state.open = open;
    render();
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

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = [
      '<div class="loopdesk-cart-drawer__overlay" hidden></div>',
      '<aside class="loopdesk-cart-drawer" aria-hidden="true" aria-label="Cart" role="dialog">',
      '<header class="loopdesk-cart-drawer__header"><div><h2>Your bag <span data-loopdesk-cart-count></span></h2><p>Cart</p></div><button type="button" class="loopdesk-cart-drawer__close" aria-label="Close cart">×</button></header>',
      '<div class="loopdesk-cart-drawer__body"></div>',
      '<footer class="loopdesk-cart-drawer__footer"><div class="loopdesk-cart-drawer__subtotal"><span>Subtotal</span><strong data-loopdesk-cart-subtotal></strong></div><button type="button" class="loopdesk-cart-drawer__express" data-loopdesk-express-checkout>Express Checkout</button><a class="loopdesk-cart-drawer__view-cart" href="/cart">View cart</a></footer>',
      '</aside>',
    ].join("");
    document.body.appendChild(root);

    elements = {
      root: root,
      overlay: root.querySelector(".loopdesk-cart-drawer__overlay"),
      panel: root.querySelector(".loopdesk-cart-drawer"),
      body: root.querySelector(".loopdesk-cart-drawer__body"),
      close: root.querySelector(".loopdesk-cart-drawer__close"),
      subtotal: root.querySelector("[data-loopdesk-cart-subtotal]"),
      count: root.querySelector("[data-loopdesk-cart-count]"),
      express: root.querySelector(".loopdesk-cart-drawer__express"),
      viewCart: root.querySelector(".loopdesk-cart-drawer__view-cart"),
    };

    elements.close.addEventListener("click", function () { setOpen(false); });
    elements.overlay.addEventListener("click", function () { setOpen(false); });
    elements.express.addEventListener("click", function () {
      // TODO: Replace this placeholder with the LoopDesk/Megaska express checkout bridge in the next phase.
      document.dispatchEvent(new CustomEvent("loopdesk:express-checkout:placeholder", { detail: { cart: state.cart } }));
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") setOpen(false); });
    document.addEventListener("loopdesk:cart-drawer:open", function () { refreshAndMaybeOpen(true); });
    refreshAndMaybeOpen(false);
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

  function listenForForms() {
    document.addEventListener("submit", function (event) {
      var form = event.target;
      var action = form.getAttribute("action");
      if (!form || form.nodeName !== "FORM" || !action || !isCartAddUrl(action)) return;
      if (!config.openAfterAddToCart) return;
      window.setTimeout(function () { refreshAndMaybeOpen(true); }, 900);
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  patchFetch();
  listenForForms();
})();
