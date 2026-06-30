(function () {
  const SESSION_KEY = "megaska_session_token";
  const APP_PROXY_API_BASE = "/apps/megaska/api";
  const PAGE_FALLBACK_URL = "/apps/megaska/checkout";
  const TRIGGER_SELECTOR = "[data-megaska-express-checkout], [data-bag-action='checkout']";
  const DEBUG = /(?:^|[?&])megaska_debug=1(?:&|$)/.test(window.location.search) || window.MEGASKA_DEBUG === true;

  const state = {
    open: false,
    step: "idle",
    intent: null,
    customer: null,
    busy: false,
    paymentStarted: false,
    orderSubmitting: false,
    paymentUpdating: false,
    selectedDisplayPaymentMethod: "UPI",
    error: "",
    discountCode: "",
    discountMessage: "",
    addressDraft: {},
    editingAddress: false,
    customerDefaultAddress: null,
    settings: { codFeeAmountPaise: 10000, codInformationText: "You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as Megaska store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method." },
    pincode: "",
    pincodeStatus: "idle",
    pincodeMessage: "Enter 6-digit PIN code to check delivery.",
    pincodeEta: "",
    pincodeCity: "",
    pincodeState: "",
    lastCheckedPincode: "",
    pincodeCache: {},
    pincodeTimer: null,
    savedPincode: "",
    savedPincodeStatus: "idle",
    savedPincodeMessage: "",
    savedPincodeEta: "",
    lastCheckedSavedPincode: "",
    perf: { openStart: 0, shellPaintLogged: false, checkoutPaintLogged: false, apiCalls: {}, duplicateCallsFound: false },
    hydration: { session: "idle", cart: "idle", intent: "idle", address: "idle", discount: "idle", pincode: "idle", payment: "idle" },
  };

  function debugLog(message, payload) {
    if (DEBUG) console.log(`[Megaska Express Modal] ${message}`, payload || {});
  }

  function perfNow() {
    return window.performance && typeof window.performance.now === "function" ? window.performance.now() : Date.now();
  }

  function perfLog(label, value) {
    if (typeof value === "number") console.log(`[EXPRESS MODAL PERF] ${label}`, Math.round(value));
    else console.log(`[EXPRESS MODAL PERF] ${label}`, value || "");
  }

  function perfDetails(label, details) {
    console.log(`[EXPRESS MODAL PERF] ${label}`, details || {});
  }

  function resetApiCallPerf(openStart) {
    state.perf = { openStart, shellPaintLogged: false, checkoutPaintLogged: false, apiCalls: {}, duplicateCallsFound: false };
  }

  function trackApiCall(method, url) {
    const parsed = new URL(url, window.location.origin);
    const path = `${method.toUpperCase()} ${parsed.pathname}`;
    state.perf.apiCalls[path] = (state.perf.apiCalls[path] || 0) + 1;
    if (state.perf.apiCalls[path] > 1 || parsed.pathname.startsWith("/api/")) state.perf.duplicateCallsFound = true;
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(resolve);
      else window.setTimeout(resolve, 0);
    });
  }

  async function waitForModalShellPaint(openStart) {
    await nextAnimationFrame();
    await nextAnimationFrame();
    if (!state.perf.shellPaintLogged && state.open) {
      state.perf.shellPaintLogged = true;
      perfLog("modal_shell_open_ms", perfNow() - openStart);
    }
    if (!state.perf.checkoutPaintLogged && state.open && state.step === "checkout") {
      state.perf.checkoutPaintLogged = true;
      perfLog("first_checkout_layout_paint_ms", perfNow() - openStart);
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function normalizeShopDomain(input) {
    return String(input || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  }

  function getShopDomain() {
    const sources = [window.MEGASKA_SHOP_DOMAIN, window.Shopify && window.Shopify.shop, document.documentElement.getAttribute("data-shop-domain"), document.body && document.body.getAttribute("data-shop-domain")];
    for (const source of sources) {
      const normalized = normalizeShopDomain(source);
      if (normalized) return normalized;
    }
    return normalizeShopDomain(window.location.hostname).includes(".myshopify.com") ? normalizeShopDomain(window.location.hostname) : "";
  }

  function getApiBase() {
    const configured = String(window.MEGASKA_API_BASE || APP_PROXY_API_BASE).replace(/\/$/, "");
    if (configured && configured !== APP_PROXY_API_BASE && DEBUG) {
      debugLog("ignoring non-canonical storefront API base", { configured, canonical: APP_PROXY_API_BASE });
    }
    return APP_PROXY_API_BASE;
  }

  async function getToken() {
    try {
      if (window.MegaskaAuth?.getSessionToken) return String((await window.MegaskaAuth.getSessionToken()) || "").trim();
      if (window.MegaskaAuth?.getToken) return String((await window.MegaskaAuth.getToken()) || "").trim();
    } catch {}
    try { return String(localStorage.getItem(SESSION_KEY) || "").trim(); } catch { return ""; }
  }

  class MegaskaApiError extends Error {
    constructor(message, details) { super(message); this.name = "MegaskaApiError"; this.status = details?.status || 0; this.stage = details?.stage || ""; this.code = details?.code || ""; }
  }

  function prepaidPlaceOrderMessage(error) {
    if (error?.stage === "RAZORPAY_ORDER_CREATE") return error.message || "Could not start secure payment. Please try again.";
    return error instanceof Error ? error.message : "Payment was not completed. You can try again.";
  }

  function razorpayOrderCreateMessage(body) {
    if (body?.message) return body.message;
    if (body?.code === "RAZORPAY_NOT_CONFIGURED") return "Secure payment is not configured for this test store.";
    return "Could not start secure payment. Please try again.";
  }

  async function apiFetch(path, options) {
    const token = await getToken();
    const shop = getShopDomain();
    const url = new URL(`${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`, window.location.origin);
    if (shop) url.searchParams.set("shop", shop);
    if (token) url.searchParams.set("token", token);
    const headers = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, options?.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    if (shop) headers["x-shopify-shop-domain"] = shop;
    const opts = Object.assign({ method: "GET", credentials: "include" }, options || {}, { headers });
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
    trackApiCall(opts.method || "GET", url.toString());
    const res = await fetch(url.toString(), opts);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      if (path.includes("/razorpay-order")) throw new MegaskaApiError(razorpayOrderCreateMessage(data), { status: res.status, stage: data?.stage || "RAZORPAY_ORDER_CREATE", code: data?.code });
      throw new MegaskaApiError(data?.message || data?.error || `Request failed (${res.status})`, { status: res.status, stage: data?.stage, code: data?.code });
    }
    return data;
  }


  function normalizePincodeResponse(payload, pincode) {
    const body = payload && typeof payload === "object" ? payload : {};
    const city = String(body.city || body.district || "").trim();
    const province = String(body.state || body.stateName || body.province || body.stateCode || "").trim();
    const eta = body.estimatedDeliveryDate || body.eta || body.edd || body.deliveryDate || body.estimatedDate || "";
    const serviceable = body.serviceable === true || body.isServiceable === true || body.ok === true && body.serviceable !== false && body.isServiceable !== false;
    return {
      ok: body.ok !== false,
      serviceable,
      pincode: String(body.pincode || body.postalCode || body.pin || pincode || "").trim(),
      city,
      province,
      eta: String(eta || "").trim(),
      message: String(body.error || body.message || "").trim(),
    };
  }

  function formatEta(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date); } catch (_error) { return String(value); }
  }

  function pincodeDeliveryMessage(result) {
    if (!result?.eta) return "Delivery available";
    return `Delivery available • Estimated delivery: ${formatEta(result.eta)}`;
  }

  function setPincodeState(status, message, details) {
    state.pincodeStatus = status;
    state.pincodeMessage = message;
    state.pincodeEta = details?.eta || "";
    state.pincodeCity = details?.city || "";
    state.pincodeState = details?.province || "";
    const modal = ensureModal();
    const messageEl = modal.querySelector("[data-express-pincode-message]");
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.setAttribute("data-status", status);
    }
    const etaEl = modal.querySelector("[data-express-pincode-eta]");
    if (etaEl) etaEl.textContent = state.pincodeEta ? `Estimated delivery by ${formatEta(state.pincodeEta)}` : "";
  }

  function setSavedPincodeState(status, message, details) {
    state.savedPincodeStatus = status;
    state.savedPincodeMessage = message;
    state.savedPincodeEta = details?.eta || "";
    const statusEl = ensureModal().querySelector("[data-express-saved-pincode-message]");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.setAttribute("data-status", status);
    } else if (state.open) {
      render();
    }
  }

  function applyPincodeResult(result) {
    state.lastCheckedPincode = result.pincode || state.pincode;
    if (result.serviceable) {
      if (result.city) state.addressDraft.city = result.city;
      if (result.province) state.addressDraft.province = result.province;
      setPincodeState("serviceable", result.eta ? "Delivery available" : "Delivery available for this PIN code.", result);
      const modal = ensureModal();
      const cityInput = modal.querySelector('[name="city"]');
      const provinceInput = modal.querySelector('[name="province"]');
      if (cityInput && result.city) { cityInput.value = result.city; cityInput.setCustomValidity(""); }
      if (provinceInput && result.province) { provinceInput.value = result.province; provinceInput.setCustomValidity(""); }
      return;
    }
    setPincodeState("unserviceable", "Delivery is not available for this PIN code.", {});
  }


  function applySavedPincodeResult(result) {
    state.lastCheckedSavedPincode = result.pincode || state.savedPincode;
    if (result.serviceable) {
      setSavedPincodeState("serviceable", `✅ ${pincodeDeliveryMessage(result)}`, result);
      console.log("[EXPRESS PINCODE] saved_address_check_success");
      return;
    }
    setSavedPincodeState("unserviceable", "⚠ Delivery may not be available for this PIN code", {});
    console.log("[EXPRESS PINCODE] saved_address_check_success");
  }

  async function checkSavedAddressPincode(pincode) {
    if (state.pincodeCache[pincode]) { applySavedPincodeResult(state.pincodeCache[pincode]); return; }
    if (state.lastCheckedSavedPincode === pincode && ["serviceable", "unserviceable", "error"].includes(state.savedPincodeStatus)) return;
    state.lastCheckedSavedPincode = pincode;
    setSavedPincodeState("checking", "Checking delivery availability...", {});
    console.log("[EXPRESS PINCODE] saved_address_check_start");
    try {
      const result = normalizePincodeResponse(await apiFetch(`/delhivery/pincode?pincode=${encodeURIComponent(pincode)}`), pincode);
      state.pincodeCache[pincode] = result;
      if (state.savedPincode !== pincode) return;
      applySavedPincodeResult(result);
    } catch (_error) {
      setSavedPincodeState("error", "Could not verify delivery availability right now.", {});
      console.log("[EXPRESS PINCODE] saved_address_check_failed");
    }
  }

  function scheduleSavedAddressPincodeCheck(rawValue) {
    const pincode = sanitizePincode(rawValue);
    state.savedPincode = pincode;
    if (!/^\d{6}$/.test(pincode)) { setSavedPincodeState("idle", "", {}); return; }
    if (state.pincodeCache[pincode]) { applySavedPincodeResult(state.pincodeCache[pincode]); return; }
    if (state.lastCheckedSavedPincode === pincode && ["checking", "serviceable", "unserviceable", "error"].includes(state.savedPincodeStatus)) return;
    window.setTimeout(() => checkSavedAddressPincode(pincode), 0);
  }

  async function checkPincode(pincode) {
    if (state.pincodeCache[pincode]) { applyPincodeResult(state.pincodeCache[pincode]); return; }
    if (state.lastCheckedPincode === pincode && state.pincodeStatus === "serviceable") return;
    state.lastCheckedPincode = pincode;
    setPincodeState("checking", "Checking delivery...", {});
    try {
      const result = normalizePincodeResponse(await apiFetch(`/delhivery/pincode?pincode=${encodeURIComponent(pincode)}`), pincode);
      state.pincodeCache[pincode] = result;
      if (state.pincode !== pincode) return;
      applyPincodeResult(result);
    } catch (_error) {
      setPincodeState("error", "Unable to check delivery right now. Please try again.", {});
    }
  }

  function schedulePincodeCheck(rawValue) {
    const pincode = sanitizePincode(rawValue);
    state.pincode = pincode;
    state.addressDraft.zip = pincode;
    if (state.pincodeTimer) clearTimeout(state.pincodeTimer);
    if (!pincode) { state.lastCheckedPincode = ""; setPincodeState("idle", "Enter 6-digit PIN code to check delivery.", {}); return; }
    if (pincode.length < 6) { state.lastCheckedPincode = ""; setPincodeState("idle", "Enter 6-digit PIN code to check delivery.", {}); return; }
    if (!/^\d{6}$/.test(pincode)) { state.lastCheckedPincode = ""; setPincodeState("idle", "Enter a valid 6-digit PIN code.", {}); return; }
    if (state.pincodeCache[pincode]) { applyPincodeResult(state.pincodeCache[pincode]); return; }
    state.pincodeTimer = setTimeout(() => checkPincode(pincode), 300);
  }

  function money(paise, currency) {
    const amount = Number(paise || 0) / 100;
    try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(amount); } catch (_error) { return `₹${amount.toFixed(2)}`; }
  }

  async function readCart() {
    const res = await fetch("/cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Unable to load cart (${res.status})`);
    return res.json();
  }

  function variantGid(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("gid://shopify/ProductVariant/")) return raw;
    const numeric = raw.replace(/\D/g, "");
    return numeric ? `gid://shopify/ProductVariant/${numeric}` : "";
  }

  function cartLineItem(item) {
    const variantId = variantGid(item?.variant_id || item?.variantId || item?.id);
    const quantity = Math.max(0, Math.floor(Number(item?.quantity || 0)));
    if (!variantId || quantity <= 0) return null;
    return {
      variantId,
      quantity,
      title: item?.product_title || item?.title || "Item",
      variantTitle: item?.variant_title || item?.variantTitle || "",
      sku: item?.sku || "",
      price: Number(item?.price || item?.final_price || 0),
      line_price: Number(item?.original_line_price || item?.line_price || item?.final_line_price || 0),
      original_line_price: Number(item?.original_line_price || item?.line_price || item?.final_line_price || 0),
      final_line_price: Number(item?.final_line_price || item?.line_price || 0),
      image: item?.image || item?.featured_image?.url || "",
    };
  }

  function cartSnapshot(cart) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const lineItems = items.map(cartLineItem).filter(Boolean);
    return { token: cart?.token || "", items, lineItems, item_count: Number(cart?.item_count || 0), total_price: Number(cart?.total_price || 0), original_total_price: Number(cart?.original_total_price || 0), items_subtotal_price: Number(cart?.items_subtotal_price || 0), total_discount: Number(cart?.total_discount || 0), cart_level_discount_applications: cart?.cart_level_discount_applications || [], discount_codes: cart?.discount_codes || [], currency: cart?.currency || "INR" };
  }

  async function ensureAuthenticated(triggerEl, event) {
    const startedAt = perfNow();
    const session = window.MegaskaAuth?.fetchSession ? await window.MegaskaAuth.fetchSession() : { authenticated: Boolean(await getToken()) };
    perfDetails("session_init_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - startedAt) });
    if (session?.authenticated) {
      state.customer = session.customer || null;
      return true;
    }
    if (window.MegaskaOtp?.ensureMegaskaAuthenticatedBeforeCheckout) {
      return window.MegaskaOtp.ensureMegaskaAuthenticatedBeforeCheckout({
        event,
        triggerEl,
        pendingAction: { type: "callback", callback: () => open({ triggerEl }) },
      });
    }
    if (window.MegaskaOtp?.openModal) window.MegaskaOtp.openModal("express-checkout");
    return false;
  }

  function ensureModal() {
    let modal = document.querySelector("[data-megaska-express-modal]");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "megaska-otp-modal megaska-express-modal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.setAttribute("data-megaska-express-modal", "1");
    modal.innerHTML = `<div class="megaska-otp-backdrop"></div><div class="megaska-otp-dialog megaska-express-dialog" role="dialog" aria-modal="true" aria-labelledby="megaska-express-title"><button class="megaska-otp-close" type="button" data-express-close aria-label="Close">&times;</button><div class="megaska-otp-flow megaska-express-scroll-area"><div data-express-root></div></div></div>`;
    const handleCloseIntent = (event) => {
      const closeButton = event.target.closest("button[data-express-close]");
      if (!closeButton) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    modal.addEventListener("click", handleCloseIntent);
    modal.addEventListener("touchstart", handleCloseIntent, { passive: false });
    modal.addEventListener("submit", onSubmit);
    modal.addEventListener("change", onChange);
    modal.addEventListener("input", onInput);
    modal.addEventListener("click", onActionClick);
    document.body.appendChild(modal);
    return modal;
  }

  function close() {
    if (state.paymentStarted || state.busy) return;
    const modal = ensureModal();
    state.open = false;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("megaska-otp-open");
  }

  function address() { return Array.isArray(state.intent?.addressSnapshots) ? state.intent.addressSnapshots[0] || {} : state.customerDefaultAddress || {}; }
  function sanitizePincode(value) { return String(value || "").replace(/\D/g, "").slice(0, 6); }
  function hasCompleteAddress(value) { return Boolean(value?.name && value?.phone && value?.address1 && value?.city && /^\d{6}$/.test(String(value?.zip || "").trim()) && value?.country); }
  function selectedDiscount(intent) { return Array.isArray(intent?.discounts) ? intent.discounts[0] || null : null; }
  function lines() { return Array.isArray(state.intent?.cartSnapshot?.lineItems) ? state.intent.cartSnapshot.lineItems : Array.isArray(state.intent?.cartSnapshot?.items) ? state.intent.cartSnapshot.items : []; }
  function checkoutReady() { return Boolean(state.intent?.id) && state.hydration.session === "ready" && state.hydration.intent === "ready"; }
  function payMethod() { return state.optimisticPaymentMethod || state.intent?.selectedPaymentMethod || "PREPAID"; }
  function lineTitle(line) { return line?.product_title || line?.productTitle || line?.title || line?.name || "Item"; }
  function lineVariant(line) { const title = line?.variant_title || line?.variantTitle || ""; return title && title !== "Default Title" ? title : ""; }
  function lineImage(line) { return line?.image || line?.featured_image?.url || line?.featuredImage?.url || ""; }
  function linePrice(line) { return line?.original_line_price ?? line?.originalLinePrice ?? line?.line_price ?? line?.linePrice ?? line?.final_line_price ?? line?.price ?? 0; }
  function cartSubtotalPaise(cart) { return Number(cart?.original_total_price || cart?.items_subtotal_price || cart?.total_price || 0); }
  function cartDiscountPaise(cart) { return Number(cart?.total_discount || 0); }
  function cartTotalPaise(cart) { return Math.max(Number(cart?.total_price || 0), 0); }
  function shopLabel() { const shop = String(window.MEGASKA_SHOP_DOMAIN || window.Shopify?.shop || location.hostname || "").replace(/\.myshopify\.com$/, ""); return shop ? shop.split(/[.-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Megaska"; }
  function logoMarkup() { const src = window.MEGASKA_SHOP_LOGO_URL || window.MEGASKA_STORE_LOGO_URL || window.MEGASKA_LOGO_URL || ""; return src ? `<img class="megaska-express-logo-img" src="${escapeHtml(src)}" alt="${escapeHtml(shopLabel())}" loading="lazy">` : `<span class="megaska-express-logo-text">${escapeHtml(shopLabel())}</span>`; }
  function discountSummary(intent) { const discount = selectedDiscount(intent); if (!discount || !Number(intent?.discountAmountPaise || 0)) return ""; const raw = discount.rawShopifyPayload || {}; const code = discount.code || raw.discountCode || discount.title || "Discount"; return `<p><span>Discount<br><small>${escapeHtml(code)} applied</small></span><strong>- ${money(intent.discountAmountPaise, intent.currency)}</strong></p>`; }
  function payableAmount(method) { const total = Number(state.intent?.totalAmountPaise || 0); const codFee = method === "COD" ? Number(state.settings?.codFeeAmountPaise || state.intent?.codFeeAmountPaise || 0) : 0; return Math.max(0, total + codFee); }

  const PAYMENT_LOGO_MARKS = [
    { key: "upi", label: "UPI", markup: `<svg viewBox="0 0 54 20" aria-hidden="true" focusable="false"><path d="M4 2h12l5 8-5 8H4l5-8-5-8Z" fill="#0f9d58"/><path d="M15 2h12l5 8-5 8H15l5-8-5-8Z" fill="#f57c00"/><text x="32" y="14" fill="#17324d" font-size="11" font-weight="900" font-family="Arial, sans-serif">UPI</text></svg>` },
    { key: "visa", label: "Visa", markup: `<svg viewBox="0 0 58 20" aria-hidden="true" focusable="false"><text x="4" y="15" fill="#1a1f71" font-size="17" font-weight="900" font-style="italic" font-family="Arial Black, Arial, sans-serif">VISA</text></svg>` },
    { key: "mastercard", label: "Mastercard", markup: `<svg viewBox="0 0 58 20" aria-hidden="true" focusable="false"><circle cx="23" cy="10" r="8" fill="#eb001b"/><circle cx="35" cy="10" r="8" fill="#f79e1b" fill-opacity=".92"/><path d="M29 3.9a8 8 0 0 1 0 12.2 8 8 0 0 1 0-12.2Z" fill="#ff5f00"/></svg>` },
    { key: "rupay", label: "RuPay", markup: `<svg viewBox="0 0 62 20" aria-hidden="true" focusable="false"><text x="4" y="14" fill="#123c7c" font-size="13" font-weight="900" font-family="Arial, sans-serif">RuPay</text><path d="M49 3h6l-4 14h-6l4-14Z" fill="#f58220"/><path d="M43 3h6l-4 14h-6l4-14Z" fill="#00a859"/></svg>` },
    { key: "netbanking", label: "Net Banking", markup: `<svg viewBox="0 0 86 20" aria-hidden="true" focusable="false"><path d="M7 8h18L16 3 7 8Zm2 2h14v7H9v-7Zm-2 7h18" fill="none" stroke="#1e40af" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><text x="31" y="14" fill="#0f172a" font-size="10" font-weight="800" font-family="Arial, sans-serif">Net Banking</text></svg>` },
  ];

  function paymentLogoCard(item) {
    return `<span class="megaska-express-pay-logo-card megaska-express-pay-logo-card--${item.key}" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}">${item.markup}</span>`;
  }

  function paymentLogoIcons() {
    return PAYMENT_LOGO_MARKS.map(paymentLogoCard).concat('<span class="megaska-express-pay-logo-card megaska-express-pay-more" aria-label="More payment methods">+ More</span>').join("");
  }

  function codLogoCard() {
    return `<span class="megaska-express-cod-logo-card" aria-hidden="true"><svg viewBox="0 0 36 24" focusable="false"><rect x="3" y="5" width="26" height="16" rx="4" fill="#dcfce7" stroke="#22c55e" stroke-width="2"/><path d="M24 10h8v6h-8a3 3 0 0 1 0-6Z" fill="#16a34a"/><circle cx="25" cy="13" r="1.6" fill="#fff"/><path d="M10 12h8m-6-3h8m-10 6h7" stroke="#15803d" stroke-width="1.7" stroke-linecap="round"/></svg><strong>COD</strong></span>`;
  }


  const DISPLAY_PAYMENT_METHODS = [
    { key: "UPI", backendMethod: "PREPAID", label: "UPI", subtitle: "Pay using any UPI app", badge: "Popular", cta: "Pay with UPI", icon: "upi" },
    { key: "CARD", backendMethod: "PREPAID", label: "Debit/Credit Cards", subtitle: "Visa, Mastercard, RuPay & more", cta: "Pay with Card", icon: "card" },
    { key: "WALLET", backendMethod: "PREPAID", label: "Wallets", subtitle: "Amazon Pay, Paytm Wallet & more", cta: "Pay with Wallet", icon: "wallet" },
    { key: "EMI", backendMethod: "PREPAID", label: "0% EMI on UPI & Cards", subtitle: "No-cost plans on eligible payments", cta: "Pay with EMI", icon: "emi" },
    { key: "NETBANKING", backendMethod: "PREPAID", label: "Netbanking", subtitle: "All major banks supported", cta: "Pay with Netbanking", icon: "netbanking" },
    { key: "COD", backendMethod: "COD", label: "Cash on Delivery", subtitle: "Pay when your order is delivered", cta: "Place COD Order", icon: "cod" },
  ];

  function displayMethodForBackend(method) {
    if (method === "COD") return "COD";
    return "UPI";
  }

  function selectedDisplayPaymentMethod() {
    const selected = state.selectedDisplayPaymentMethod || displayMethodForBackend(payMethod());
    return DISPLAY_PAYMENT_METHODS.some((method) => method.key === selected) ? selected : "UPI";
  }

  function backendPaymentMethodForDisplay(displayMethod) {
    return DISPLAY_PAYMENT_METHODS.find((method) => method.key === displayMethod)?.backendMethod || "PREPAID";
  }

  function displayPaymentMethodConfig(displayMethod) {
    return DISPLAY_PAYMENT_METHODS.find((method) => method.key === displayMethod) || DISPLAY_PAYMENT_METHODS[0];
  }

  function razorpayInstrumentForDisplayMethod(selectedDisplayPaymentMethod) {
    const method = String(selectedDisplayPaymentMethod || "").toUpperCase();
    if (method === "UPI") return { method: "upi" };
    if (method === "CARD") return { method: "card" };
    if (method === "WALLET") return { method: "wallet" };
    if (method === "NETBANKING") return { method: "netbanking" };
    if (method === "EMI") return { method: "emi" };
    return null;
  }

  function buildRazorpayDisplayConfig(selectedDisplayPaymentMethod) {
    const instrument = razorpayInstrumentForDisplayMethod(selectedDisplayPaymentMethod);
    if (!instrument) return null;
    return {
      blocks: {
        selected_method: {
          name: "Pay using selected method",
          instruments: [instrument],
        },
      },
      sequence: ["block.selected_method"],
      preferences: {
        show_default_blocks: false,
      },
    };
  }

  function logRazorpayDisplayConfig(selectedDisplayMethod, razorpayMethod, options) {
    if (window.console && typeof window.console.debug === "function") {
      window.console.debug("[Megaska Express] Razorpay display config", {
        selectedDisplayMethod,
        razorpayMethod,
        displayConfigApplied: Boolean(options.display),
      });
    }
  }

  function paymentMethodIcon(name) {
    if (name === "upi") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h7l4 8-4 8H5l4-8-4-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 6l4 6-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (name === "card") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M7 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    if (name === "wallet") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11H6.5A2.5 2.5 0 0 1 4 15.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="14" r=".7" fill="currentColor"/></svg>`;
    if (name === "emi") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h3m3 0h2M8 17h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    if (name === "netbanking") return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10h16L12 5 4 10Zm2 2h12v7H6v-7Zm-2 7h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="6" width="14" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 10h4v5h-4a2.5 2.5 0 0 1 0-5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10h5M8 14h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  function upiExpandedPanel(totalLabel) {
    const apps = ["Paytm", "PhonePe", "GPay", "Amazon Pay", "BHIM"];
    return `<div class="megaska-express-upi-panel">
      <div class="megaska-express-upi-qr" aria-hidden="true"><span></span></div>
      <div class="megaska-express-upi-details"><strong>Scan the QR using any UPI App</strong><p>Payable amount: ${escapeHtml(totalLabel)}</p><div class="megaska-express-upi-apps">${apps.map((app) => `<span>${escapeHtml(app)}</span>`).join("")}</div><small>🔒 Razorpay-secure payment. Your UPI details stay protected.</small></div>
    </div>`;
  }

  function paymentMethodRows(selectedMethod, disabled) {
    return DISPLAY_PAYMENT_METHODS.map((method) => {
      const selected = method.key === selectedMethod;
      const totalLabel = state.hydration.intent !== "ready" ? "Calculating..." : money(payableAmount(method.backendMethod), state.intent?.currency);
      return `<label class="megaska-express-payment-option ${selected ? "is-selected" : ""} ${method.key === "UPI" ? "megaska-express-payment-option--upi" : "megaska-express-payment-option--compact"}">
        <input type="radio" name="paymentMethod" value="${escapeHtml(method.key)}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span class="megaska-express-payment-icon">${paymentMethodIcon(method.icon)}</span>
        <span class="megaska-express-payment-copy"><span class="megaska-express-payment-title"><strong>${escapeHtml(method.label)}</strong>${method.badge ? `<em>${escapeHtml(method.badge)}</em>` : ""}</span><small>${escapeHtml(method.subtitle)}</small></span>
        <span class="megaska-express-payment-amount">${escapeHtml(totalLabel)}</span>
        <span class="megaska-express-payment-status" aria-hidden="true">${selected ? "✓" : "›"}</span>
        ${method.key === "UPI" ? upiExpandedPanel(totalLabel) : ""}
      </label>`;
    }).join("");
  }

  function render() {
    const root = ensureModal().querySelector("[data-express-root]");
    if (state.step === "loading") renderCheckout(root);
    else if (state.step === "success") root.innerHTML = `<section class="megaska-otp-success"><div class="megaska-otp-success-icon">✓</div><h2 id="megaska-express-title">Order placed successfully</h2><p>${escapeHtml(state.error || "Your order is confirmed.")}</p><a class="megaska-otp-primary-btn" href="/">Continue shopping</a></section>`;
    else if (state.step === "error") root.innerHTML = `<h2 id="megaska-express-title" class="megaska-otp-step-title">Checkout needs attention</h2><p class="megaska-otp-error">${escapeHtml(state.error)}</p><button class="megaska-otp-primary-btn" data-express-action="retry" type="button">Retry</button><a class="megaska-otp-link" href="/checkout">Use standard checkout</a>`;
    else renderCheckout(root);
  }

  function renderCheckout(root) {
    const intent = state.intent || {};
    const currentAddress = Object.assign({}, address(), state.addressDraft);
    const selected = payMethod();
    const selectedDisplayMethod = selectedDisplayPaymentMethod();
    const selectedDisplayConfig = displayPaymentMethodConfig(selectedDisplayMethod);
    const isReady = checkoutReady();
    const priceHydrating = state.hydration.intent !== "ready";
    const addressHydrating = state.hydration.session !== "ready" || state.hydration.address === "loading" || state.hydration.intent === "loading";
    const paymentHydrating = state.hydration.payment !== "ready" || state.hydration.intent !== "ready";
    const rows = lines().slice(0, 3).map((line) => `<article class="megaska-express-line"><span>${lineImage(line) ? `<img src="${escapeHtml(lineImage(line))}" alt="${escapeHtml(lineTitle(line))}" loading="lazy">` : `<i></i>`}</span><div class="megaska-express-line-copy"><b>${escapeHtml(lineTitle(line))}</b><em>${lineVariant(line) ? `${escapeHtml(lineVariant(line))} · ` : ""}Qty ${escapeHtml(line.quantity || 1)}</em></div><strong>${money(linePrice(line), intent.currency)}</strong></article>`).join("");
    const extraCount = Math.max(0, lines().length - 3);
    const discount = selectedDiscount(intent);
    const discountCode = discount?.code || discount?.title || "Discount";
    const discountChip = discount ? `<p class="megaska-express-chip"><strong>${escapeHtml(discountCode)} applied</strong><br>You saved ${money(intent.discountAmountPaise, intent.currency)}</p>` : (state.discountMessage ? `<p class="megaska-express-chip">${escapeHtml(state.discountMessage)}</p>` : "");
    const hasAddress = hasCompleteAddress(currentAddress) && !state.editingAddress;
    const savedPincodeMarkup = hasAddress && state.savedPincodeMessage ? `<p class="megaska-express-saved-pincode-status" data-express-saved-pincode-message data-status="${escapeHtml(state.savedPincodeStatus)}">${escapeHtml(state.savedPincodeMessage)}</p>` : "";
    const prepaidAmount = priceHydrating ? "Calculating..." : money(payableAmount("PREPAID"), intent.currency);
    const totalAmount = priceHydrating ? "Calculating..." : money(payableAmount(selected), intent.currency);
    const submitLabel = !isReady ? "Preparing..." : state.orderSubmitting && state.paymentStarted ? "Opening secure payment..." : state.orderSubmitting ? "Placing order..." : selectedDisplayConfig.cta;
    const disabledCta = !isReady || state.busy || state.orderSubmitting ? "disabled" : "";
    const addressMarkup = addressHydrating && !hasAddress
      ? `<section class="megaska-express-stack"><h3>Delivery address</h3><p class="megaska-otp-step-subtitle" aria-live="polite">Loading saved address...</p></section>`
      : hasAddress
        ? `<section class="megaska-express-stack"><div class="megaska-express-section-head"><h3>Delivery address</h3><button class="megaska-express-link-btn" type="button" data-express-action="change-address">Change Address ›</button></div><div class="megaska-express-address-card"><span class="megaska-express-address-icon" aria-hidden="true">⌖</span><div><strong>${escapeHtml(currentAddress.name)}</strong><p>${escapeHtml(currentAddress.address1)}${currentAddress.address2 ? `, ${escapeHtml(currentAddress.address2)}` : ""}</p><p>${escapeHtml(currentAddress.city)}, ${escapeHtml(currentAddress.province)} ${escapeHtml(currentAddress.zip)}, ${escapeHtml(currentAddress.country)}</p><p>${escapeHtml(intent.phoneSnapshot || currentAddress.phone)}</p>${savedPincodeMarkup}</div></div></section>`
        : `<form data-express-form="address" class="megaska-express-stack" novalidate><h3>Delivery address</h3><input name="name" value="${escapeHtml(currentAddress.name || "")}" placeholder="Full name" required><input name="email" value="${escapeHtml(currentAddress.email || state.customer?.email || "")}" placeholder="Email" type="email"><input value="${escapeHtml(intent.phoneSnapshot || currentAddress.phone || "Verified phone")}" disabled><input name="zip" value="${escapeHtml(currentAddress.zip || state.customer?.postalCode || "")}" placeholder="PIN code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required><p class="megaska-express-pincode-status" data-express-pincode-message data-status="${escapeHtml(state.pincodeStatus)}">${escapeHtml(state.pincodeMessage)}</p><p class="megaska-express-pincode-eta" data-express-pincode-eta>${state.pincodeEta ? `Estimated delivery by ${escapeHtml(formatEta(state.pincodeEta))}` : ""}</p><div class="megaska-express-fields"><input name="city" value="${escapeHtml(currentAddress.city || state.customer?.city || "")}" placeholder="City" required><input name="province" value="${escapeHtml(currentAddress.province || state.customer?.stateProvince || "")}" placeholder="State" required></div><input name="address1" value="${escapeHtml(currentAddress.address1 || state.customer?.addressLine1 || "")}" placeholder="Address line 1" required><input name="address2" value="${escapeHtml(currentAddress.address2 || state.customer?.addressLine2 || "")}" placeholder="Address line 2 / Landmark"><input name="country" value="${escapeHtml(currentAddress.country || "India")}" placeholder="Country" required><button type="submit" ${!state.intent?.id || state.busy ? "disabled" : ""}>Save address</button><p class="megaska-otp-step-subtitle">Address is saved to your checkout and profile.</p></form>`;
    root.innerHTML = `${state.error ? `<p class="megaska-otp-error">${escapeHtml(state.error)}</p>` : ""}<header class="megaska-express-modal-header"><div class="megaska-express-logo">${logoMarkup()}</div><div><p class="megaska-otp-step-subtitle">Secure Checkout</p><h2 id="megaska-express-title" class="megaska-otp-step-title">Express checkout</h2></div></header><div class="megaska-express-progress"><span>Address</span><span>Coupon</span><span>Payment</span></div><section class="megaska-express-summary"><h3>Order summary</h3>${rows || `<p class="megaska-otp-step-subtitle">${state.hydration.cart === "loading" ? "Loading cart summary..." : "Cart details unavailable."}</p>`}${extraCount ? `<p class="megaska-otp-step-subtitle">+ ${extraCount} more item${extraCount > 1 ? "s" : ""}</p>` : ""}<div class="megaska-express-totals"><p><span>Subtotal</span><strong>${priceHydrating ? "Calculating..." : money(intent.subtotalAmountPaise, intent.currency)}</strong></p>${discountSummary(intent)}<p><span>Delivery</span><strong>${Number(intent.shippingAmountPaise || 0) ? money(intent.shippingAmountPaise, intent.currency) : "Free"}</strong></p><p class="megaska-express-total"><span>Total</span><strong>${totalAmount}</strong></p></div></section>${addressMarkup}<form data-express-form="discount" class="megaska-express-stack"><h3>Have a coupon?</h3><div class="megaska-express-inline"><input name="code" value="${escapeHtml(state.discountCode)}" placeholder="Enter coupon code"><button type="submit" ${!state.intent?.id || state.busy ? "disabled" : ""}>Apply</button></div>${discountChip}</form><section class="megaska-express-stack megaska-express-payment"><h3>Payment method</h3><p class="megaska-express-payment-intro">Select how you want to pay. Online options open Razorpay securely after you tap Pay.</p>${paymentHydrating ? `<p class="megaska-otp-step-subtitle" aria-live="polite">Loading payment options...</p>` : ""}<div class="megaska-express-payment-options">${paymentMethodRows(selectedDisplayMethod, paymentHydrating)}</div>${state.paymentUpdating ? `<p class="megaska-otp-step-subtitle">Updating payment method...</p>` : ""}${state.orderSubmitting ? `<p class="megaska-otp-step-subtitle">${state.paymentStarted ? "Opening secure payment..." : "Placing your order securely. Please wait..."}</p>` : ""}</section><div class="megaska-express-sticky-cta"><div class="megaska-express-sticky-trust"><p><span>🔒</span><strong>100% Secure Payments</strong></p><p><span>🛡</span><strong>Trusted & Reliable</strong></p></div><div class="megaska-express-sticky-main"><div><span>Total Payable</span><strong>${totalAmount}</strong></div><button class="megaska-otp-primary-btn" data-express-action="place-order" type="button" ${disabledCta}>${submitLabel}</button></div></div>`;
    console.info("[EXPRESS UI] payment chips rendered", {
      paymentOptionCount: document.querySelectorAll(".megaska-express-payment-option").length,
      selectedDisplayMethod,
    });
  }

  async function refreshIntent() { const startedAt = perfNow(); const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}`); state.intent = data.intent; state.customerDefaultAddress = data.customerDefaultAddress || state.customerDefaultAddress; state.settings = Object.assign({}, state.settings, data.settings || {}); state.discountCode = state.intent?.discounts?.[0]?.code || state.discountCode; perfDetails("intent_fetch_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - startedAt) }); }

  async function createIntent() {
    state.hydration.cart = "loading";
    render();
    const cart = await readCart();
    if (!Number(cart?.item_count || 0)) throw new Error("Your cart is empty.");
    const snapshot = cartSnapshot(cart);
    state.intent = Object.assign({}, state.intent || {}, { cartSnapshot: snapshot, subtotalAmountPaise: cartSubtotalPaise(cart), discountAmountPaise: cartDiscountPaise(cart), shippingAmountPaise: 0, totalAmountPaise: cartTotalPaise(cart), currency: snapshot.currency || "INR" });
    state.hydration.cart = "ready";
    state.hydration.intent = "loading";
    render();
    const startedAt = perfNow();
    const data = await apiFetch("/express/checkout/intents", { method: "POST", body: { cartToken: snapshot.token, cartSnapshot: snapshot, subtotalAmountPaise: cartSubtotalPaise(cart), discountAmountPaise: cartDiscountPaise(cart), shippingAmountPaise: 0, codFeeAmountPaise: 0, totalAmountPaise: cartTotalPaise(cart), currency: snapshot.currency || "INR" } });
    state.intent = data.intent;
    state.customerDefaultAddress = data.customerDefaultAddress || state.customerDefaultAddress;
    state.settings = Object.assign({}, state.settings, data.settings || {});
    state.discountCode = state.intent?.discounts?.[0]?.code || state.discountCode;
    state.hydration.intent = "ready";
    state.hydration.address = state.customerDefaultAddress || state.intent?.addressSnapshots?.length ? "ready" : "ready";
    state.hydration.discount = "ready";
    state.hydration.payment = "ready";
    perfDetails("intent_create_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - startedAt) });
    state.editingAddress = false;
    state.addressDraft = {};
  }

  async function open(opts) {
    const openStart = Number(opts?.openStart || perfNow());
    state.open = true; state.step = "checkout"; state.error = ""; state.busy = false; state.paymentStarted = false; state.orderSubmitting = false; state.intent = null; state.customer = null; state.customerDefaultAddress = null; state.addressDraft = {}; state.editingAddress = false; state.discountMessage = ""; state.pincode = ""; state.pincodeStatus = "idle"; state.pincodeMessage = "Enter 6-digit PIN code to check delivery."; state.pincodeEta = ""; state.pincodeCity = ""; state.pincodeState = ""; state.lastCheckedPincode = ""; state.pincodeCache = {}; state.savedPincode = ""; state.savedPincodeStatus = "idle"; state.savedPincodeMessage = ""; state.savedPincodeEta = ""; state.lastCheckedSavedPincode = ""; state.hydration = { session: "loading", cart: "idle", intent: "idle", address: "loading", discount: "loading", pincode: "idle", payment: "loading" }; resetApiCallPerf(openStart);
    const modal = ensureModal(); modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.documentElement.classList.add("megaska-otp-open"); render();
    try {
      await waitForModalShellPaint(openStart);
      if (!(await ensureAuthenticated(opts?.triggerEl, opts?.event))) { close(); return; }
      state.hydration.session = "ready";
      render();
      await createIntent();
      debugLog("modal ready", { intentId: state.intent?.id }); render(); perfDetails("duplicate_api_calls_found", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, calls: state.perf.apiCalls }); perfDetails("modal_ready_total_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - openStart) }); const initialZip = ensureModal().querySelector('[name="zip"]')?.value || ""; if (initialZip) schedulePincodeCheck(initialZip); const savedZip = hasCompleteAddress(address()) ? address().zip : ""; if (savedZip) scheduleSavedAddressPincodeCheck(savedZip);
    }
    catch (error) { state.step = "error"; state.error = error instanceof Error ? error.message : "Unable to prepare checkout."; render(); }
  }


  function collectAddressPayload() {
    const form = ensureModal().querySelector('[data-express-form="address"]');
    if (!form) {
      const saved = Object.assign({}, address(), state.addressDraft);
      if (hasCompleteAddress(saved)) return { fullName: saved.name, name: saved.name, email: saved.email || state.customer?.email || null, phone: state.intent.phoneSnapshot || saved.phone || state.customer?.phoneE164 || state.customer?.phone || "", addressLine1: saved.address1, address1: saved.address1, addressLine2: saved.address2 || null, address2: saved.address2 || null, city: saved.city, state: saved.province, province: saved.province, country: saved.country || "India", postalCode: saved.zip, zip: saved.zip };
      throw new Error("Please complete the delivery address.");
    }
    const data = new FormData(form);
    const zip = sanitizePincode(data.get("zip"));
    const city = String(data.get("city") || "").trim();
    const province = String(data.get("province") || "").trim();
    const zipInput = form.querySelector('[name="zip"]');
    if (zipInput) { zipInput.value = zip; zipInput.setCustomValidity(""); }
    if (!/^\d{6}$/.test(zip)) { if (zipInput) zipInput.setCustomValidity("Enter a valid 6-digit PIN code."); throw new Error("Enter a valid 6-digit PIN code."); }
    const requiredFields = [["name", "Full name is required."], ["address1", "Address line 1 is required."], ["country", "Country is required."]];
    for (const [fieldName, message] of requiredFields) {
      const input = form.querySelector(`[name="${fieldName}"]`);
      if (input) input.setCustomValidity("");
      if (!String(data.get(fieldName) || "").trim()) { if (input) input.setCustomValidity(message); throw new Error(message); }
    }
    if (zip !== state.lastCheckedPincode || state.pincodeStatus !== "serviceable") throw new Error("Please confirm delivery availability for this PIN code.");
    if (!city || !province) throw new Error("City and state are required for delivery.");
    return { fullName: data.get("name"), name: data.get("name"), email: data.get("email") || null, phone: state.intent.phoneSnapshot || state.customer?.phoneE164 || state.customer?.phone || "", addressLine1: data.get("address1"), address1: data.get("address1"), addressLine2: data.get("address2") || null, address2: data.get("address2") || null, city, state: province, province, country: data.get("country") || "India", postalCode: zip, zip };
  }

  async function saveAddressFromCheckout() {
    const intentId = encodeURIComponent(state.intent.id);
    const payload = collectAddressPayload();
    state.addressDraft = {
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      address1: payload.address1,
      address2: payload.address2,
      city: payload.city,
      province: payload.province,
      country: payload.country,
      zip: payload.zip,
    };
    const data = await apiFetch(`/express/checkout/intents/${intentId}/address`, { method: "POST", body: payload });
    if (data.addressSnapshot) {
      state.intent = Object.assign({}, state.intent, data.intent || {}, { addressSnapshots: [data.addressSnapshot] });
      state.customerDefaultAddress = data.addressSnapshot;
      state.addressDraft = {};
      state.editingAddress = false;
    }
    await refreshIntent();
    state.editingAddress = false;
  }

  async function onSubmit(event) {
    const form = event.target.closest("[data-express-form]"); if (!form) return; event.preventDefault();
    try { state.busy = true; state.error = ""; render(); const intentId = encodeURIComponent(state.intent.id); const data = new FormData(form); if (form.dataset.expressForm === "address") await saveAddressFromCheckout(); if (form.dataset.expressForm === "discount") { const code = String(data.get("code") || "").trim(); if (!code) throw new Error("Enter a discount code."); const applied = selectedDiscount(state.intent); if (applied && String(applied.code || "").toUpperCase() === code.toUpperCase()) { state.discountMessage = `${String(applied.code || code).toUpperCase()} is already applied.`; } else { await apiFetch(`/express/checkout/intents/${intentId}/discount`, { method: "POST", body: { code, discountAmountPaise: 0 } }); state.discountCode = code; state.discountMessage = ""; } } await refreshIntent(); state.busy = false; render(); } catch (error) { state.busy = false; state.error = error instanceof Error ? error.message : "Something went wrong."; render(); }
  }

  function onInput(event) {
    const target = event.target;
    if (!target.matches('[data-express-form="address"] input')) return;
    if (target.name === "zip") {
      const sanitized = sanitizePincode(target.value);
      if (target.value !== sanitized) target.value = sanitized;
      target.setCustomValidity("");
      state.addressDraft.zip = sanitized;
      schedulePincodeCheck(sanitized);
      return;
    }
    target.setCustomValidity("");
    state.addressDraft[target.name] = target.value;
  }

  async function ensurePaymentMethod(method) { if (state.intent?.selectedPaymentMethod !== method) await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/payment-method`, { method: "POST", body: { method } }); await refreshIntent(); state.optimisticPaymentMethod = null; if (state.intent?.selectedPaymentMethod !== method) throw new Error("Could not update payment method. Please try again."); }

  async function onChange(event) {
    if (!event.target.matches('input[name="paymentMethod"]')) return;
    const previous = payMethod(); const previousDisplay = selectedDisplayPaymentMethod(); const nextDisplay = event.target.value; const next = backendPaymentMethodForDisplay(nextDisplay); state.selectedDisplayPaymentMethod = nextDisplay; state.optimisticPaymentMethod = next; state.paymentUpdating = true; state.error = ""; render(); try { await ensurePaymentMethod(next); state.paymentUpdating = false; render(); } catch (_error) { state.selectedDisplayPaymentMethod = previousDisplay; state.optimisticPaymentMethod = previous; state.paymentUpdating = false; state.error = "Could not update payment method. Please try again."; render(); }
  }

  function loadRazorpay() { return new Promise((resolve, reject) => { if (window.Razorpay) return resolve(); const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = resolve; script.onerror = () => reject(new Error("Unable to load Razorpay Checkout.")); document.head.appendChild(script); }); }
  async function createOrder() { const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/order`, { method: "POST", body: {} }); state.step = "success"; state.error = `${data.orderLink?.shopifyOrderName || data.shopifyOrder?.name || "Your order"} has been created.`; state.busy = false; state.paymentStarted = false; render(); }
  async function placeOrder() {
    if (state.orderSubmitting) return;
    state.orderSubmitting = true; state.busy = true; state.error = ""; render();
    await saveAddressFromCheckout();
    if (payMethod() === "COD") return createOrder();
    const selectedDisplayMethod = selectedDisplayPaymentMethod();
    state.paymentStarted = true;
    await ensurePaymentMethod("PREPAID");
    await loadRazorpay();
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay-order`, { method: "POST", body: {} });
    const checkout = data.checkout || {};
    if (!checkout.razorpayOrderId || !checkout.key) throw new MegaskaApiError("Could not start secure payment. Please try again.", { stage: "RAZORPAY_ORDER_CREATE", code: "RAZORPAY_ORDER_DETAILS_MISSING" });
    const display = buildRazorpayDisplayConfig(selectedDisplayMethod);
    const options = {
      key: checkout.key, amount: checkout.amountPaise, currency: checkout.currency || "INR", name: shopLabel(), description: "Express Checkout", order_id: checkout.razorpayOrderId, prefill: checkout.customer || {}, notes: checkout.notes || {},
      handler: async (response) => { const verified = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay-verify`, { method: "POST", body: response }); state.step = "success"; state.error = `${verified.orderLink?.shopifyOrderName || verified.shopifyOrder?.name || "Your order"} has been created.`; state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; await refreshIntent(); render(); },
      modal: { ondismiss: () => { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.error = "Payment was not completed. You can try again."; render(); } },
    };
    if (display) options.display = display;
    logRazorpayDisplayConfig(selectedDisplayMethod, display?.blocks?.selected_method?.instruments?.[0]?.method || null, options);
    try {
      new window.Razorpay(options).open();
    } catch (error) {
      if (window.console && typeof window.console.warn === "function") window.console.warn("[Megaska Express] Razorpay display config failed, retrying default checkout", error);
      // Razorpay EMI availability can be account-, issuer-, and order-dependent; if direct EMI display config is rejected, retry the same order with card-focused checkout before falling back to default checkout.
      if (selectedDisplayMethod === "EMI") {
        const cardOptions = { ...options, display: buildRazorpayDisplayConfig("CARD") };
        logRazorpayDisplayConfig(selectedDisplayMethod, cardOptions.display?.blocks?.selected_method?.instruments?.[0]?.method || null, cardOptions);
        try { new window.Razorpay(cardOptions).open(); return; } catch (cardError) { if (window.console && typeof window.console.warn === "function") window.console.warn("[Megaska Express] Razorpay EMI card fallback failed, retrying default checkout", cardError); }
      }
      const fallbackOptions = { ...options };
      delete fallbackOptions.display;
      logRazorpayDisplayConfig(selectedDisplayMethod, null, fallbackOptions);
      new window.Razorpay(fallbackOptions).open();
    }
  }

  async function onActionClick(event) {
    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action"); if (!action) return;
    try { if (action === "retry") await open({}); if (action === "change-address") { state.editingAddress = true; render(); } if (action === "place-order" && !state.busy) await placeOrder(); } catch (error) { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.error = action === "place-order" ? (payMethod() === "PREPAID" ? prepaidPlaceOrderMessage(error) : "We could not place your order right now. Please try again.") : error instanceof Error ? error.message : "Something went wrong."; render(); }
  }

  function bindTriggers() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest(TRIGGER_SELECTOR);
      if (!trigger || trigger.hasAttribute("data-megaska-express-disabled")) return;
      const openStart = perfNow();
      perfLog("bag_place_order_click");
      event.preventDefault(); event.stopPropagation(); open({ triggerEl: trigger, event, openStart });
    }, true);
  }

  window.MegaskaExpressCheckout = { open, close, fallbackUrl: PAGE_FALLBACK_URL };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindTriggers, { once: true }); else bindTriggers();
})();
