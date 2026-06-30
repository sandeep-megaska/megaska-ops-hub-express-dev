(function () {
  const root = document.getElementById("megaska-bag-root");
  if (!root) return;

  const state = {
    pageStatus: "loading",
    cart: null,
    customer: {
      sessionActive: false,
      profile: null,
      dashboard: null,
    },
    ui: {
      busyLineKey: null,
      busyAction: null,
      errorMessage: null,
    },
  };

  function formatMoneyFromMinor(amountMinor, currency) {
    const amount = Number(amountMinor || 0) / 100;
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currency || "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (_error) {
      return `₹${amount.toFixed(2)}`;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchCart() {
    const res = await fetch("/cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Unable to load cart (${res.status})`);
    }

    return res.json();
  }

  async function changeLineQuantity(lineKey, quantity) {
    return fetch("/cart/change.js", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ id: lineKey, quantity }),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Unable to update quantity (${res.status})`);
      }
      return res.json();
    });
  }

  function removeLine(lineKey) {
    return changeLineQuantity(lineKey, 0);
  }

  async function getSessionToken() {
    try {
      if (window.MegaskaAuth) {
        if (typeof window.MegaskaAuth.getSessionToken === "function") {
          const token = await window.MegaskaAuth.getSessionToken();
          if (token) return String(token).trim();
        }

        if (typeof window.MegaskaAuth.getToken === "function") {
          const token = await window.MegaskaAuth.getToken();
          if (token) return String(token).trim();
        }
      }
    } catch (_error) {}

    try {
      return String(window.localStorage.getItem("megaska_session_token") || "").trim();
    } catch (_error) {
      return "";
    }
  }

  async function getMegaskaSessionState() {
    try {
      if (window.MegaskaAuth && typeof window.MegaskaAuth.fetchSession === "function") {
        const session = await window.MegaskaAuth.fetchSession();
        return {
          authenticated: Boolean(session?.authenticated),
          customer: session?.customer || null,
        };
      }
    } catch (_error) {}

    return {
      authenticated: false,
      customer: null,
    };
  }

  async function detectCustomerSession() {
    const token = await getSessionToken();

    if (!token) {
      state.customer.sessionActive = false;
      state.customer.profile = null;
      state.customer.dashboard = null;
      return;
    }

    state.customer.sessionActive = true;
  }

  function getCheckoutRedirectUrl() {
    return "/checkout";
  }

  function openMegaskaOtpForCheckout() {
    try {
      if (window.MegaskaOtp && typeof window.MegaskaOtp.openModal === "function") {
        window.MegaskaOtp.clearPendingAction?.();
        window.MegaskaOtp.openModal("bag-checkout");
        return true;
      }
    } catch (_error) {}

    return false;
  }

  async function proceedToMegaskaCheckout() {
    const session = await getMegaskaSessionState();
    const fallbackUrl = getCheckoutRedirectUrl();

    if (!session.authenticated) {
      const opened = openMegaskaOtpForCheckout();
      if (opened) return;

      window.location.assign(fallbackUrl);
      return;
    }

    try {
      if (
        window.MegaskaAuth &&
        typeof window.MegaskaAuth.applyCheckoutPrefillToUrl === "function" &&
        typeof window.MegaskaAuth.applyBuyerIdentityToActiveCart === "function"
      ) {
        const prefilledUrl = window.MegaskaAuth.applyCheckoutPrefillToUrl(
          "/checkout",
          session.customer
        );

        const handoff = await window.MegaskaAuth.applyBuyerIdentityToActiveCart(
          session.customer,
          { checkoutUrl: prefilledUrl }
        );

        const finalUrl = handoff?.checkoutUrl || prefilledUrl || fallbackUrl;

        window.location.assign(finalUrl);
        return;
      }
    } catch (_error) {}

    window.location.assign(fallbackUrl);
  }

  function lineVariantText(item) {
    return item?.variant_title && item.variant_title !== "Default Title"
      ? item.variant_title
      : "";
  }

  function getComputedTotals() {
    const subtotalMinor = Number(state.cart?.original_total_price || state.cart?.items_subtotal_price || 0);
    const cartDiscountMinor = Number(state.cart?.total_discount || 0);
    const estimatedTotalMinor = Math.max(Number(state.cart?.total_price || 0), 0);

    return {
      subtotalMinor,
      cartDiscountMinor,
      estimatedTotalMinor,
    };
  }

  function renderLoading() {
    root.innerHTML =
      '<div id="megaska-bag-loading" class="megaska-bag-loading">Loading your bag...</div>';
  }

  function renderError(message) {
    root.innerHTML = `
      <section class="megaska-bag-card">
        <h2>Unable to load your bag</h2>
        <p class="megaska-bag-muted">${escapeHtml(message || "Please try again.")}</p>
        <button class="megaska-bag-btn megaska-bag-btn--primary" data-bag-action="retry-load" type="button">Retry</button>
      </section>
    `;
  }

  function renderItemsSection() {
    const items = Array.isArray(state.cart?.items) ? state.cart.items : [];

    const itemsMarkup = items
      .map((item) => {
        const variant = lineVariantText(item);
        const lineBusy = state.ui.busyLineKey === item.key;

        return `
          <article class="megaska-bag-line" data-line-key="${escapeHtml(item.key)}">
            <img
              class="megaska-bag-line__image"
              src="${escapeHtml(item.image || "")}"
              alt="${escapeHtml(item.product_title)}"
              loading="lazy"
            />
            <div>
              <h3 class="megaska-bag-line__title">${escapeHtml(item.product_title)}</h3>
              ${variant ? `<p class="megaska-bag-line__variant">${escapeHtml(variant)}</p>` : ""}
              <p class="megaska-bag-line__unit">Unit: ${formatMoneyFromMinor(item.price, state.cart.currency)}</p>
              <div class="megaska-bag-line__meta">
                <div class="megaska-bag-qty">
                  <button
                    class="megaska-bag-btn megaska-bag-btn--tiny"
                    type="button"
                    data-bag-action="decrease-qty"
                    ${lineBusy ? "disabled" : ""}
                  >−</button>
                  <span>${Number(item.quantity || 0)}</span>
                  <button
                    class="megaska-bag-btn megaska-bag-btn--tiny"
                    type="button"
                    data-bag-action="increase-qty"
                    ${lineBusy ? "disabled" : ""}
                  >+</button>
                </div>
                <strong>${formatMoneyFromMinor(item.final_line_price || item.line_price, state.cart.currency)}</strong>
              </div>
              <button
                class="megaska-bag-btn megaska-bag-btn--link"
                type="button"
                data-bag-action="remove-line"
                ${lineBusy ? "disabled" : ""}
              >Remove</button>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <section id="bag-items-section" class="megaska-bag-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <h2 style="margin:0;">Items (${items.length})</h2>
          <button class="megaska-bag-btn" type="button" data-bag-action="refresh-bag">Refresh</button>
        </div>
        <div class="megaska-bag-line-list" style="margin-top:12px;">
          ${itemsMarkup}
        </div>
      </section>
      <section class="megaska-bag-reco-placeholder" hidden aria-hidden="true"></section>
    `;
  }

  function renderWalletSection() {
    return `
      <section id="bag-wallet-section" class="megaska-bag-card">
        <h2 style="margin:0 0 8px;">Secure Checkout</h2>
        <p class="megaska-bag-muted">
          Login with your verified mobile number to continue faster checkout.
        </p>
      </section>
    `;
  }

  function renderSummarySection() {
    const totals = getComputedTotals();

    return `
      <section id="bag-summary-section" class="megaska-bag-card">
        <h2 style="margin:0 0 8px;">Order Summary</h2>
        <div class="megaska-bag-row">
          <span>Subtotal</span>
          <strong>${formatMoneyFromMinor(totals.subtotalMinor, state.cart.currency)}</strong>
        </div>
        ${
          totals.cartDiscountMinor > 0
            ? `<div class="megaska-bag-row"><span>Discounts</span><strong>- ${formatMoneyFromMinor(
                totals.cartDiscountMinor,
                state.cart.currency
              )}</strong></div>`
            : ""
        }
        <div class="megaska-bag-row megaska-bag-row--total">
          <span>Estimated total</span>
          <strong>${formatMoneyFromMinor(totals.estimatedTotalMinor, state.cart.currency)}</strong>
        </div>
        <p class="megaska-bag-note">
          Free forward shipping. Taxes included. Any discount code will be applied at checkout.
        </p>
        <button
          class="megaska-bag-btn megaska-bag-btn--primary"
          data-bag-action="checkout"
          type="button"
          style="width:100%;margin-top:10px;"
        >
          Proceed to Checkout
        </button>
      </section>
    `;
  }

  function renderTrustSection() {
    return `
      <section id="bag-trust-section" class="megaska-bag-card">
        <h3 style="margin:0;">Why checkout with confidence</h3>
        <ul class="megaska-bag-trust-list">
          <li>Secure payment and order processing through Shopify checkout.</li>
          <li>Support for eligible exchanges through your Megaska dashboard.</li>
          <li>Built for a better coverage and comfort shopping experience.</li>
        </ul>
      </section>
    `;
  }

  function renderStickyFooter() {
    const totals = getComputedTotals();

    return `
      <section id="bag-sticky-footer">
        <div class="megaska-bag-sticky__inner">
          <div>
            <p class="megaska-bag-muted" style="margin:0;font-size:11px;">Total</p>
            <p class="megaska-bag-sticky__amount" style="margin:0;">
              ${formatMoneyFromMinor(totals.estimatedTotalMinor, state.cart.currency)}
            </p>
          </div>
          <button class="megaska-bag-btn megaska-bag-btn--primary" data-bag-action="checkout" type="button">
            Checkout
          </button>
        </div>
      </section>
    `;
  }

  function renderBagLayout() {
    root.innerHTML = `
      <div class="megaska-bag-layout">
        <div class="megaska-bag-main">
          ${renderItemsSection()}
        </div>
        <aside class="megaska-bag-sidebar">
          ${renderWalletSection()}
          ${renderSummarySection()}
          ${renderTrustSection()}
        </aside>
      </div>
      ${renderStickyFooter()}
    `;
  }

  function renderEmptyState() {
    root.innerHTML = `
      <section class="megaska-bag-card megaska-bag-empty">
        <h2>Your bag is empty</h2>
        <p class="megaska-bag-muted">Looks like you haven't added anything yet.</p>
        <button class="megaska-bag-btn megaska-bag-btn--primary" data-bag-action="continue-shopping" type="button">
          Continue Shopping
        </button>
      </section>
    `;
  }

  function render() {
    if (state.pageStatus === "loading") return renderLoading();
    if (state.pageStatus === "error") {
      return renderError(state.ui.errorMessage || "Please try again.");
    }
    if (state.pageStatus === "empty") return renderEmptyState();
    return renderBagLayout();
  }

  async function reloadCartView() {
    const cart = await fetchCart();
    state.cart = cart;
    state.pageStatus = Array.isArray(cart?.items) && cart.items.length ? "ready" : "empty";
  }

  async function handleLineMutation(lineKey, nextQty, action) {
    if (!lineKey || state.ui.busyLineKey) return;

    state.ui.busyLineKey = lineKey;
    state.ui.busyAction = action;
    render();

    try {
      if (action === "remove") {
        await removeLine(lineKey);
      } else {
        await changeLineQuantity(lineKey, nextQty);
      }

      await reloadCartView();
    } catch (error) {
      state.ui.errorMessage =
        error instanceof Error ? error.message : "Unable to update bag item.";
    } finally {
      state.ui.busyLineKey = null;
      state.ui.busyAction = null;
      render();
    }
  }

  async function handleAction(action, trigger) {
    if (!action) return;

    if (action === "retry-load") {
      await init();
      return;
    }

    if (action === "continue-shopping") {
      window.location.assign("/collections/all");
      return;
    }

    if (action === "refresh-bag") {
      try {
        await reloadCartView();
        render();
      } catch (error) {
        state.pageStatus = "error";
        state.ui.errorMessage =
          error instanceof Error ? error.message : "Unable to refresh bag.";
        render();
      }
      return;
    }

    if (action === "checkout") {
      await proceedToMegaskaCheckout();
      return;
    }

    const lineNode =
      trigger && trigger.closest ? trigger.closest("[data-line-key]") : null;
    const lineKey = lineNode
      ? String(lineNode.getAttribute("data-line-key") || "").trim()
      : "";
    const item = (state.cart?.items || []).find(
      (entry) => String(entry.key) === lineKey
    );

    if (!item) return;

    if (action === "decrease-qty") {
      const nextQty = Math.max(Number(item.quantity || 0) - 1, 0);
      await handleLineMutation(
        lineKey,
        nextQty,
        nextQty <= 0 ? "remove" : "decrease"
      );
      return;
    }

    if (action === "increase-qty") {
      await handleLineMutation(lineKey, Number(item.quantity || 0) + 1, "increase");
      return;
    }

    if (action === "remove-line") {
      await handleLineMutation(lineKey, 0, "remove");
    }
  }

  root.addEventListener("click", function (event) {
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-bag-action]")
        : null;

    if (!target) return;

    const action = String(target.getAttribute("data-bag-action") || "").trim();
    if (!action) return;

    event.preventDefault();
    handleAction(action, target);
  });

  async function init() {
    state.pageStatus = "loading";
    state.ui.errorMessage = null;
    render();

    try {
      await Promise.all([reloadCartView(), detectCustomerSession()]);
      render();
    } catch (error) {
      state.pageStatus = "error";
      state.ui.errorMessage =
        error instanceof Error ? error.message : "Unable to load bag.";
      render();
    }
  }

  window.MegaskaBag = {
    state,
    init,
    fetchCart,
    changeLineQuantity,
    removeLine,
    getCheckoutRedirectUrl,
  };

  init();
})();
