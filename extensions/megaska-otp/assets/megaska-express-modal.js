(function () {
  const SESSION_KEY = "megaska_session_token";
  const APP_PROXY_API_BASE = "/apps/megaska/api";
  const PAGE_FALLBACK_URL = "/pages/megaska-express-checkout";
  const TRIGGER_SELECTOR = "[data-megaska-express-checkout], [data-bag-action='checkout']";
  const DEBUG = /(?:^|[?&])megaska_debug=1(?:&|$)/.test(window.location.search) || window.MEGASKA_DEBUG === true;

  const state = {
    open: false,
    step: "idle",
    intent: null,
    customer: null,
    busy: false,
    paymentStarted: false,
    error: "",
    discountCode: "",
  };

  function debugLog(message, payload) {
    if (DEBUG) console.log(`[Megaska Express Modal] ${message}`, payload || {});
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
    return String(window.MEGASKA_API_BASE || APP_PROXY_API_BASE).replace(/\/$/, "");
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
    const opts = Object.assign({ method: "GET" }, options || {}, { headers });
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
    const res = await fetch(url.toString(), opts);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
    return data;
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

  function cartSnapshot(cart) {
    return { token: cart?.token || "", items: Array.isArray(cart?.items) ? cart.items : [], item_count: Number(cart?.item_count || 0), total_price: Number(cart?.total_price || 0), total_discount: Number(cart?.total_discount || 0), currency: cart?.currency || "INR" };
  }

  async function ensureAuthenticated(triggerEl, event) {
    const session = window.MegaskaAuth?.fetchSession ? await window.MegaskaAuth.fetchSession() : { authenticated: Boolean(await getToken()) };
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
    modal.innerHTML = `<div class="megaska-otp-backdrop" data-express-close></div><div class="megaska-otp-dialog megaska-express-dialog" role="dialog" aria-modal="true" aria-labelledby="megaska-express-title"><button class="megaska-otp-close" type="button" data-express-close aria-label="Close">&times;</button><div class="megaska-otp-flow"><div data-express-root></div></div></div>`;
    modal.addEventListener("click", (event) => { if (event.target.closest("[data-express-close]")) close(); });
    modal.addEventListener("submit", onSubmit);
    modal.addEventListener("change", onChange);
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

  function address() { return Array.isArray(state.intent?.addressSnapshots) ? state.intent.addressSnapshots[0] || {} : {}; }
  function lines() { return Array.isArray(state.intent?.cartSnapshot?.items) ? state.intent.cartSnapshot.items : []; }
  function payMethod() { return state.intent?.selectedPaymentMethod || "PREPAID"; }

  function render() {
    const root = ensureModal().querySelector("[data-express-root]");
    if (state.step === "loading") root.innerHTML = `<h2 id="megaska-express-title" class="megaska-otp-step-title">Preparing checkout</h2><p class="megaska-otp-step-subtitle">Checking your verified session and cart.</p><div class="megaska-express-spinner">Loading...</div>`;
    else if (state.step === "success") root.innerHTML = `<section class="megaska-otp-success"><div class="megaska-otp-success-icon">✓</div><h2 id="megaska-express-title">Order placed successfully</h2><p>${escapeHtml(state.error || "Your order is confirmed.")}</p><a class="megaska-otp-primary-btn" href="/">Continue shopping</a></section>`;
    else if (state.step === "error") root.innerHTML = `<h2 id="megaska-express-title" class="megaska-otp-step-title">Checkout needs attention</h2><p class="megaska-otp-error">${escapeHtml(state.error)}</p><button class="megaska-otp-primary-btn" data-express-action="retry" type="button">Retry</button><a class="megaska-otp-link" href="/checkout">Use standard checkout</a>`;
    else renderCheckout(root);
  }

  function renderCheckout(root) {
    const intent = state.intent || {}; const currentAddress = address(); const selected = payMethod();
    root.innerHTML = `${state.error ? `<p class="megaska-otp-error">${escapeHtml(state.error)}</p>` : ""}<h2 id="megaska-express-title" class="megaska-otp-step-title">Express checkout</h2><div class="megaska-express-progress"><span>Address</span><span>Discount</span><span>Payment</span></div><section class="megaska-express-summary"><h3>Cart snapshot</h3>${lines().map((line) => `<p><span>${escapeHtml(line.product_title || line.title || "Item")} × ${escapeHtml(line.quantity || 1)}</span><strong>${money(line.line_price ?? line.final_line_price ?? line.price, intent.currency)}</strong></p>`).join("") || `<p class="megaska-otp-step-subtitle">Cart details unavailable.</p>`}<p class="megaska-express-total"><span>Total</span><strong>${money(intent.totalAmountPaise, intent.currency)}</strong></p></section><form data-express-form="address" class="megaska-express-stack"><h3>Delivery address</h3><input name="name" value="${escapeHtml(currentAddress.name || "")}" placeholder="Full name" required><input name="email" value="${escapeHtml(currentAddress.email || state.customer?.email || "")}" placeholder="Email" type="email"><input value="${escapeHtml(intent.phoneSnapshot || currentAddress.phone || "Verified phone")}" disabled><input name="address1" value="${escapeHtml(currentAddress.address1 || state.customer?.addressLine1 || "")}" placeholder="Address line 1" required><input name="address2" value="${escapeHtml(currentAddress.address2 || state.customer?.addressLine2 || "")}" placeholder="Address line 2"><div class="megaska-express-fields"><input name="city" value="${escapeHtml(currentAddress.city || state.customer?.city || "")}" placeholder="City" required><input name="province" value="${escapeHtml(currentAddress.province || state.customer?.stateProvince || "")}" placeholder="State" required></div><div class="megaska-express-fields"><input name="zip" value="${escapeHtml(currentAddress.zip || state.customer?.postalCode || "")}" placeholder="PIN code" required><input name="country" value="${escapeHtml(currentAddress.country || "India")}" placeholder="Country"></div><button class="megaska-otp-primary-btn" type="submit" ${state.busy ? "disabled" : ""}>Save address</button></form><form data-express-form="discount" class="megaska-express-stack"><h3>Discount</h3><div class="megaska-express-inline"><input name="code" value="${escapeHtml(state.discountCode)}" placeholder="Discount code"><button type="submit" ${state.busy ? "disabled" : ""}>Apply</button></div></form><section class="megaska-express-stack"><h3>Payment method</h3><label><input type="radio" name="paymentMethod" value="PREPAID" ${selected === "PREPAID" ? "checked" : ""}> Razorpay / prepaid</label><label><input type="radio" name="paymentMethod" value="COD" ${selected === "COD" ? "checked" : ""}> Cash on delivery</label><button class="megaska-otp-primary-btn" data-express-action="place-order" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "Processing..." : selected === "COD" ? "Place COD order" : "Pay now"}</button></section>`;
  }

  async function refreshIntent() { const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}`); state.intent = data.intent; state.discountCode = state.intent?.discounts?.[0]?.code || state.discountCode; }

  async function createIntent() {
    const cart = await readCart();
    if (!Number(cart?.item_count || 0)) throw new Error("Your cart is empty.");
    const snapshot = cartSnapshot(cart);
    const data = await apiFetch("/express/checkout/intents", { method: "POST", body: { cartToken: snapshot.token, cartSnapshot: snapshot, subtotalAmountPaise: Number(cart.items_subtotal_price || cart.total_price || 0), discountAmountPaise: Number(cart.total_discount || 0), shippingAmountPaise: 0, codFeeAmountPaise: 0, totalAmountPaise: Math.max(Number(cart.total_price || 0), 0), currency: "INR" } });
    state.intent = data.intent;
    await refreshIntent();
  }

  async function open(opts) {
    state.open = true; state.step = "loading"; state.error = ""; state.busy = false; state.paymentStarted = false;
    const modal = ensureModal(); modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.documentElement.classList.add("megaska-otp-open"); render();
    try { if (!(await ensureAuthenticated(opts?.triggerEl, opts?.event))) { close(); return; } await createIntent(); state.step = "checkout"; debugLog("modal ready", { intentId: state.intent?.id }); render(); }
    catch (error) { state.step = "error"; state.error = error instanceof Error ? error.message : "Unable to prepare checkout."; render(); }
  }

  async function onSubmit(event) {
    const form = event.target.closest("[data-express-form]"); if (!form) return; event.preventDefault();
    try { state.busy = true; state.error = ""; render(); const intentId = encodeURIComponent(state.intent.id); const data = new FormData(form); if (form.dataset.expressForm === "address") await apiFetch(`/express/checkout/intents/${intentId}/address`, { method: "POST", body: { name: data.get("name"), email: data.get("email") || null, phone: state.intent.phoneSnapshot || "", address1: data.get("address1"), address2: data.get("address2") || null, city: data.get("city"), province: data.get("province"), country: data.get("country") || "India", zip: data.get("zip") } }); if (form.dataset.expressForm === "discount") { const code = String(data.get("code") || "").trim(); if (!code) throw new Error("Enter a discount code."); await apiFetch(`/express/checkout/intents/${intentId}/discount`, { method: "POST", body: { code, discountAmountPaise: 0 } }); state.discountCode = code; } await refreshIntent(); state.busy = false; render(); } catch (error) { state.busy = false; state.error = error instanceof Error ? error.message : "Something went wrong."; render(); }
  }

  async function onChange(event) {
    if (!event.target.matches('input[name="paymentMethod"]')) return;
    try { state.busy = true; render(); await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/payment-method`, { method: "POST", body: { method: event.target.value } }); await refreshIntent(); state.busy = false; render(); } catch (error) { state.busy = false; state.error = error instanceof Error ? error.message : "Unable to update payment method."; render(); }
  }

  function loadRazorpay() { return new Promise((resolve, reject) => { if (window.Razorpay) return resolve(); const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.onload = resolve; script.onerror = () => reject(new Error("Unable to load Razorpay Checkout.")); document.head.appendChild(script); }); }
  async function createOrder() { const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/order`, { method: "POST", body: {} }); state.step = "success"; state.error = `${data.orderLink?.shopifyOrderName || data.shopifyOrder?.name || "Your order"} has been created.`; state.busy = false; state.paymentStarted = false; render(); }
  async function placeOrder() { state.busy = true; state.error = ""; render(); if (payMethod() === "COD") return createOrder(); state.paymentStarted = true; await loadRazorpay(); const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay/order`, { method: "POST", body: {} }); const order = data.razorpayOrder; if (!order?.id || !order?.keyId) throw new Error("Razorpay order details are missing."); new window.Razorpay({ key: order.keyId, amount: order.amount, currency: order.currency || "INR", name: "Megaska", description: "Express Checkout", order_id: order.id, handler: async (response) => { await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay/verify`, { method: "POST", body: response }); await createOrder(); }, modal: { ondismiss: () => { state.busy = false; state.paymentStarted = false; state.error = "Payment was cancelled."; render(); } } }).open(); }

  async function onActionClick(event) {
    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action"); if (!action) return;
    try { if (action === "retry") await open({}); if (action === "place-order" && !state.busy) await placeOrder(); } catch (error) { state.busy = false; state.paymentStarted = false; state.error = error instanceof Error ? error.message : "Something went wrong."; render(); }
  }

  function bindTriggers() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest(TRIGGER_SELECTOR);
      if (!trigger || trigger.hasAttribute("data-megaska-express-disabled")) return;
      event.preventDefault(); event.stopPropagation(); open({ triggerEl: trigger, event });
    }, true);
  }

  window.MegaskaExpressCheckout = { open, close, fallbackUrl: PAGE_FALLBACK_URL };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindTriggers, { once: true }); else bindTriggers();
})();
