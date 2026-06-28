(function () {
  const root = document.getElementById("megaska-express-checkout-root");
  if (!root) return;

  const API_BASE = "https://megaska-ops-hub-express-dev.vercel.app/api";
  const SESSION_KEY = "megaska_session_token";
  const COD_FEE_NOTE = "COD handling fee: ₹100. This fee will be added only when backend fee support is enabled.";

  const state = {
    intentId: new URLSearchParams(window.location.search).get("intent") || "",
    intent: null,
    status: "loading",
    busy: null,
    error: null,
    success: null,
    discountCode: "",
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeShopDomain(input) {
    return String(input || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .toLowerCase();
  }

  function getCurrentShopDomain() {
    const sources = [
      window.MEGASKA_SHOP_DOMAIN,
      window.Shopify && window.Shopify.shop,
      document.documentElement && document.documentElement.getAttribute("data-shop-domain"),
      document.body && document.body.getAttribute("data-shop-domain"),
    ];

    for (const source of sources) {
      const normalized = normalizeShopDomain(source);
      if (normalized) return normalized;
    }

    const canonicalHref = document.querySelector("link[rel='canonical']")?.getAttribute("href") || "";
    if (canonicalHref) {
      try {
        const canonical = normalizeShopDomain(new URL(canonicalHref, window.location.origin).hostname);
        if (canonical) return canonical;
      } catch (_error) {}
    }

    const host = normalizeShopDomain(window.location.hostname);
    return host.includes(".myshopify.com") ? host : "";
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
      return String(window.localStorage.getItem(SESSION_KEY) || "").trim();
    } catch (_error) {
      return "";
    }
  }

  async function buildHeaders(extraHeaders) {
    const token = await getSessionToken();
    const shopDomain = getCurrentShopDomain();
    const headers = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, extraHeaders || {});

    if (token) headers.Authorization = `Bearer ${token}`;
    if (shopDomain) headers["x-shopify-shop-domain"] = shopDomain;

    return headers;
  }

  function buildApiUrl(path) {
    const url = new URL(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
    const shopDomain = getCurrentShopDomain();
    const token = (() => {
      try { return String(window.localStorage.getItem(SESSION_KEY) || "").trim(); } catch (_error) { return ""; }
    })();

    if (shopDomain) url.searchParams.set("shop", shopDomain);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }

  async function apiFetch(path, options) {
    const opts = Object.assign({ method: "GET" }, options || {});
    opts.headers = await buildHeaders(opts.headers);
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);

    const response = await fetch(buildApiUrl(path), opts);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
    }

    return data;
  }

  function formatMoney(paise, currency) {
    const amount = Number(paise || 0) / 100;
    try {
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(amount);
    } catch (_error) {
      return `₹${amount.toFixed(2)}`;
    }
  }

  function latestAddress() {
    return Array.isArray(state.intent?.addressSnapshots) ? state.intent.addressSnapshots[0] : null;
  }

  function cartLines() {
    const snapshot = state.intent?.cartSnapshot;
    if (Array.isArray(snapshot)) return snapshot;
    if (Array.isArray(snapshot?.items)) return snapshot.items;
    if (Array.isArray(snapshot?.lineItems)) return snapshot.lineItems;
    if (Array.isArray(snapshot?.lines)) return snapshot.lines;
    return [];
  }

  function lineTitle(line) {
    return line.product_title || line.productTitle || line.title || line.name || line.variantTitle || "Item";
  }

  function linePricePaise(line) {
    const fallback = Number(line.price || 0) * Number(line.quantity || 1);
    const value = line.line_price ?? line.linePrice ?? line.final_line_price ?? line.pricePaise ?? line.totalAmountPaise ?? fallback;
    return Number(value || 0);
  }

  function paymentMethod() {
    return state.intent?.selectedPaymentMethod || "PREPAID";
  }

  function setBusy(name) {
    state.busy = name;
    state.error = null;
    render();
  }

  async function refreshIntent() {
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}`);
    state.intent = data.intent;
    state.discountCode = state.intent?.discounts?.[0]?.code || "";
    state.status = "ready";
  }

  function render() {
    if (!state.intentId) {
      root.innerHTML = `<section class="megaska-express-card"><h2>Checkout link is invalid</h2><p class="megaska-express-muted">Missing intent id. Please return to your bag and try again.</p></section>`;
      return;
    }

    if (state.status === "loading") {
      root.innerHTML = `<div class="megaska-express-loading">Loading checkout...</div>`;
      return;
    }

    if (state.status === "success") {
      root.innerHTML = `<section class="megaska-express-card megaska-express-success"><div class="megaska-express-success-icon">✓</div><h2>Order placed successfully</h2><p>${escapeHtml(state.success || "Your order is confirmed.")}</p><a class="megaska-express-btn megaska-express-btn--primary" href="/">Continue shopping</a></section>`;
      return;
    }

    const intent = state.intent || {};
    const address = latestAddress() || {};
    const lines = cartLines();
    const discounts = Array.isArray(intent.discounts) ? intent.discounts : [];
    const selectedMethod = paymentMethod();
    const lockedPhone = intent.phoneSnapshot || address.phone || "";

    root.innerHTML = `
      ${state.error ? `<div class="megaska-express-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="megaska-express-grid">
        <section class="megaska-express-card megaska-express-summary">
          <h2>Order summary</h2>
          <div class="megaska-express-lines">
            ${lines.length ? lines.map((line) => `
              <article class="megaska-express-line">
                ${line.image ? `<img src="${escapeHtml(line.image)}" alt="${escapeHtml(lineTitle(line))}" loading="lazy">` : `<div class="megaska-express-line-placeholder"></div>`}
                <div><h3>${escapeHtml(lineTitle(line))}</h3><p>Qty: ${escapeHtml(line.quantity || 1)}</p></div>
                <strong>${formatMoney(linePricePaise(line), intent.currency)}</strong>
              </article>`).join("") : `<p class="megaska-express-muted">Cart details are unavailable for this intent.</p>`}
          </div>
          <div class="megaska-express-totals">
            <p><span>Subtotal</span><strong>${formatMoney(intent.subtotalAmountPaise, intent.currency)}</strong></p>
            <p><span>Shipping</span><strong>${formatMoney(intent.shippingAmountPaise, intent.currency)}</strong></p>
            <p><span>Discount</span><strong>- ${formatMoney(intent.discountAmountPaise, intent.currency)}</strong></p>
            ${selectedMethod === "COD" ? `<p><span>COD fee</span><strong>${Number(intent.codFeeAmountPaise || 0) > 0 ? formatMoney(intent.codFeeAmountPaise, intent.currency) : "₹100 note"}</strong></p>` : ""}
            <p class="megaska-express-total"><span>Total</span><strong>${formatMoney(intent.totalAmountPaise, intent.currency)}</strong></p>
          </div>
        </section>

        <section class="megaska-express-card">
          <form data-express-form="address">
            <h2>Delivery details</h2>
            <label>Full name<input name="name" value="${escapeHtml(address.name || "")}" autocomplete="name" required></label>
            <label>Email<input name="email" value="${escapeHtml(address.email || "")}" type="email" autocomplete="email"></label>
            <label>Phone<input value="${escapeHtml(lockedPhone)}" disabled aria-describedby="phone-help"><small id="phone-help">Phone is verified and locked.</small></label>
            <label>Address line 1<input name="address1" value="${escapeHtml(address.address1 || "")}" autocomplete="address-line1" required></label>
            <label>Address line 2<input name="address2" value="${escapeHtml(address.address2 || "")}" autocomplete="address-line2"></label>
            <div class="megaska-express-fields"><label>City<input name="city" value="${escapeHtml(address.city || "")}" required></label><label>State<input name="province" value="${escapeHtml(address.province || "")}" required></label></div>
            <div class="megaska-express-fields"><label>PIN code<input name="zip" value="${escapeHtml(address.zip || "")}" required></label><label>Country<input name="country" value="${escapeHtml(address.country || "India")}"></label></div>
            <button class="megaska-express-btn megaska-express-btn--secondary" type="submit" ${state.busy === "address" ? "disabled" : ""}>${state.busy === "address" ? "Saving..." : "Save address"}</button>
          </form>

          <div class="megaska-express-divider"></div>

          <form data-express-form="discount">
            <h2>Discount code</h2>
            <div class="megaska-express-inline"><input name="code" value="${escapeHtml(state.discountCode)}" placeholder="Enter code"><button class="megaska-express-btn" type="submit" ${state.busy === "discount" ? "disabled" : ""}>Apply</button></div>
            ${discounts.length ? `<p class="megaska-express-chip">Applied: ${escapeHtml(discounts[0].code || discounts[0].title || "Discount")} <button type="button" data-express-action="remove-discount">Remove</button></p>` : ""}
          </form>

          <div class="megaska-express-divider"></div>

          <div class="megaska-express-payment">
            <h2>Payment method</h2>
            <label class="megaska-express-radio"><input type="radio" name="paymentMethod" value="PREPAID" ${selectedMethod === "PREPAID" ? "checked" : ""}> <span>PREPAID</span></label>
            <label class="megaska-express-radio"><input type="radio" name="paymentMethod" value="COD" ${selectedMethod === "COD" ? "checked" : ""}> <span>COD</span></label>
            ${selectedMethod === "COD" ? `<p class="megaska-express-note">${COD_FEE_NOTE}</p>` : ""}
            <button class="megaska-express-btn megaska-express-btn--primary megaska-express-place" data-express-action="place-order" type="button" ${state.busy === "order" ? "disabled" : ""}>${state.busy === "order" ? "Processing..." : selectedMethod === "COD" ? "Place COD order" : "Pay now"}</button>
          </div>
        </section>
      </div>`;
  }

  function getAddressPayload(form) {
    const data = new FormData(form);
    return {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim() || null,
      phone: state.intent?.phoneSnapshot || latestAddress()?.phone || "",
      address1: String(data.get("address1") || "").trim(),
      address2: String(data.get("address2") || "").trim() || null,
      city: String(data.get("city") || "").trim(),
      province: String(data.get("province") || "").trim(),
      country: String(data.get("country") || "India").trim() || "India",
      zip: String(data.get("zip") || "").trim(),
    };
  }

  async function handleAddressSubmit(form) {
    setBusy("address");
    await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/address`, { method: "POST", body: getAddressPayload(form) });
    await refreshIntent();
    state.busy = null;
    render();
  }

  async function handleDiscountSubmit(form) {
    const code = String(new FormData(form).get("code") || "").trim();
    if (!code) throw new Error("Enter a discount code.");
    setBusy("discount");
    await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/discount`, { method: "POST", body: { code, discountAmountPaise: 0 } });
    await refreshIntent();
    state.busy = null;
    render();
  }

  async function setPaymentMethod(method) {
    setBusy("payment");
    await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/payment-method`, { method: "POST", body: { method } });
    await refreshIntent();
    state.busy = null;
    render();
  }

  function loadRazorpay() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Unable to load Razorpay Checkout."));
      document.head.appendChild(script);
    });
  }

  async function createOrder() {
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/order`, { method: "POST", body: {} });
    const name = data.orderLink?.shopifyOrderName || data.shopifyOrder?.name || data.orderLink?.orderName || "your order";
    state.status = "success";
    state.success = `${name} has been created. We will send confirmation details shortly.`;
    render();
  }

  async function handlePrepaid() {
    await loadRazorpay();
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/razorpay/order`, { method: "POST", body: {} });
    const order = data.razorpayOrder;
    if (!order?.id || !order?.keyId) throw new Error("Razorpay order details are missing.");

    await new Promise((resolve, reject) => {
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "Megaska",
        description: "Express Checkout",
        order_id: order.id,
        prefill: { name: latestAddress()?.name || "", email: latestAddress()?.email || "", contact: state.intent?.phoneSnapshot || latestAddress()?.phone || "" },
        handler: async function (response) {
          try {
            await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/razorpay/verify`, { method: "POST", body: response });
            await createOrder();
            resolve();
          } catch (error) { reject(error); }
        },
        modal: { ondismiss: function () { reject(new Error("Payment was cancelled.")); } },
      });
      checkout.open();
    });
  }

  async function placeOrder() {
    setBusy("order");
    if (paymentMethod() === "COD") await createOrder();
    else await handlePrepaid();
  }

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      if (form.matches('[data-express-form="address"]')) await handleAddressSubmit(form);
      if (form.matches('[data-express-form="discount"]')) await handleDiscountSubmit(form);
    } catch (error) {
      state.busy = null;
      state.error = error instanceof Error ? error.message : "Something went wrong.";
      render();
    }
  });

  root.addEventListener("change", async (event) => {
    const target = event.target;
    if (!target.matches('input[name="paymentMethod"]')) return;
    try {
      await setPaymentMethod(target.value);
    } catch (error) {
      state.busy = null;
      state.error = error instanceof Error ? error.message : "Unable to update payment method.";
      render();
    }
  });

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action");
    if (!action) return;

    try {
      if (action === "remove-discount") {
        setBusy("discount");
        await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/discount`, { method: "DELETE" });
        await refreshIntent();
        state.busy = null;
        render();
      }
      if (action === "place-order") await placeOrder();
    } catch (error) {
      state.busy = null;
      state.error = error instanceof Error ? error.message : "Something went wrong.";
      render();
    }
  });

  refreshIntent()
    .then(() => render())
    .catch((error) => {
      state.status = "ready";
      state.error = error instanceof Error ? error.message : "Unable to load checkout.";
      render();
    });
})();
