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
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
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
      image: item?.image || item?.featured_image?.url || "",
    };
  }

  function cartSnapshot(cart) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const lineItems = items.map(cartLineItem).filter(Boolean);
    return { token: cart?.token || "", items, lineItems, item_count: Number(cart?.item_count || 0), total_price: Number(cart?.total_price || 0), total_discount: Number(cart?.total_discount || 0), currency: cart?.currency || "INR" };
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
    modal.innerHTML = `<div class="megaska-otp-backdrop"></div><div class="megaska-otp-dialog megaska-express-dialog" role="dialog" aria-modal="true" aria-labelledby="megaska-express-title"><button class="megaska-otp-close" type="button" data-express-close aria-label="Close">&times;</button><div class="megaska-otp-flow"><div data-express-root></div></div></div>`;
    modal.addEventListener("click", (event) => { if (event.target.closest("button[data-express-close]")) close(); });
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
  function linePrice(line) { return line?.line_price ?? line?.linePrice ?? line?.final_line_price ?? line?.price ?? 0; }
  function shopLabel() { const shop = String(window.MEGASKA_SHOP_DOMAIN || window.Shopify?.shop || location.hostname || "").replace(/\.myshopify\.com$/, ""); return shop ? shop.split(/[.-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Megaska"; }
  function logoMarkup() { const src = window.MEGASKA_SHOP_LOGO_URL || window.MEGASKA_STORE_LOGO_URL || window.MEGASKA_LOGO_URL || ""; return src ? `<img class="megaska-express-logo-img" src="${escapeHtml(src)}" alt="${escapeHtml(shopLabel())}" loading="lazy">` : `<span class="megaska-express-logo-text">${escapeHtml(shopLabel())}</span>`; }
  function discountSummary(intent) { const discount = selectedDiscount(intent); if (!discount || !Number(intent?.discountAmountPaise || 0)) return ""; const raw = discount.rawShopifyPayload || {}; const code = discount.code || raw.discountCode || discount.title || "Discount"; return `<p><span>Discount<br><small>${escapeHtml(code)} applied</small></span><strong>- ${money(intent.discountAmountPaise, intent.currency)}</strong></p>`; }
  function payableAmount(method) { const base = Number(state.intent?.subtotalAmountPaise || 0) + Number(state.intent?.shippingAmountPaise || 0) - Number(state.intent?.discountAmountPaise || 0); const codFee = method === "COD" ? Number(state.settings?.codFeeAmountPaise || 0) : 0; return Math.max(0, base + codFee); }

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
    const isReady = checkoutReady();
    const priceHydrating = state.hydration.intent !== "ready";
    const addressHydrating = state.hydration.session !== "ready" || state.hydration.address === "loading" || state.hydration.intent === "loading";
    const paymentHydrating = state.hydration.payment !== "ready" || state.hydration.intent !== "ready";
    const rows = lines().slice(0, 3).map((line) => `<article class="megaska-express-line"><span>${lineImage(line) ? `<img src="${escapeHtml(lineImage(line))}" alt="${escapeHtml(lineTitle(line))}" loading="lazy">` : `<i></i>`}</span><b>${escapeHtml(lineTitle(line))}</b><em>${lineVariant(line) ? `${escapeHtml(lineVariant(line))} · ` : ""}Qty ${escapeHtml(line.quantity || 1)}</em><strong>${money(linePrice(line), intent.currency)}</strong></article>`).join("");
    const extraCount = Math.max(0, lines().length - 3);
    const discount = selectedDiscount(intent);
    const discountCode = discount?.code || discount?.title || "Discount";
    const discountChip = discount ? `<p class="megaska-express-chip"><strong>${escapeHtml(discountCode)} applied</strong><br>You saved ${money(intent.discountAmountPaise, intent.currency)}</p>` : (state.discountMessage ? `<p class="megaska-express-chip">${escapeHtml(state.discountMessage)}</p>` : "");
    const hasAddress = hasCompleteAddress(currentAddress) && !state.editingAddress;
    const addressMarkup = addressHydrating && !hasAddress ? `<section class="megaska-express-stack"><h3>Delivery address</h3><p class="megaska-otp-step-subtitle" aria-live="polite">Loading saved address...</p></section>` : hasAddress ? `<section class="megaska-express-stack"><h3>Delivery address</h3><div class="megaska-express-chip"><strong>${escapeHtml(currentAddress.name)}</strong><br>${escapeHtml(currentAddress.address1)}${currentAddress.address2 ? `, ${escapeHtml(currentAddress.address2)}` : ""}<br>${escapeHtml(currentAddress.city)}, ${escapeHtml(currentAddress.province)} ${escapeHtml(currentAddress.zip)}<br>${escapeHtml(currentAddress.country)}<br>Phone: ${escapeHtml(intent.phoneSnapshot || currentAddress.phone)}</div><button type="button" data-express-action="change-address">Change</button></section>` : `<form data-express-form="address" class="megaska-express-stack" novalidate><h3>Delivery address</h3><input name="name" value="${escapeHtml(currentAddress.name || "")}" placeholder="Full name" required><input name="email" value="${escapeHtml(currentAddress.email || state.customer?.email || "")}" placeholder="Email" type="email"><input value="${escapeHtml(intent.phoneSnapshot || currentAddress.phone || "Verified phone")}" disabled><input name="zip" value="${escapeHtml(currentAddress.zip || state.customer?.postalCode || "")}" placeholder="PIN code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required><p class="megaska-express-pincode-status" data-express-pincode-message data-status="${escapeHtml(state.pincodeStatus)}">${escapeHtml(state.pincodeMessage)}</p><p class="megaska-express-pincode-eta" data-express-pincode-eta>${state.pincodeEta ? `Estimated delivery by ${escapeHtml(formatEta(state.pincodeEta))}` : ""}</p><div class="megaska-express-fields"><input name="city" value="${escapeHtml(currentAddress.city || state.customer?.city || "")}" placeholder="City" required><input name="province" value="${escapeHtml(currentAddress.province || state.customer?.stateProvince || "")}" placeholder="State" required></div><input name="address1" value="${escapeHtml(currentAddress.address1 || state.customer?.addressLine1 || "")}" placeholder="Address line 1" required><input name="address2" value="${escapeHtml(currentAddress.address2 || state.customer?.addressLine2 || "")}" placeholder="Address line 2 / Landmark"><input name="country" value="${escapeHtml(currentAddress.country || "India")}" placeholder="Country" required><button type="submit" ${!state.intent?.id || state.busy ? "disabled" : ""}>Save address</button><p class="megaska-otp-step-subtitle">Address is saved to your checkout and profile.</p></form>`;
    root.innerHTML = `${state.error ? `<p class="megaska-otp-error">${escapeHtml(state.error)}</p>` : ""}<header class="megaska-express-modal-header"><div class="megaska-express-logo">${logoMarkup()}</div><div><p class="megaska-otp-step-subtitle">Secure Checkout</p><h2 id="megaska-express-title" class="megaska-otp-step-title">Express checkout</h2></div></header><div class="megaska-express-progress"><span>Address</span><span>Discount</span><span>Payment</span></div><section class="megaska-express-summary"><h3>Order summary</h3>${rows || `<p class="megaska-otp-step-subtitle">${state.hydration.cart === "loading" ? "Loading cart summary..." : "Cart details unavailable."}</p>`}${extraCount ? `<p class="megaska-otp-step-subtitle">+ ${extraCount} more item${extraCount > 1 ? "s" : ""}</p>` : ""}<p><span>Subtotal</span><strong>${priceHydrating ? "Calculating..." : money(intent.subtotalAmountPaise, intent.currency)}</strong></p>${discountSummary(intent)}<p><span>Delivery</span><strong>${Number(intent.shippingAmountPaise || 0) ? money(intent.shippingAmountPaise, intent.currency) : "Free"}</strong></p>${selected === "COD" && Number(state.settings?.codFeeAmountPaise || 0) ? `<p><span>COD charge</span><strong>${money(state.settings.codFeeAmountPaise, intent.currency)}</strong></p>` : ""}<p class="megaska-express-total"><span>Total</span><strong>${priceHydrating ? "Calculating..." : money(payableAmount(selected), intent.currency)}</strong></p></section>${addressMarkup}<form data-express-form="discount" class="megaska-express-stack"><h3>Discount</h3><div class="megaska-express-inline"><input name="code" value="${escapeHtml(state.discountCode)}" placeholder="Discount code"><button type="submit" ${!state.intent?.id || state.busy ? "disabled" : ""}>Apply</button></div>${discountChip}</form><section class="megaska-express-stack"><h3>Payment method</h3>${paymentHydrating ? `<p class="megaska-otp-step-subtitle" aria-live="polite">Loading payment options...</p>` : ""}<label><input type="radio" name="paymentMethod" value="PREPAID" ${selected === "PREPAID" ? "checked" : ""} ${paymentHydrating ? "disabled" : ""}> Online Payment — Pay ${priceHydrating ? "Calculating..." : money(payableAmount("PREPAID"), intent.currency)}</label><label><input type="radio" name="paymentMethod" value="COD" ${selected === "COD" ? "checked" : ""} ${paymentHydrating ? "disabled" : ""}> Cash on Delivery — Pay ${priceHydrating ? "Calculating..." : `${money(payableAmount("PREPAID"), intent.currency)} + ${money(state.settings?.codFeeAmountPaise || 0, intent.currency)} COD charge`}</label>${state.paymentUpdating ? `<p class="megaska-otp-step-subtitle">Updating payment method...</p>` : ""}${selected === "COD" ? `<p class="megaska-otp-step-subtitle">${escapeHtml(state.settings?.codInformationText || "")}</p>` : ""}${state.orderSubmitting ? `<p class="megaska-otp-step-subtitle">${state.paymentStarted ? "Opening secure payment..." : "Placing your order securely. Please wait..."}</p>` : ""}<button class="megaska-otp-primary-btn" data-express-action="place-order" type="button" ${!isReady || state.busy || state.orderSubmitting ? "disabled" : ""}>${!isReady ? "Preparing..." : state.orderSubmitting && state.paymentStarted ? "Opening secure payment..." : state.orderSubmitting ? "Placing order..." : selected === "COD" ? "Place Order" : "Pay Now"}</button></section>`;
  }

  async function refreshIntent() { const startedAt = perfNow(); const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}`); state.intent = data.intent; state.customerDefaultAddress = data.customerDefaultAddress || state.customerDefaultAddress; state.settings = Object.assign({}, state.settings, data.settings || {}); state.discountCode = state.intent?.discounts?.[0]?.code || state.discountCode; perfDetails("intent_fetch_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - startedAt) }); }

  async function createIntent() {
    state.hydration.cart = "loading";
    render();
    const cart = await readCart();
    if (!Number(cart?.item_count || 0)) throw new Error("Your cart is empty.");
    const snapshot = cartSnapshot(cart);
    state.intent = Object.assign({}, state.intent || {}, { cartSnapshot: snapshot, subtotalAmountPaise: Number(cart.items_subtotal_price || cart.total_price || 0), discountAmountPaise: Number(cart.total_discount || 0), shippingAmountPaise: 0, totalAmountPaise: Math.max(Number(cart.total_price || 0), 0), currency: snapshot.currency || "INR" });
    state.hydration.cart = "ready";
    state.hydration.intent = "loading";
    render();
    const startedAt = perfNow();
    const data = await apiFetch("/express/checkout/intents", { method: "POST", body: { cartToken: snapshot.token, cartSnapshot: snapshot, subtotalAmountPaise: Number(cart.items_subtotal_price || cart.total_price || 0), discountAmountPaise: Number(cart.total_discount || 0), shippingAmountPaise: 0, codFeeAmountPaise: 0, totalAmountPaise: Math.max(Number(cart.total_price || 0), 0), currency: "INR" } });
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
    state.open = true; state.step = "checkout"; state.error = ""; state.busy = false; state.paymentStarted = false; state.orderSubmitting = false; state.intent = null; state.customer = null; state.customerDefaultAddress = null; state.addressDraft = {}; state.editingAddress = false; state.discountMessage = ""; state.pincode = ""; state.pincodeStatus = "idle"; state.pincodeMessage = "Enter 6-digit PIN code to check delivery."; state.pincodeEta = ""; state.pincodeCity = ""; state.pincodeState = ""; state.lastCheckedPincode = ""; state.pincodeCache = {}; state.hydration = { session: "loading", cart: "idle", intent: "idle", address: "loading", discount: "loading", pincode: "idle", payment: "loading" }; resetApiCallPerf(openStart);
    const modal = ensureModal(); modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.documentElement.classList.add("megaska-otp-open"); render();
    try {
      await waitForModalShellPaint(openStart);
      if (!(await ensureAuthenticated(opts?.triggerEl, opts?.event))) { close(); return; }
      state.hydration.session = "ready";
      render();
      await createIntent();
      debugLog("modal ready", { intentId: state.intent?.id }); render(); perfDetails("duplicate_api_calls_found", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, calls: state.perf.apiCalls }); perfDetails("modal_ready_total_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - openStart) }); const initialZip = ensureModal().querySelector('[name="zip"]')?.value || ""; if (initialZip) schedulePincodeCheck(initialZip);
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
    const previous = payMethod(); const next = event.target.value; state.optimisticPaymentMethod = next; state.paymentUpdating = true; state.error = ""; render(); try { await ensurePaymentMethod(next); state.paymentUpdating = false; render(); } catch (_error) { state.optimisticPaymentMethod = previous; state.paymentUpdating = false; state.error = "Could not update payment method. Please try again."; render(); }
  }

  function loadRazorpay() { return new Promise((resolve, reject) => { if (window.Razorpay) return resolve(); const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = resolve; script.onerror = () => reject(new Error("Unable to load Razorpay Checkout.")); document.head.appendChild(script); }); }
  async function createOrder() { const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/order`, { method: "POST", body: {} }); state.step = "success"; state.error = `${data.orderLink?.shopifyOrderName || data.shopifyOrder?.name || "Your order"} has been created.`; state.busy = false; state.paymentStarted = false; render(); }
  async function placeOrder() { if (state.orderSubmitting) return; state.orderSubmitting = true; state.busy = true; state.error = ""; render(); await saveAddressFromCheckout(); if (payMethod() === "COD") return createOrder(); state.paymentStarted = true; await ensurePaymentMethod("PREPAID"); await loadRazorpay(); const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay-order`, { method: "POST", body: {} }); const checkout = data.checkout || {}; if (!checkout.razorpayOrderId || !checkout.key) throw new Error("Could not start secure payment. Please try again."); new window.Razorpay({ key: checkout.key, amount: checkout.amountPaise, currency: checkout.currency || "INR", name: shopLabel(), description: "Express Checkout", order_id: checkout.razorpayOrderId, prefill: checkout.customer || {}, notes: checkout.notes || {}, handler: async (response) => { const verified = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay-verify`, { method: "POST", body: response }); state.step = "success"; state.error = `${verified.orderLink?.shopifyOrderName || verified.shopifyOrder?.name || "Your order"} has been created.`; state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; await refreshIntent(); render(); }, modal: { ondismiss: () => { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.error = "Payment was cancelled."; render(); } } }).open(); }

  async function onActionClick(event) {
    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action"); if (!action) return;
    try { if (action === "retry") await open({}); if (action === "change-address") { state.editingAddress = true; render(); } if (action === "place-order" && !state.busy) await placeOrder(); } catch (error) { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.error = action === "place-order" ? (payMethod() === "PREPAID" ? "Payment received, but we could not create your order automatically. Please contact support." : "We could not place your order right now. Please try again.") : error instanceof Error ? error.message : "Something went wrong."; render(); }
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
