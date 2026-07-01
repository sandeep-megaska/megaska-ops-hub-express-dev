(function () {
  const root = document.getElementById("megaska-express-checkout-root");
  if (!root) return;

  const API_BASE = String(window.MEGASKA_API_BASE || "/apps/megaska/api").replace(/\/$/, "");
  const SESSION_KEY = "megaska_session_token";

  const state = {
    intentId: new URLSearchParams(window.location.search).get("intent") || "",
    intent: null,
    status: "loading",
    busy: null,
    error: null,
    orderSubmitting: false,
    paymentUpdating: false,
    optimisticPaymentMethod: null,
    selectedDisplayPaymentMethod: null,
    success: null,
    discountCode: "",
    addressEditing: false,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function sanitizePincode(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 6);
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

  class MegaskaApiError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "MegaskaApiError";
      this.status = details?.status || 0;
      this.stage = details?.stage || "";
      this.code = details?.code || "";
    }
  }

  function messageForPlaceOrderError(error) {
    if (paymentMethod() !== "PREPAID" && (typeof payMethod !== "function" || payMethod() !== "PREPAID")) return "We could not place your order right now. Please try again.";
    if (error?.stage === "RAZORPAY_ORDER_CREATE") return error.message || "Could not start secure payment. Please try again.";
    return error instanceof Error ? error.message : "Payment was not completed. You can try again.";
  }

  function razorpayOrderCreateMessage(body) {
    if (body?.message) return body.message;
    if (body?.code === "RAZORPAY_NOT_CONFIGURED") return "Secure payment is not configured for this test store.";
    return "Could not start secure payment. Please try again.";
  }

  async function apiFetch(path, options) {
    const opts = Object.assign({ method: "GET", credentials: "include" }, options || {});
    opts.headers = await buildHeaders(opts.headers);
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);

    const response = await fetch(buildApiUrl(path), opts);
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok === false) {
      if (path.includes("/razorpay-order")) {
        throw new MegaskaApiError(razorpayOrderCreateMessage(data), { status: response.status, stage: data?.stage || "RAZORPAY_ORDER_CREATE", code: data?.code });
      }
      throw new MegaskaApiError(data?.message || data?.error || `Request failed (${response.status})`, { status: response.status, stage: data?.stage, code: data?.code });
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

  function lineVariantTitle(line) {
    const title = line.variant_title || line.variantTitle || line.options_with_values?.map?.((option) => option.value).filter(Boolean).join(" / ") || "";
    return title && title !== "Default Title" ? title : "";
  }

  function lineImage(line) {
    if (line.image) return line.image;
    if (line.featured_image?.url) return line.featured_image.url;
    if (line.featuredImage?.url) return line.featuredImage.url;
    return "";
  }

  function shopLabel() {
    const shop = getCurrentShopDomain();
    if (!shop) return "Megaska";
    return shop.replace(/\.myshopify\.com$/, "").split(/[.-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Megaska";
  }

  function logoMarkup() {
    const logoUrl = window.MEGASKA_SHOP_LOGO_URL || window.MEGASKA_STORE_LOGO_URL || window.MEGASKA_LOGO_URL || "";
    if (logoUrl) return `<img class="megaska-express-logo-img" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(shopLabel())}" loading="lazy">`;
    return `<span class="megaska-express-logo-text">${escapeHtml(shopLabel())}</span>`;
  }

  function discountMeta(discount) {
    const raw = discount?.rawShopifyPayload || {};
    return {
      code: discount?.code || raw.discountCode || discount?.title || "Discount",
      value: raw.discountValue,
      type: raw.discountType,
    };
  }

  function linePricePaise(line) {
    const fallback = Number(line.price || 0) * Number(line.quantity || 1);
    const value = line.line_price ?? line.linePrice ?? line.final_line_price ?? line.pricePaise ?? line.totalAmountPaise ?? fallback;
    return Number(value || 0);
  }

  function addressIsComplete(address) {
    return Boolean(address?.name && address?.address1 && address?.city && address?.province && address?.zip && (address?.phone || state.intent?.phoneSnapshot));
  }

  function addressLine(address) {
    return [address.city, address.province, address.zip].filter(Boolean).join(", ");
  }

  const DISPLAY_PAYMENT_METHODS = [
    { key: "UPI", backendMethod: "PREPAID", label: "UPI", subtitle: "Pay using any UPI app", badge: "Popular", cta: "Pay with UPI", icon: "upi" },
    { key: "CARD", backendMethod: "PREPAID", label: "Debit/Credit Cards", subtitle: "Visa, Mastercard, RuPay & more", cta: "Pay with Card", icon: "card" },
    { key: "WALLET", backendMethod: "PREPAID", label: "Wallets", subtitle: "Amazon Pay, Paytm Wallet & more", cta: "Pay with Wallet", icon: "wallet" },
    { key: "EMI", backendMethod: "PREPAID", label: "EMI", subtitle: "Available on UPI & Cards", cta: "Pay with EMI", icon: "emi" },
    { key: "COD", backendMethod: "COD", label: "Cash on Delivery", subtitle: "Pay when your order is delivered", cta: "Place COD Order", icon: "cod" },
  ];

  function displayMethodForBackend(method) {
    if (method === "COD") return "COD";
    return "UPI";
  }

  function selectedDisplayPaymentMethod() {
    const selected = state.selectedDisplayPaymentMethod || displayMethodForBackend(paymentMethod());
    return DISPLAY_PAYMENT_METHODS.some((method) => method.key === selected) ? selected : "UPI";
  }

  function backendPaymentMethodForDisplay(displayMethod) {
    return DISPLAY_PAYMENT_METHODS.find((method) => method.key === displayMethod)?.backendMethod || "PREPAID";
  }

  function displayPaymentMethodConfig(displayMethod) {
    return DISPLAY_PAYMENT_METHODS.find((method) => method.key === displayMethod) || DISPLAY_PAYMENT_METHODS[0];
  }

  function paymentMethodIcon(name) {
    if (name === "upi") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h7l4 8-4 8H5l4-8-4-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 6l4 6-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (name === "card") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M7 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    if (name === "wallet") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11H6.5A2.5 2.5 0 0 1 4 15.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="14" r=".7" fill="currentColor"/></svg>`;
    if (name === "emi") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h3m3 0h2M8 17h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="6" width="14" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 10h4v5h-4a2.5 2.5 0 0 1 0-5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10h5M8 14h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function paymentMethodRows(selectedMethod, totalLabel) {
    return DISPLAY_PAYMENT_METHODS.map((method) => {
      const selected = method.key === selectedMethod;
      return `<label class="megaska-express-payment-option ${selected ? "is-selected" : ""}">
        <input type="radio" name="paymentMethod" value="${escapeHtml(method.key)}" ${selected ? "checked" : ""}>
        <span class="megaska-express-payment-icon">${paymentMethodIcon(method.icon)}</span>
        <span class="megaska-express-payment-copy"><span class="megaska-express-payment-title"><strong>${escapeHtml(method.label)}</strong>${method.badge ? `<em>${escapeHtml(method.badge)}</em>` : ""}</span><small>${escapeHtml(method.subtitle)}</small></span>
        <span class="megaska-express-payment-amount">${escapeHtml(totalLabel)}</span>
        <span class="megaska-express-payment-status" aria-hidden="true">${selected ? "✓" : "›"}</span>
      </label>`;
    }).join("");
  }

  function closeCheckout() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "MEGASKA_EXPRESS_CHECKOUT_CLOSE" }, "*");
    }
    if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.close === "function") {
      window.MegaskaExpressCheckout.close();
      return;
    }
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  }

  function paymentMethod() {
    return state.optimisticPaymentMethod || state.intent?.selectedPaymentMethod || "PREPAID";
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
    state.addressEditing = !addressIsComplete(state.intent?.addressSnapshots?.[0]);
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
    const selectedDisplayMethod = selectedDisplayPaymentMethod();
    const selectedDisplayConfig = displayPaymentMethodConfig(selectedDisplayMethod);
    const totalLabel = formatMoney(intent.totalAmountPaise, intent.currency);
    const lockedPhone = intent.phoneSnapshot || address.phone || "";
    const addressComplete = addressIsComplete(address);
    const showAddressForm = state.addressEditing || !addressComplete;
    const deliveryAmount = Number(intent.shippingAmountPaise || 0) === 0 ? "Free" : formatMoney(intent.shippingAmountPaise, intent.currency);
    const placeOrderLabel = state.orderSubmitting ? (selectedMethod === "COD" ? "Placing order..." : "Opening secure payment...") : selectedDisplayConfig.cta;

    root.innerHTML = `
      ${state.error ? `<div class="megaska-express-alert" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <div class="megaska-express-checkout-frame" role="dialog" aria-modal="true" aria-label="Express checkout">
        <header class="megaska-express-modal-header">
          <div class="megaska-express-logo">${logoMarkup()}</div>
          <div><p class="megaska-express-eyebrow">Secure Checkout</p><h1>Express Checkout</h1></div>
          <button class="megaska-express-close" data-express-action="close" type="button" aria-label="Close checkout">×</button>
        </header>
        <div class="megaska-express-scroll-area checkout-scroll-area">
          <div class="megaska-express-grid">
            <section class="megaska-express-card megaska-express-summary">
              <h2>Order summary</h2>
              <div class="megaska-express-lines">
                ${lines.length ? lines.map((line) => `
                  <article class="megaska-express-line">
                    ${lineImage(line) ? `<img src="${escapeHtml(lineImage(line))}" alt="${escapeHtml(lineTitle(line))}" loading="lazy">` : `<div class="megaska-express-line-placeholder" aria-hidden="true"></div>`}
                    <div><h3>${escapeHtml(lineTitle(line))}</h3><p>${lineVariantTitle(line) ? `${escapeHtml(lineVariantTitle(line))} • ` : ""}Qty ${escapeHtml(line.quantity || 1)}</p></div>
                    <strong>${formatMoney(linePricePaise(line), intent.currency)}</strong>
                  </article>`).join("") : `<p class="megaska-express-muted">Cart details are unavailable for this intent.</p>`}
              </div>
              <div class="megaska-express-totals">
                <p><span>Subtotal</span><strong>${formatMoney(intent.subtotalAmountPaise, intent.currency)}</strong></p>
                <p><span>Delivery</span><strong>${deliveryAmount}</strong></p>
                ${Number(intent.discountAmountPaise || 0) > 0 && discounts.length ? (() => { const discount = discountMeta(discounts[0]); return `<p><span>Discount: ${escapeHtml(discount.code)}<br><small>You saved ${formatMoney(intent.discountAmountPaise, intent.currency)}</small></span><strong>- ${formatMoney(intent.discountAmountPaise, intent.currency)}</strong></p>`; })() : ""}
                <p class="megaska-express-total"><span>Total</span><strong>${formatMoney(intent.totalAmountPaise, intent.currency)}</strong></p>
              </div>
            </section>

            <section class="megaska-express-card megaska-express-details">
              <div class="megaska-express-section-head"><h2>Delivery address</h2><button type="button" data-express-action="change-address" class="megaska-express-link-btn">Change Address ›</button></div>
              ${addressComplete ? `<article class="megaska-express-address-card">
                <div class="megaska-express-address-icon" aria-hidden="true">⌖</div>
                <div><strong>${escapeHtml(address.name || "")}</strong><p>${escapeHtml(address.address1 || "")}${address.address2 ? `<br>${escapeHtml(address.address2)}` : ""}</p><p>${escapeHtml(addressLine(address))}, ${escapeHtml(address.country || "India")}</p><p>${escapeHtml(lockedPhone)}</p></div>
              </article>` : `<p class="megaska-express-muted">Add your delivery address to continue.</p>`}

              <form data-express-form="address" class="${showAddressForm ? "" : "megaska-express-hidden"}" novalidate>
                <label>Full name<input name="name" value="${escapeHtml(address.name || "")}" autocomplete="name" required></label>
                <label>Email<input name="email" value="${escapeHtml(address.email || "")}" type="email" autocomplete="email"></label>
                <label>Phone<input value="${escapeHtml(lockedPhone)}" disabled aria-describedby="phone-help"><small id="phone-help">Phone is verified and locked.</small></label>
                <label>Address line 1<input name="address1" value="${escapeHtml(address.address1 || "")}" autocomplete="address-line1" required></label>
                <label>Address line 2<input name="address2" value="${escapeHtml(address.address2 || "")}" autocomplete="address-line2"></label>
                <div class="megaska-express-fields"><label>City<input name="city" value="${escapeHtml(address.city || "")}" required></label><label>State<input name="province" value="${escapeHtml(address.province || "")}" required></label></div>
                <div class="megaska-express-fields"><label>PIN code<input name="zip" value="${escapeHtml(address.zip || "")}" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><label>Country<input name="country" value="${escapeHtml(address.country || "India")}"></label></div>
                <button class="megaska-express-btn megaska-express-btn--secondary" type="submit" ${state.busy === "address" ? "disabled" : ""}>${state.busy === "address" ? "Saving..." : "Save address"}</button>
              </form>

              <div class="megaska-express-divider"></div>

              <form data-express-form="discount">
                <h2>Have a coupon?</h2>
                <div class="megaska-express-inline"><input name="code" value="${escapeHtml(state.discountCode)}" placeholder="Enter coupon code"><button class="megaska-express-btn" type="submit" ${state.busy === "discount" ? "disabled" : ""}>Apply</button></div>
                ${discounts.length ? (() => { const discount = discountMeta(discounts[0]); return `<p class="megaska-express-chip"><strong>${escapeHtml(discount.code)} applied</strong> — You saved ${formatMoney(intent.discountAmountPaise, intent.currency)} <button type="button" data-express-action="remove-discount">Remove</button></p>`; })() : ""}
              </form>

              <div class="megaska-express-divider"></div>

              <div class="megaska-express-payment">
                <h2>Choose payment method</h2>
                <p class="megaska-express-payment-intro">Select how you want to pay. Online options open Razorpay securely after you tap Pay.</p>
                <div class="megaska-express-payment-options">${paymentMethodRows(selectedDisplayMethod, totalLabel)}</div>
                ${state.paymentUpdating ? `<p class="megaska-express-note">Updating payment method...</p>` : ""}
                ${state.orderSubmitting ? `<p class="megaska-express-note">Placing your order securely. Please wait...</p>` : ""}
              </div>
            </section>
          </div>
        </div>
        <div class="megaska-express-sticky-bar">
          <div class="megaska-express-sticky-trust"><p><span>🔒</span><strong>100% Secure Payments</strong><small>Your payment details are safe and encrypted.</small></p><p><span>🛡</span><strong>Trusted & Reliable</strong><small>Secured by Razorpay.</small></p></div>
          <div class="megaska-express-sticky-main">
            <div class="megaska-express-sticky-total"><span>Total Payable</span><strong>${formatMoney(intent.totalAmountPaise, intent.currency)}</strong><small>You save ${formatMoney(0, intent.currency)} on delivery</small></div>
            <button class="megaska-express-btn megaska-express-btn--primary megaska-express-place" data-express-action="place-order" type="button" ${state.busy ? "disabled" : ""}>${placeOrderLabel} ›</button>
          </div>
        </div>
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
      zip: sanitizePincode(data.get("zip")),
    };
  }

  async function handleAddressSubmit(form) {
    const payload = getAddressPayload(form);
    if (!/^\d{6}$/.test(payload.zip)) throw new Error("Enter a valid 6-digit PIN code.");
    setBusy("address");
    await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/address`, { method: "POST", body: payload });
    await refreshIntent();
    state.addressEditing = false;
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

  async function setPaymentMethod(displayMethod) {
    const method = backendPaymentMethodForDisplay(displayMethod);
    const previous = paymentMethod();
    const previousDisplay = selectedDisplayPaymentMethod();
    state.selectedDisplayPaymentMethod = displayMethod;
    state.optimisticPaymentMethod = method;
    state.paymentUpdating = true;
    state.error = null;
    render();
    try {
      await ensurePaymentMethod(method);
      state.paymentUpdating = false;
      render();
    } catch (error) {
      state.selectedDisplayPaymentMethod = previousDisplay;
      state.optimisticPaymentMethod = previous;
      state.paymentUpdating = false;
      state.error = error instanceof Error ? error.message : "Could not update payment method. Please try again.";
      render();
    }
  }

  async function ensurePaymentMethod(method) {
    if (state.intent?.selectedPaymentMethod !== method) {
      await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/payment-method`, { method: "POST", body: { method } });
    }
    await refreshIntent();
    state.optimisticPaymentMethod = null;
    if (state.intent?.selectedPaymentMethod !== method) throw new Error("Could not update payment method. Please try again.");
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
    await ensurePaymentMethod("PREPAID");
    await loadRazorpay();
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/razorpay-order`, { method: "POST", body: {} });
    const order = data.razorpayOrder;
    if (!order?.id || !order?.keyId) throw new MegaskaApiError("Could not start secure payment. Please try again.", { stage: "RAZORPAY_ORDER_CREATE", code: "RAZORPAY_ORDER_DETAILS_MISSING" });

    await new Promise((resolve, reject) => {
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || "INR",
        name: shopLabel(),
        description: "Express Checkout",
        order_id: order.id,
        prefill: { name: latestAddress()?.name || "", email: latestAddress()?.email || "", contact: state.intent?.phoneSnapshot || latestAddress()?.phone || "" },
        handler: async function (response) {
          try {
            const verified = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intentId)}/razorpay/verify`, { method: "POST", body: response });
            const name = verified.orderLink?.shopifyOrderName || verified.shopifyOrder?.name || "your order";
            state.status = "success";
            state.success = `${name} has been created. We will send confirmation details shortly.`;
            render();
            resolve();
          } catch (error) { reject(error); }
        },
        modal: { ondismiss: function () { reject(new Error("Payment was not completed. You can try again.")); } },
      });
      checkout.open();
    });
  }

  function logCheckoutSubmitBranch(branch) {
    if (window.console && typeof window.console.info === "function") {
      window.console.info("[Megaska Express] checkout_submit_branch", {
        paymentMethod: paymentMethod(),
        intentStatus: state.intent?.status || null,
        remainingPayable: Number(state.intent?.totalAmountPaise || 0),
        storeCreditApplied: 0,
        branch,
      });
    }
  }

  async function placeOrder() {
    if (state.orderSubmitting) return;
    state.orderSubmitting = true;
    setBusy("order");
    const selectedPaymentMethod = paymentMethod();
    const remainingPayable = Number(state.intent?.totalAmountPaise || 0);
    const branch = remainingPayable <= 0 ? "STORE_CREDIT_ONLY" : (selectedPaymentMethod === "COD" ? "COD" : "RAZORPAY");
    logCheckoutSubmitBranch(branch);
    if (branch === "STORE_CREDIT_ONLY") await createOrder();
    else if (branch === "COD") {
      await ensurePaymentMethod("COD");
      await createOrder();
    } else {
      await handlePrepaid();
    }
  }

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!target.matches('input[name="zip"]')) return;
    const sanitized = sanitizePincode(target.value);
    if (target.value !== sanitized) target.value = sanitized;
    target.setCustomValidity("");
  });

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      if (form.matches('[data-express-form="address"]')) await handleAddressSubmit(form);
      if (form.matches('[data-express-form="discount"]')) await handleDiscountSubmit(form);
    } catch (error) {
      state.busy = null;
      state.orderSubmitting = false;
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
      state.error = "Could not update payment method. Please try again.";
      render();
    }
  });

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action");
    if (!action) return;

    try {
      if (action === "close") {
        closeCheckout();
        return;
      }
      if (action === "change-address") {
        state.addressEditing = true;
        render();
        return;
      }
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
      state.orderSubmitting = false;
      state.error = action === "place-order" ? messageForPlaceOrderError(error) : error instanceof Error ? error.message : "Something went wrong.";
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
