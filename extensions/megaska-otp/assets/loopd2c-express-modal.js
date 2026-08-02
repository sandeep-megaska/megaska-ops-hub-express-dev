(function () {
  const SESSION_KEY = "megaska_session_token";
  const APP_PROXY_API_BASE = "/apps/loopd2c/api";
  const PAGE_FALLBACK_URL = "/apps/loopd2c/checkout";
  const RAZORPAY_INLINE_SCRIPT_SRC = "https://checkout.razorpay.com/v1/razorpay.js";
  const RAZORPAY_CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
  const TRIGGER_SELECTOR = "[data-megaska-express-checkout], [data-bag-action='checkout']";
  const DEBUG = /(?:^|[?&])megaska_debug=1(?:&|$)/.test(window.location.search) || window.MEGASKA_DEBUG === true;

  const state = {
    open: false,
    step: "idle",
    intent: null,
    pricing: null,
    customer: null,
    busy: false,
    paymentStarted: false,
    orderSubmitting: false,
    paymentUpdating: false,
    codPolicyRequestId: 0,
    selectedDisplayPaymentMethod: "UPI",
    // COD-only mode: opened from the cart drawer's Prepaid/COD choice when the
    // shopper picked COD. Prepaid is handed off to Shopify Checkout, so the modal
    // presents Cash on Delivery alone (no Razorpay methods, no prepaid warm-up).
    codOnly: false,
    inlinePaymentMode: false,
    razorpayInlineScriptPromise: null,
    razorpayCheckoutScriptPromise: null,
    activeRazorpayInstance: null,
    activeRazorpayOrder: null,
    activeRazorpayOrderPromise: null,
    prepaidWarmupKey: "",
    prepaidWarmupCompletedKey: "",
    prepaidWarmupPromise: null,
    // Set true the moment the shopper explicitly picks COD, so the background
    // prepaid warm-up cannot flip the intent (and the sticky total) back to
    // PREPAID pricing behind their choice.
    codLocked: false,
    addressSavedForIntentId: null,
    paymentInProgress: false,
    inlinePaymentError: "",
    codAdvance: null,
    error: "",
    discountCode: "",
    discountMessage: "",
    storeCredit: { loading: false, availableAmount: 0, appliedAmount: 0, remainingPayable: null, currency: "INR", enabled: false, error: "" },
    addressDraft: {},
    editingAddress: false,
    customerDefaultAddress: null,
     settings: { codFeeAmountPaise: 0, codInformationText: "You need to pay to the delivery agent at the time of delivery. In case of any refund, the refund amount will be issued as store credit which you can utilize for future purchases. However, for card and UPI payments, the refund amount will be directly transferred to your original payment method." },
    delivery: { serviceable: true, codAvailable: true },
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

  function paymentPerfLog(label, startedAt, details) {
    console.info(`[EXPRESS PAYMENT PERF] ${label}`, Object.assign({
      intentId: state.intent?.id || null,
      selectedDisplayMethod: selectedDisplayPaymentMethod(),
      elapsedMs: Math.round(perfNow() - startedAt),
    }, details || {}));
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

  function freshCodAdvanceState() {
    return {
      loadingPolicy: false, policyLoaded: false, available: false, eligible: false, requiresAdvance: false, reasons: [], paymentMode: "COD",
      codAdvanceIntentId: null, orderTotalPaise: 0, storeCreditAppliedPaise: 0, customerCashLiabilityPaise: 0, advanceAmountPaise: 0, codBalanceAmountPaise: 0, currency: "INR", customerTitle: "", customerMessage: "", policyText: "", expiresAt: null,
      creatingOrder: false, razorpayOrderId: null, paymentId: null, verifying: false, verified: false, verifiedAt: null, verificationReused: false, error: null, resumeAction: null, retryAfterMs: 0, preventDuplicatePayment: false, refreshKey: ""
    };
  }

  function codAdvanceState() {
    if (!state.codAdvance) state.codAdvance = freshCodAdvanceState();
    return state.codAdvance;
  }

  function resetCodAdvanceState() { state.codPolicyRequestId += 1; state.codAdvance = freshCodAdvanceState(); }

  function codAdvanceLog(eventName, details) {
    if (window.console && typeof window.console.info === "function") console.info(`[Megaska Express] ${eventName}`, Object.assign({ intentId: state.intent?.id || null }, details || {}));
  }

  function codAdvanceErrorMessage(error) {
    const code = error?.code || error?.stage || "";
    if (code === "RAZORPAY_SIGNATURE_INVALID") return "Payment verification failed. Please retry or contact support if money was deducted.";
    if (code === "RAZORPAY_PAYMENT_LOOKUP_FAILED") return "We could not confirm the payment yet. Please wait a moment and retry verification.";
    if (code === "COD_ADVANCE_RECONCILIATION_REQUIRED") return "Your payment was received, but order confirmation needs recovery. Please do not pay again.";
    if (code === "PAYMENT_IN_PROGRESS") return "Another payment attempt is already in progress.";
    if (code === "COD_ADVANCE_POLICY_CHANGED") return "The order total changed. Please review the updated COD amount.";
    if (code === "CHECKOUT_EXPIRED") return "This checkout has expired. Please refresh and try again.";
    return error instanceof Error ? error.message : "Payment was not completed. You can try again.";
  }

  function applyCodPolicyPayload(payload) {
    const body = payload?.cod || payload?.policy || payload || {};
    const cod = codAdvanceState();
    cod.policyLoaded = true; cod.loadingPolicy = false;
    cod.available = body.available !== false; cod.eligible = body.eligible !== false;
    cod.requiresAdvance = Boolean(body.requiresAdvance || body.paymentMode === "PARTIAL_COD");
    cod.paymentMode = cod.requiresAdvance ? "PARTIAL_COD" : "COD";
    cod.reasons = Array.isArray(body.reasons) ? body.reasons : [];
    cod.codAdvanceIntentId = cod.requiresAdvance ? (body.codAdvanceIntentId || null) : null;
    cod.orderTotalPaise = Number(body.orderTotalPaise || 0);
    cod.storeCreditAppliedPaise = Number(body.storeCreditAppliedPaise || 0);
    cod.customerCashLiabilityPaise = Number(body.customerCashLiabilityPaise || body.cashLiabilityPaise || 0);
    cod.advanceAmountPaise = Number(body.advanceAmountPaise || body.advancePaidPaise || 0);
    cod.codBalanceAmountPaise = Number(body.codBalanceAmountPaise || 0);
    cod.currency = body.currency || cod.currency || "INR";
    cod.customerTitle = cod.requiresAdvance ? String(body.customerTitle || "") : "";
    cod.customerMessage = cod.requiresAdvance ? String(body.customerMessage || body.policyText || "") : "";
    cod.policyText = cod.requiresAdvance ? String(body.policyText || "") : "";
    cod.expiresAt = body.expiresAt || null;
    cod.error = body.message && (!cod.available || !cod.eligible) ? String(body.message) : "";
  }

  function isCurrentCodPolicyRequest(requestId, requestIntentId) {
    return state.codPolicyRequestId === requestId
      && state.intent?.id === requestIntentId
      && state.intent?.selectedPaymentMethod === "COD"
      && selectedDisplayPaymentMethod() === "COD";
  }

  async function loadCodPolicy(reason) {
    const allowDuringPaymentUpdate = reason === "payment_method_select";
    if (!state.intent?.id || selectedDisplayPaymentMethod() !== "COD" || state.intent?.selectedPaymentMethod !== "COD" || (state.paymentUpdating && !allowDuringPaymentUpdate)) return;
    const cod = codAdvanceState();
    if (cod.loadingPolicy) return;
    const requestIntentId = state.intent.id;
    const requestId = state.codPolicyRequestId + 1;
    state.codPolicyRequestId = requestId;
    cod.loadingPolicy = true; cod.error = null; cod.refreshKey = `${requestIntentId}:${reason || "select"}:${Date.now()}`;
    renderPaymentSectionOnly();
    try {
      const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(requestIntentId)}/cod-policy`);
      if (!isCurrentCodPolicyRequest(requestId, requestIntentId)) return;
      applyCodPolicyPayload(data);
      codAdvanceLog("cod_advance.ui.policy_loaded", { requiresAdvance: cod.requiresAdvance, available: cod.available, eligible: cod.eligible });
    } catch (error) {
      if (!isCurrentCodPolicyRequest(requestId, requestIntentId)) return;
      cod.loadingPolicy = false; cod.policyLoaded = false; cod.error = codAdvanceErrorMessage(error);
      if (error?.code === "CHECKOUT_EXPIRED") state.error = cod.error;
    }
    if (isCurrentCodPolicyRequest(requestId, requestIntentId)) renderPaymentSectionOnly();
  }

  function invalidateCodPolicy(reason) {
    if (!state.codAdvance) return;
    state.codAdvance = freshCodAdvanceState();
    const intentId = state.intent?.id || "";
    if (selectedDisplayPaymentMethod() === "COD" && state.intent?.selectedPaymentMethod === "COD" && intentId && !state.paymentUpdating) {
      window.setTimeout(() => {
        if (state.intent?.id === intentId && state.intent?.selectedPaymentMethod === "COD" && selectedDisplayPaymentMethod() === "COD" && !state.paymentUpdating) loadCodPolicy(reason);
      }, 0);
    }
  }

  function prepaidPlaceOrderMessage(error) {
    if (error?.stage === "RAZORPAY_ORDER_CREATE") return error.message || "Could not start secure payment. Please try again.";
    return error instanceof Error ? error.message : "Payment was not completed. You can try again.";
  }

  function razorpayOrderCreateMessage(body) {
    if (body?.code === "PAYMENT_IN_PROGRESS") return "A payment attempt is already in progress. Complete it or try again shortly.";
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
      if (data?.code === "EXPRESS_CHECKOUT_NOT_READY") {
        state.error = "Express Checkout is currently unavailable. Continuing to secure checkout.";
        render();
        window.setTimeout(() => window.location.assign("/checkout"), 500);
        throw new MegaskaApiError(state.error, { status: res.status, code: data.code });
      }
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
    const codFlag = body.codAvailable ?? body.isCod ?? body.cod ?? body.cash ?? body.cod_available ?? body.cash_on_delivery;
    const codAvailable = codFlag === undefined || codFlag === null || codFlag === ""
      ? serviceable
      : codFlag === true || String(codFlag).trim().toUpperCase() === "Y" || String(codFlag).trim().toLowerCase() === "true" || String(codFlag).trim() === "1";
    return {
      ok: body.ok !== false,
      serviceable,
      codAvailable,
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
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isSunday(date) {
  return date.getDay() === 0;
}

function getPublicHolidays() {
  return Array.isArray(window.MEGASKA_PUBLIC_HOLIDAYS)
    ? window.MEGASKA_PUBLIC_HOLIDAYS
    : [];
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isPublicHoliday(date) {
  return getPublicHolidays().includes(toDateKey(date));
}

function isWorkingDay(date) {
  return !isSunday(date) && !isPublicHoliday(date);
}

function nextWorkingDay(date) {
  let d = new Date(date);
  do {
    d = addDays(d, 1);
  } while (!isWorkingDay(d));
  return d;
}

function getDispatchDate() {
  const now = new Date();
  const beforeNoon = now.getHours() < 12;

  if (beforeNoon && isWorkingDay(now)) {
    return now;
  }

  return nextWorkingDay(now);
}

function buildBufferedEta(rawEta) {
  if (!rawEta) return "";

  const delhiveryEta = new Date(rawEta);
  if (Number.isNaN(delhiveryEta.getTime())) return rawEta;

  const now = new Date();
  const dispatchDate = getDispatchDate();

  const dispatchDelayDays = Math.max(
    0,
    Math.ceil((dispatchDate.setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000)
  );

  const bufferDays = dispatchDelayDays === 0 ? 1 : 2;
  return addDays(delhiveryEta, bufferDays).toISOString().slice(0, 10);
}

  
  function pincodeDeliveryMessage(result) {
  if (!result?.eta) return "Delivery available";

  const bufferedEta = buildBufferedEta(result.eta);

  return `Delivery available • Estimated delivery: ${formatEta(bufferedEta)}`;
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

  function enforceDeliveryServiceability(result) {
    state.delivery = {
      serviceable: result?.serviceable === true,
      codAvailable: result?.codAvailable !== false,
    };
    if (!state.delivery.codAvailable && state.selectedDisplayPaymentMethod === "COD") {
      state.selectedDisplayPaymentMethod = "UPI";
      state.inlinePaymentMode = true;
      state.inlinePaymentError = "";
    }
    if (state.open) renderPaymentSectionOnly();
  }

  function resetDeliveryServiceability() {
    state.delivery = { serviceable: true, codAvailable: true };
    if (state.open) renderPaymentSectionOnly();
  }

  function isCodUnavailable() {
    return state.delivery?.codAvailable === false;
  }

  function applyPincodeResult(result) {
    state.lastCheckedPincode = result.pincode || state.pincode;
    enforceDeliveryServiceability(result);
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
    enforceDeliveryServiceability(result);
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
    if (!pincode) { state.lastCheckedPincode = ""; resetDeliveryServiceability(); setPincodeState("idle", "Enter 6-digit PIN code to check delivery.", {}); return; }
    if (pincode.length < 6) { state.lastCheckedPincode = ""; resetDeliveryServiceability(); setPincodeState("idle", "Enter 6-digit PIN code to check delivery.", {}); return; }
    if (!/^\d{6}$/.test(pincode)) { state.lastCheckedPincode = ""; resetDeliveryServiceability(); setPincodeState("idle", "Enter a valid 6-digit PIN code.", {}); return; }
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

  function formatSnapshotMoney(minorUnits, currency) {
    const currencyCode = String(currency || "INR").toUpperCase();
    try {
      const formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode });
      const exponent = formatter.resolvedOptions().maximumFractionDigits;
      return formatter.format(Number(minorUnits || 0) / (10 ** exponent));
    } catch (_error) { return `${currencyCode} ${Number(minorUnits || 0)}`; }
  }

  function buildCheckoutTaxDisplayRows(pricing) {
    if (pricing?.status !== "CURRENT" || pricing.authoritative !== true) return [];
    const detailed = (Array.isArray(pricing.taxLines) ? pricing.taxLines : []).flatMap((line, index) => {
      const title = String(line?.title || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      const amountMinor = Number(line?.amountMinor);
      if (!title || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return [];
      return [{ key: `tax-line-${index}`, label: pricing.taxesIncluded === true ? `Includes ${title}` : title, amountMinor }];
    });
    if (detailed.length) return detailed;
    const totalTaxMinor = Number(pricing.totalTaxMinor);
    if (!Number.isSafeInteger(totalTaxMinor) || totalTaxMinor <= 0) return [];
    return [{ key: "tax-total-fallback", label: pricing.taxesIncluded === true ? "Includes tax" : "Tax", amountMinor: totalTaxMinor }];
  }

  function checkoutTaxSummary() {
    const pricing = state.pricing;
    const rows = buildCheckoutTaxDisplayRows(state.busy === true ? null : pricing);
    const status = state.busy === true && pricing ? "REFRESHING" : pricing?.status;
    const message = status === "REFRESHING" || status === "INVALIDATED" ? "Updating shipping, discounts and tax…" : "";
    const currency = pricing?.currency || state.intent?.currency;
    return `${message ? `<p class="megaska-express-pricing-state" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ""}${rows.map((row) => `<p class="megaska-express-tax-row" data-tax-row="${escapeHtml(row.key)}"><span>${escapeHtml(row.label)}</span><strong>${formatSnapshotMoney(row.amountMinor, currency)}</strong></p>`).join("")}`;
  }

  function cartSnapshot(cart) {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const lineItems = items.map(cartLineItem).filter(Boolean);
    const pricing = window.LoopDeskPromotionPricing?.build?.(cart) || null;
    return { token: cart?.token || "", items, lineItems, promotionPricing: pricing, item_count: Number(cart?.item_count || 0), total_price: Number(cart?.total_price || 0), original_total_price: Number(cart?.original_total_price || 0), items_subtotal_price: Number(cart?.items_subtotal_price || 0), total_discount: Number(cart?.total_discount || 0), cart_level_discount_applications: cart?.cart_level_discount_applications || [], discount_codes: cart?.discount_codes || [], currency: cart?.currency || "INR" };
  }

  // The OTP + auth modules load as separate deferred scripts, so on the very
  // first checkout click they may not be on `window` yet (the "first attempt
  // fails, works after refresh" race). Wait briefly for them before gating.
  async function waitForAuthModules(timeoutMs) {
    const deadline = perfNow() + (timeoutMs || 3000);
    while (perfNow() < deadline) {
      if (window.MegaskaAuth?.fetchSession && window.MegaskaOtp?.ensureMegaskaAuthenticatedBeforeCheckout) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    return Boolean(window.MegaskaAuth?.fetchSession && window.MegaskaOtp?.ensureMegaskaAuthenticatedBeforeCheckout);
  }

  async function ensureAuthenticated(triggerEl, event, reopenOpts) {
    const startedAt = perfNow();
    await waitForAuthModules(3000);
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
        pendingAction: { type: "callback", callback: () => open({ triggerEl, codOnly: Boolean(reopenOpts?.codOnly) }) },
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
    resetInlinePaymentState();
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
  function payMethod() { return state.optimisticPaymentMethod || state.intent?.selectedPaymentMethod || "PREPAID"; }
  function lineTitle(line) { return line?.product_title || line?.productTitle || line?.title || line?.name || "Item"; }
  function lineVariant(line) { const title = line?.variant_title || line?.variantTitle || ""; return title && title !== "Default Title" ? title : ""; }
  function lineImage(line) { return line?.image || line?.featured_image?.url || line?.featuredImage?.url || ""; }
  function linePrice(line) { return line?.original_line_price ?? line?.originalLinePrice ?? line?.line_price ?? line?.linePrice ?? line?.final_line_price ?? line?.price ?? 0; }
  function cartPricing(cart) { return window.LoopDeskPromotionPricing?.build?.(cart) || null; }
  function cartSubtotalPaise(cart) { return cartPricing(cart)?.merchandiseSubtotal ?? Number(cart?.original_total_price || cart?.items_subtotal_price || cart?.total_price || 0); }
  function cartDiscountPaise(cart) { return cartPricing(cart)?.totalSavings ?? Number(cart?.total_discount || 0); }
  function cartTotalPaise(cart) { return cartPricing(cart)?.finalPayableSubtotal ?? Math.max(Number(cart?.total_price || 0), 0); }
  function shopLabel() { const cfg = window.LoopDeskConfig && window.LoopDeskConfig.general; return (cfg && (cfg.storeName || cfg.merchantName)) || "Store"; }
  function logoUrl() {
    const sources = [
      window.MEGASKA_SHOP_LOGO_URL,
      window.MEGASKA_STORE_LOGO_URL,
      window.MEGASKA_LOGO_URL,
      document.querySelector("header img")?.src,
      document.querySelector('link[rel="icon"]')?.href,
    ];
    for (const source of sources) {
      const url = String(source || "").trim();
      if (url) return url;
    }
    return "";
  }
  function logoMarkup() {
    const src = logoUrl();
    const label = shopLabel();
    if (src) return `<img class="megaska-express-logo-img" src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy">`;
    return `<span class="megaska-express-logo-text"><strong>${escapeHtml(label.toUpperCase())}</strong></span>`;
  }
  function discountSummary(intent) { const discount = selectedDiscount(intent); if (!discount || !Number(intent?.discountAmountPaise || 0)) return ""; const raw = discount.rawShopifyPayload || {}; const code = discount.code || raw.discountCode || discount.title || "Discount"; return `<p><span>Discount<br><small>${escapeHtml(code)} applied</small></span><strong>- ${money(intent.discountAmountPaise, intent.currency)}</strong></p>`; }
  // Savings line shown only while a prepaid method is selected. On COD the line
  // disappears (COD does not earn the offer), so the shopper sees the price gap.
  function prepaidSummary(method) { if (state.codOnly || method !== "PREPAID") return ""; const save = prepaidDiscountPreviewPaise(); if (save <= 0) return ""; return `<p class="megaska-express-prepaid-line" style="color:#047857"><span>Prepaid discount<br><small>Online payment offer</small></span><strong>- ${money(save, state.intent?.currency)}</strong></p>`; }
  // Uses the merchant's custom offer message (with {percent}/{amount}/{cap}
  // placeholders) when set; otherwise a default built from the percent/amount.
  function prepaidOfferText(saveMinor) {
    const cfg = state.settings?.prepaidDiscount;
    const cur = state.intent?.currency;
    const amount = money(saveMinor, cur);
    const percent = cfg && cfg.type === "PERCENTAGE" && Number(cfg.value) > 0 ? String(Number(cfg.value)).replace(/\.0+$/, "") + "%" : "";
    const cap = cfg && cfg.maxPaise != null ? money(cfg.maxPaise, cur) : "";
    const custom = cfg && typeof cfg.offerMessage === "string" ? cfg.offerMessage.trim() : "";
    if (custom) return custom.replace(/\{percent\}/gi, percent).replace(/\{amount\}/gi, amount).replace(/\{cap\}/gi, cap);
    return percent ? `Pay online & get ${percent} off — you save ${amount}` : `Pay online and save ${amount} — instant prepaid discount.`;
  }
  function prepaidOfferBanner() { if (state.codOnly) return ""; const save = prepaidDiscountPreviewPaise(); if (save <= 0) return ""; return `<p class="megaska-express-prepaid-banner" style="margin:0 0 10px;padding:9px 12px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font-size:13px;font-weight:600">🎉 ${escapeHtml(prepaidOfferText(save))}</p>`; }
  function storeCreditAppliedPaise() { return Math.round(Number(state.storeCredit?.appliedAmount || 0) * 100); }
  function remainingBasePayablePaise() { return Math.max(0, Number(state.intent?.totalAmountPaise || 0) - storeCreditAppliedPaise()); }
  // Client-side preview of the merchant's prepaid discount, mirroring the
  // server engine (services/express-checkout/pricing.ts). Purely for display —
  // the server remains authoritative — but it uses the same formula and the
  // same settings so the previewed number matches the charged number, letting
  // each payment method show its true price instantly (no round-trip flicker).
  function prepaidDiscountPreviewPaise() {
    const cfg = state.settings?.prepaidDiscount;
    if (!cfg || !cfg.enabled) return 0;
    const subtotal = Math.max(0, Math.floor(Number(state.intent?.subtotalAmountPaise || 0)));
    if (subtotal <= 0) return 0;
    const value = Number(cfg.value || 0);
    if (!(value > 0)) return 0;
    const minSubtotal = cfg.minSubtotalPaise == null ? null : Math.max(0, Math.floor(Number(cfg.minSubtotalPaise)));
    if (minSubtotal != null && subtotal < minSubtotal) return 0;
    const raw = cfg.type === "FIXED_AMOUNT" ? Math.floor(value) : Math.round(subtotal * (value / 100));
    const capped = cfg.maxPaise == null ? raw : Math.min(raw, Math.max(0, Math.floor(Number(cfg.maxPaise))));
    return Math.max(0, Math.min(subtotal, capped));
  }
  // Method-specific payable, computed from the same terms the server assembles:
  // total = max(0, subtotal + shipping + codFee − discount − prepaidDiscount).
  function methodTotalPaise(method) {
    const subtotal = Math.max(0, Number(state.intent?.subtotalAmountPaise || 0));
    const shipping = Math.max(0, Number(state.intent?.shippingAmountPaise || 0));
    const discount = Math.max(0, Number(state.intent?.discountAmountPaise || 0));
    const codFee = method === "COD" ? Math.max(0, Number(state.settings?.codFeeAmountPaise || 0)) : 0;
    const prepaidDiscount = method === "PREPAID" ? prepaidDiscountPreviewPaise() : 0;
    return Math.max(0, subtotal + shipping + codFee - discount - prepaidDiscount);
  }
  function payableAmount(method) {
    return Math.max(0, methodTotalPaise(method) - storeCreditAppliedPaise());
  }
  // What the shopper forfeits by choosing COD instead of paying online: the
  // prepaid discount they lose plus any COD fee they take on. Drives the
  // loss-framed nudge and the "₹X more than online" tag on the COD row.
  function codVsPrepaidExtraPaise() {
    return Math.max(0, payableAmount("COD") - payableAmount("PREPAID"));
  }
  // Loss-framed nudge shown on the COD step: name the amount they give up and
  // offer a one-tap switch back to online payment.
  function prepaidNudgeMarkup() {
    // COD-only mode (opened from the drawer's COD choice) never advertises the
    // prepaid alternative - the shopper already chose COD in the drawer.
    if (state.codOnly) return "";
    const extra = codVsPrepaidExtraPaise();
    if (extra <= 0) return "";
    const cur = state.intent?.currency;
    return `<div class="megaska-express-cod-nudge"><div class="megaska-express-cod-nudge-copy"><strong>💸 Pay online and keep ${money(extra, cur)}</strong><span>Cash on Delivery costs ${money(extra, cur)} more on this order.</span></div><button type="button" class="megaska-express-cod-nudge-btn" data-express-action="switch-to-prepaid">Pay online &amp; save</button></div>`;
  }

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
    { key: "UPI", backendMethod: "PREPAID", label: "UPI", subtitle: "Pay using any UPI app", badge: "Popular", icon: "upi" },
    { key: "CARD", backendMethod: "PREPAID", label: "Debit/Credit Cards", subtitle: "Visa, Mastercard, RuPay & more", icon: "card" },
    { key: "WALLET", backendMethod: "PREPAID", label: "Wallets", subtitle: "Amazon Pay, Paytm Wallet & more", icon: "wallet" },
    { key: "EMI", backendMethod: "PREPAID", label: "0% EMI on UPI & Cards", subtitle: "No-cost plans on eligible payments", icon: "emi" },
    { key: "NETBANKING", backendMethod: "PREPAID", label: "Netbanking", subtitle: "All major banks supported", icon: "netbanking" },
    { key: "COD", backendMethod: "COD", label: "Cash on Delivery", subtitle: "Pay when your order is delivered", icon: "cod" },
  ];

  function displayMethodForBackend(method) {
    if (method === "COD") return "COD";
    return "UPI";
  }

  function selectedDisplayPaymentMethod() {
    const selected = state.selectedDisplayPaymentMethod || displayMethodForBackend(payMethod());
    if (selected === "COD" && isCodUnavailable()) return "UPI";
    return DISPLAY_PAYMENT_METHODS.some((method) => method.key === selected) ? selected : "UPI";
  }

  function backendPaymentMethodForDisplay(displayMethod) {
    return DISPLAY_PAYMENT_METHODS.find((method) => method.key === displayMethod)?.backendMethod || "PREPAID";
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
      <div class="megaska-express-upi-details"><strong>Enter your UPI ID</strong><p>Payable amount: ${escapeHtml(totalLabel)}</p><small>We’ll send a secure collect request to your UPI app.</small><div class="megaska-express-upi-apps">${apps.map((app) => `<span>${escapeHtml(app)}</span>`).join("")}</div><small>🔒 Secure UPI payment powered by Razorpay.</small></div>
    </div>`;
  }

  function paymentMethodRows(selectedMethod, disabled) {
    // In COD-only mode the modal presents Cash on Delivery alone; prepaid is
    // completed on Shopify Checkout, so the Razorpay methods are not offered.
    const methods = state.codOnly
      ? DISPLAY_PAYMENT_METHODS.filter((method) => method.backendMethod === "COD")
      : DISPLAY_PAYMENT_METHODS;
    return methods.map((method) => {
      const codDisabled = method.key === "COD" && isCodUnavailable();
      const rowDisabled = disabled || codDisabled;
      const selected = method.key === selectedMethod && !codDisabled;
      const prepaidSave = method.backendMethod === "PREPAID" ? prepaidDiscountPreviewPaise() : 0;
      const codExtra = method.backendMethod === "COD" ? codVsPrepaidExtraPaise() : 0;
      const subtitle = codDisabled
        ? "COD unavailable for this pincode"
        : prepaidSave > 0
          ? `Save ${money(prepaidSave, state.intent?.currency)} · ${method.subtitle}`
          : codExtra > 0
            ? `${money(codExtra, state.intent?.currency)} more than paying online`
            : method.subtitle;
      const totalLabel = state.hydration.intent !== "ready" ? "Calculating..." : money(payableAmount(method.backendMethod), state.intent?.currency);
      const disabledStyle = codDisabled ? ' style="opacity:0.5;pointer-events:none;cursor:not-allowed;" aria-disabled="true"' : "";
      return `<label class="megaska-express-payment-option ${selected ? "is-selected" : ""} ${method.key === "UPI" ? "megaska-express-payment-option--upi" : "megaska-express-payment-option--compact"}" data-express-payment-method="${escapeHtml(method.key)}"${disabledStyle}>
        <input type="radio" name="paymentMethod" value="${escapeHtml(method.key)}" ${selected ? "checked" : ""} ${rowDisabled ? "disabled" : ""}>
        <span class="megaska-express-payment-icon">${paymentMethodIcon(method.icon)}</span>
        <span class="megaska-express-payment-copy"><span class="megaska-express-payment-title"><strong>${escapeHtml(method.label)}</strong>${method.badge ? `<em>${escapeHtml(method.badge)}</em>` : ""}</span><small>${escapeHtml(subtitle)}</small></span>
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
    const selectedDisplayMethod = selectedDisplayPaymentMethod();
    const priceHydrating = state.hydration.intent !== "ready";
    const addressHydrating = state.hydration.session !== "ready" || state.hydration.address === "loading" || state.hydration.intent === "loading";
   const storeCreditFullyCovers = !priceHydrating && storeCreditAppliedPaise() > 0 && remainingBasePayablePaise() <= 0;
    const rows = lines().slice(0, 3).map((line) => `<article class="megaska-express-line"><span>${lineImage(line) ? `<img src="${escapeHtml(lineImage(line))}" alt="${escapeHtml(lineTitle(line))}" loading="lazy">` : `<i></i>`}</span><div class="megaska-express-line-copy"><b>${escapeHtml(lineTitle(line))}</b><em>${lineVariant(line) ? `${escapeHtml(lineVariant(line))} · ` : ""}Qty ${escapeHtml(line.quantity || 1)}</em></div><strong>${money(linePrice(line), intent.currency)}</strong></article>`).join("");
    const extraCount = Math.max(0, lines().length - 3);
    const hasAddress = hasCompleteAddress(currentAddress) && !state.editingAddress;
    const savedPincodeMarkup = hasAddress && state.savedPincodeMessage ? `<p class="megaska-express-saved-pincode-status" data-express-saved-pincode-message data-status="${escapeHtml(state.savedPincodeStatus)}">${escapeHtml(state.savedPincodeMessage)}</p>` : "";
    const storeCreditBlock = renderStoreCreditBlock(intent, priceHydrating);
    const addressMarkup = addressHydrating && !hasAddress
      ? `<section class="megaska-express-stack"><h3>Delivery address</h3><p class="megaska-otp-step-subtitle" aria-live="polite">Loading saved address...</p></section>`
      : hasAddress
        ? `<section class="megaska-express-stack"><div class="megaska-express-section-head"><h3>Delivery address</h3><button class="megaska-express-link-btn" type="button" data-express-action="change-address">Change Address ›</button></div><div class="megaska-express-address-card"><span class="megaska-express-address-icon" aria-hidden="true">⌖</span><div><strong>${escapeHtml(currentAddress.name)}</strong><p>${escapeHtml(currentAddress.address1)}${currentAddress.address2 ? `, ${escapeHtml(currentAddress.address2)}` : ""}</p><p>${escapeHtml(currentAddress.city)}, ${escapeHtml(currentAddress.province)} ${escapeHtml(currentAddress.zip)}, ${escapeHtml(currentAddress.country)}</p><p>${escapeHtml(intent.phoneSnapshot || currentAddress.phone)}</p>${savedPincodeMarkup}</div></div></section>`
        : `<form data-express-form="address" class="megaska-express-stack" novalidate><h3>Delivery address</h3><input name="name" value="${escapeHtml(currentAddress.name || "")}" placeholder="Full name" required><input name="email" value="${escapeHtml(currentAddress.email || state.customer?.email || "")}" placeholder="Email" type="email"><input value="${escapeHtml(intent.phoneSnapshot || currentAddress.phone || "Verified phone")}" disabled><input name="zip" value="${escapeHtml(currentAddress.zip || state.customer?.postalCode || "")}" placeholder="PIN code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required><p class="megaska-express-pincode-status" data-express-pincode-message data-status="${escapeHtml(state.pincodeStatus)}">${escapeHtml(state.pincodeMessage)}</p><p class="megaska-express-pincode-eta" data-express-pincode-eta>${state.pincodeEta ? `Estimated delivery by ${escapeHtml(formatEta(state.pincodeEta))}` : ""}</p><div class="megaska-express-fields"><input name="city" value="${escapeHtml(currentAddress.city || state.customer?.city || "")}" placeholder="City" required><input name="province" value="${escapeHtml(currentAddress.province || state.customer?.stateProvince || "")}" placeholder="State" required></div><input name="address1" value="${escapeHtml(currentAddress.address1 || state.customer?.addressLine1 || "")}" placeholder="Address line 1" required><input name="address2" value="${escapeHtml(currentAddress.address2 || state.customer?.addressLine2 || "")}" placeholder="Address line 2 / Landmark"><input name="country" value="${escapeHtml(currentAddress.country || "India")}" placeholder="Country" required><button type="submit" ${!state.intent?.id || state.busy ? "disabled" : ""}>Save address</button><p class="megaska-otp-step-subtitle">Address is saved to your checkout and profile.</p></form>`;
    root.innerHTML = `${state.error ? `<p class="megaska-otp-error">${escapeHtml(state.error)}</p>` : ""}<header class="megaska-express-modal-header"><div class="megaska-express-logo">${logoMarkup()}</div><div class="megaska-express-heading"><p class="megaska-otp-step-subtitle">Secure Checkout</p><h2 id="megaska-express-title" class="megaska-otp-step-title">Express checkout</h2></div></header><div class="megaska-express-progress"><span>Address</span><span>Payment</span></div><section class="megaska-express-summary"><h3>Order summary</h3>${rows || `<p class="megaska-otp-step-subtitle">${state.hydration.cart === "loading" ? "Loading cart summary..." : "Cart details unavailable."}</p>`}${extraCount ? `<p class="megaska-otp-step-subtitle">+ ${extraCount} more item${extraCount > 1 ? "s" : ""}</p>` : ""}<div class="megaska-express-totals" data-express-totals>${totalsMarkup()}</div></section>${addressMarkup}${storeCreditBlock}<section class="megaska-express-stack megaska-express-payment${storeCreditFullyCovers ? " megaska-express-payment--store-credit-only" : ""}" data-express-payment-section>${storeCreditFullyCovers ? renderStoreCreditOrderPanel() : (state.inlinePaymentMode ? renderInlinePaymentPanel(selectedDisplayMethod) : renderPaymentMethodList())}</section><div class="megaska-express-sticky-cta"><div class="megaska-express-sticky-trust"><p><span>🔒</span><strong>100% Secure Payments</strong></p><p><span>🛡</span><strong>Trusted & Reliable</strong></p></div><div class="megaska-express-sticky-main"><div data-express-footer-total>${footerAmountsMarkup()}</div></div></div>`;
    console.info("[EXPRESS UI] payment chips rendered", {
      paymentOptionCount: document.querySelectorAll(".megaska-express-payment-option").length,
      selectedDisplayMethod,
    });
  }

  function renderStoreCreditBlock(intent, priceHydrating) {
    const credit = state.storeCredit || {};
    if (!credit.loading && Number(credit.availableAmount || 0) <= 0 && Number(credit.appliedAmount || 0) <= 0) return "";
    const appliedPaise = storeCreditAppliedPaise();
    const remainingPaise = remainingBasePayablePaise();
    return `<section class="megaska-express-stack megaska-express-store-credit"><h3>Store Credit</h3>${credit.loading ? `<p class="megaska-otp-step-subtitle">Loading Store Credit...</p>` : `<div class="megaska-express-store-credit-card"><label class="megaska-express-store-credit-toggle"><input type="checkbox" ${appliedPaise > 0 ? "checked" : ""} ${state.busy ? "disabled" : ""} data-express-action="${appliedPaise > 0 ? "release-store-credit" : "apply-store-credit"}"><span class="megaska-express-store-credit-check" aria-hidden="true">${appliedPaise > 0 ? "✓" : " "}</span><span class="megaska-express-store-credit-copy"><strong>${appliedPaise > 0 ? "Store Credit applied" : "Apply Store Credit "}</strong><small>Available Store Credit ${money(Math.round(Number(credit.availableAmount || 0) * 100), credit.currency || intent.currency)}</small></span></label>${appliedPaise > 0 ? `<div class="megaska-express-store-credit-breakdown"><p><span>Using</span><strong>${money(appliedPaise, credit.currency || intent.currency)}</strong></p><p><span>Remaining payment</span><strong>${priceHydrating ? "Calculating..." : money(remainingPaise, credit.currency || intent.currency)}</strong></p></div>` : ""}</div>`}${credit.error ? `<p class="megaska-otp-error">${escapeHtml(credit.error)}</p>` : ""}</section>`;
  }

  async function loadStoreCredit() {
    if (!state.intent?.id) return;
    try {
      state.storeCredit = Object.assign({}, state.storeCredit, { loading: true, error: "" });
      const data = await apiFetch(`/express/checkout/store-credit/available?checkoutIntentId=${encodeURIComponent(state.intent.id)}`);
      state.storeCredit = { loading: false, availableAmount: Number(data.availableAmount || 0), appliedAmount: Number(data.appliedAmount || 0), remainingPayable: Number(data.remainingPayable || 0), currency: data.currency || "INR", enabled: Number(data.appliedAmount || 0) > 0, error: "" };
    } catch (_error) {
      state.storeCredit = Object.assign({}, state.storeCredit, { loading: false, error: "" });
    }
  }

  async function applyStoreCredit() {
    if (!state.intent?.id || state.busy) return;
    try {
      state.busy = true; state.storeCredit.error = ""; render();
      const data = await apiFetch(`/express/checkout/store-credit/apply`, { method: "POST", body: { checkoutIntentId: state.intent.id } });
      state.storeCredit = { loading: false, availableAmount: Number(data.availableAmount || 0), appliedAmount: Number(data.appliedAmount || 0), remainingPayable: Number(data.remainingPayable || 0), currency: data.currency || "INR", enabled: true, error: "" };
      resetInlinePaymentState();
      invalidateCodPolicy("store_credit_apply");
      state.busy = false; render();
    } catch (_error) {
      state.busy = false; state.storeCredit = Object.assign({}, state.storeCredit, { error: "Unable to apply Store Credit right now. You can continue checkout without it." }); render();
    }
  }

  async function releaseStoreCredit() {
    if (!state.intent?.id || state.busy) return;
    state.busy = true; render();
    const data = await apiFetch(`/express/checkout/store-credit/release`, { method: "POST", body: { checkoutIntentId: state.intent.id } }).catch(() => null);
    state.storeCredit = Object.assign({}, state.storeCredit, { appliedAmount: 0, remainingPayable: data?.remainingPayable ?? null, enabled: false, error: "" });
    resetInlinePaymentState();
    invalidateCodPolicy("store_credit_release");
    state.busy = false; render();
  }

  async function refreshIntent() { const startedAt = perfNow(); const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}`); state.intent = data.intent; state.pricing = data.pricing || null; state.customerDefaultAddress = data.customerDefaultAddress || state.customerDefaultAddress; state.settings = Object.assign({}, state.settings, data.settings || {}); state.discountCode = state.intent?.discounts?.[0]?.code || state.discountCode; await loadStoreCredit(); invalidateCodPolicy("intent_refresh"); perfDetails("intent_fetch_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - startedAt) }); }

  async function createIntent(cartPromise) {
    state.hydration.cart = "loading";
    render();
    const cart = await (cartPromise || readCart());
    if (!Number(cart?.item_count || 0)) throw new Error("Your cart is empty.");
    const snapshot = cartSnapshot(cart);
    state.intent = Object.assign({}, state.intent || {}, { cartSnapshot: snapshot, subtotalAmountPaise: cartSubtotalPaise(cart), discountAmountPaise: cartDiscountPaise(cart), shippingAmountPaise: 0, totalAmountPaise: cartTotalPaise(cart), currency: snapshot.currency || "INR" });
    state.hydration.cart = "ready";
    state.hydration.intent = "loading";
    render();
    const startedAt = perfNow();
    const data = await apiFetch("/express/checkout/intents", { method: "POST", body: { cartToken: snapshot.token, cartSnapshot: snapshot, subtotalAmountPaise: cartSubtotalPaise(cart), discountAmountPaise: cartDiscountPaise(cart), shippingAmountPaise: 0, codFeeAmountPaise: 0, totalAmountPaise: cartTotalPaise(cart), currency: snapshot.currency || "INR" } });
    state.intent = data.intent;
    state.pricing = data.pricing || null;
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
    // Store credit is a secondary enhancement: load it in the background so the
    // payment methods and totals appear as soon as the intent exists, instead of
    // blocking the whole modal on its round-trip. It re-renders in place when it
    // resolves (a no-op for the common case where the shopper has no credit).
    void loadStoreCredit().then(() => { if (state.open) render(); }).catch(() => {});
  }

  async function open(opts) {
    try { if (!state.open && window.LoopDeskAnalytics) window.LoopDeskAnalytics.track('MODAL_OPEN'); } catch (e) {}
    const openStart = Number(opts?.openStart || perfNow());
    state.open = true; state.step = "checkout"; state.error = ""; state.busy = false; state.paymentStarted = false; state.orderSubmitting = false; state.intent = null; state.pricing = null; state.customer = null; state.customerDefaultAddress = null; state.addressDraft = {}; state.editingAddress = false; state.discountMessage = ""; state.storeCredit = { loading: false, availableAmount: 0, appliedAmount: 0, remainingPayable: null, currency: "INR", enabled: false, error: "" }; state.inlinePaymentMode = false; state.inlinePaymentError = ""; state.activeRazorpayOrder = null; state.activeRazorpayOrderPromise = null; state.activeRazorpayInstance = null; state.prepaidWarmupKey = ""; state.prepaidWarmupCompletedKey = ""; state.prepaidWarmupPromise = null; state.codLocked = false; state.addressSavedForIntentId = null; state.paymentInProgress = false; resetCodAdvanceState(); resetDeliveryServiceability(); state.pincode = ""; state.pincodeStatus = "idle"; state.pincodeMessage = "Enter 6-digit PIN code to check delivery."; state.pincodeEta = ""; state.pincodeCity = ""; state.pincodeState = ""; state.lastCheckedPincode = ""; state.pincodeCache = {}; state.savedPincode = ""; state.savedPincodeStatus = "idle"; state.savedPincodeMessage = ""; state.savedPincodeEta = ""; state.lastCheckedSavedPincode = ""; state.hydration = { session: "loading", cart: "idle", intent: "idle", address: "loading", discount: "loading", pincode: "idle", payment: "loading" }; resetApiCallPerf(openStart);
    // COD-only open (from the drawer's COD choice): present Cash on Delivery
    // alone and lock it, so the background prepaid warm-up never runs and the
    // Razorpay methods are never offered.
    state.codOnly = Boolean(opts?.codOnly);
    if (state.codOnly) { state.selectedDisplayPaymentMethod = "COD"; state.codLocked = true; }
    const modal = ensureModal(); modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.documentElement.classList.add("megaska-otp-open"); render();
    try {
      // Fetch the Shopify cart in parallel with the shell paint + auth check: it
      // depends on neither and needs no token, so racing it removes a round-trip
      // from the boot waterfall. The no-op catch just prevents an early rejection
      // from surfacing as unhandled; createIntent still awaits (and rethrows) it.
      const cartPromise = readCart();
      cartPromise.catch(() => {});
      await waitForModalShellPaint(openStart);
      if (!(await ensureAuthenticated(opts?.triggerEl, opts?.event, { codOnly: state.codOnly }))) { close(); return; }
      state.hydration.session = "ready";
      render();
      await createIntent(cartPromise);
      // COD-only mode: switch the backend intent to COD immediately so the order
      // summary shows the COD total (not the prepaid price) from the first paint.
      if (state.codOnly) { try { await ensureBackendPaymentMethod("COD"); resetCodAdvanceState(); await loadCodPolicy("cod_only_open"); } catch (e) {} }
      debugLog("modal ready", { intentId: state.intent?.id }); render(); perfDetails("duplicate_api_calls_found", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, calls: state.perf.apiCalls }); perfDetails("modal_ready_total_ms", { shopId: getShopDomain() || null, intentId: state.intent?.id || null, duplicateCallsFound: state.perf.duplicateCallsFound, durationMs: Math.round(perfNow() - openStart) }); const initialZip = ensureModal().querySelector('[name="zip"]')?.value || ""; if (initialZip) schedulePincodeCheck(initialZip); const savedAddress = address(); const savedZip = hasCompleteAddress(savedAddress) ? savedAddress.zip : ""; if (savedZip) { state.addressSavedForIntentId = state.intent?.id || null; scheduleSavedAddressPincodeCheck(savedZip); if (backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) !== "COD") warmupPrepaidPayment(selectedDisplayPaymentMethod()); }
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
    const intentIdRaw = state.intent.id;
    const intentId = encodeURIComponent(intentIdRaw);
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
    invalidateCodPolicy("address_change");
    state.addressSavedForIntentId = intentIdRaw;
    state.editingAddress = false;
  }

  async function onSubmit(event) {
    const form = event.target.closest("[data-express-form]"); if (!form) return; event.preventDefault();
    if (form.dataset.expressForm === "inline-payment") {
      try { await submitInlinePayment(form.dataset.inlineMethod || selectedDisplayPaymentMethod(), new FormData(form)); }
      catch (error) { showInlinePaymentError(error instanceof Error ? error.message : "Check payment details and try again."); }
      return;
    }
    try { state.busy = true; state.error = ""; render(); if (form.dataset.expressForm === "address") await saveAddressFromCheckout(); await refreshIntent(); invalidateCodPolicy("discount_change"); state.busy = false; render(); } catch (error) { state.busy = false; state.error = error instanceof Error ? error.message : "Something went wrong."; render(); }
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

  async function ensurePaymentMethod(method) { return ensureBackendPaymentMethod(method); }

  async function setSelectedDisplayPaymentMethod(method) {
    if (state.paymentUpdating) return;
    if (method === "COD" && isCodUnavailable()) return;
    if (!DISPLAY_PAYMENT_METHODS.some((item) => item.key === method)) return;
    const previousDisplayMethod = selectedDisplayPaymentMethod();
    const previousOptimisticPaymentMethod = state.optimisticPaymentMethod;
    const backendMethod = backendPaymentMethodForDisplay(method);
    state.paymentUpdating = true;
    state.selectedDisplayPaymentMethod = method;
    state.inlinePaymentMode = true;
    state.inlinePaymentError = "";
    if (backendMethod === "COD") {
      // Explicit COD choice wins over any in-flight/queued prepaid warm-up.
      state.codLocked = true;
      state.prepaidWarmupKey = "";
      state.prepaidWarmupCompletedKey = "";
      state.prepaidWarmupPromise = null;
      state.codAdvance = freshCodAdvanceState();
      codAdvanceState().loadingPolicy = true;
    } else {
      state.codLocked = false;
      resetCodAdvanceState();
    }
    renderPaymentSectionOnly();
    try {
      await ensureBackendPaymentMethod(backendMethod);
      if (state.intent?.selectedPaymentMethod !== backendMethod) throw new Error("Could not update payment method. Please try again.");
      resetCodAdvanceState();
      if (backendMethod === "COD") await loadCodPolicy("payment_method_select");
      else warmupPrepaidPayment(method);
    } catch (error) {
      state.selectedDisplayPaymentMethod = previousDisplayMethod;
      state.optimisticPaymentMethod = previousOptimisticPaymentMethod;
      state.codLocked = backendPaymentMethodForDisplay(previousDisplayMethod) === "COD";
      resetCodAdvanceState();
      state.inlinePaymentError = error instanceof Error ? error.message : "Could not update payment method. Please try again.";
    } finally {
      state.paymentUpdating = false;
      renderPaymentSectionOnly();
    }
  }

  function getInlinePaymentContainer() { return ensureModal().querySelector("[data-express-payment-section]"); }
function renderStoreCreditOrderPanel() {
  const busy = state.busy || state.orderSubmitting;
  return `<h3>Store Credit order</h3><div class="megaska-express-inline-panel megaska-express-store-credit-order-panel"><div class="megaska-express-inline-fields"><p><strong>Store Credit applied</strong></p><p><strong>Payment required: ₹0</strong></p><p class="megaska-express-secure-note">Store Credit covers this order. No Razorpay payment or COD collection is required.</p></div><button class="megaska-otp-primary-btn" type="button" data-express-action="store-credit-order" ${busy ? "disabled" : ""}>${state.orderSubmitting ? "Placing order..." : "Place Order with Store Credit"}</button></div>`;
}
  function renderPaymentMethodList() {
    const selectedMethod = selectedDisplayPaymentMethod();
    const paymentHydrating = state.hydration.payment !== "ready" || state.hydration.intent !== "ready";
    return `<h3>Payment method</h3>${prepaidOfferBanner()}<p class="megaska-express-payment-intro">Choose a payment option. Switching methods is instant; payment starts only after you submit the secure inline form.</p>${paymentHydrating ? `<p class="megaska-otp-step-subtitle" aria-live="polite">Loading payment options...</p>` : ""}<div class="megaska-express-payment-options">${paymentMethodRows(selectedMethod, paymentHydrating)}</div>`;
  }

  function renderInlinePaymentPanel(method) {
    if (remainingBasePayablePaise() <= 0) return renderStoreCreditOrderPanel(); 
    if (method === "COD" && isCodUnavailable()) method = "UPI";
    const totalLabel = money(payableAmount(backendPaymentMethodForDisplay(method)), state.intent?.currency);
    const title = method === "UPI" ? "Enter your UPI ID" : (DISPLAY_PAYMENT_METHODS.find((item) => item.key === method)?.label || method);
    const submitTitle = method === "UPI" ? "UPI" : title.replace("Debit/Credit Cards", "Card");
    const error = state.inlinePaymentError ? `<p class="megaska-express-inline-error" data-express-inline-error>${escapeHtml(state.inlinePaymentError)}</p>` : `<p class="megaska-express-inline-error" data-express-inline-error hidden></p>`;
    const busy = state.paymentInProgress || state.orderSubmitting;
    const cod = codAdvanceState();
    const submit = method === "COD" && cod.requiresAdvance ? `Pay ${money(cod.advanceAmountPaise, cod.currency)} & Confirm COD` : (method === "COD" ? "Place COD Order" : (method === "NETBANKING" ? "Continue to Netbanking" : `Pay ${totalLabel} via ${submitTitle}`));
    const cardFields = `<div class="megaska-express-card-grid"><input name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="Card number" required><input name="cardExpiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" required><input name="cardCvv" inputmode="numeric" autocomplete="cc-csc" placeholder="CVV" required><input name="cardName" autocomplete="cc-name" placeholder="Name on card" required></div>`;
    let fields = "";
    if (method === "UPI") fields = `<p class="megaska-otp-step-subtitle">We’ll send a secure collect request to your UPI app.</p><input name="vpa" inputmode="email" autocomplete="off" placeholder="yourname@upi" required><p class="megaska-express-secure-note">Secure UPI payment powered by Razorpay.</p>`;
    if (method === "CARD") fields = cardFields;
    if (method === "EMI") fields = `${cardFields}<div class="megaska-express-card-grid"><select name="bank" required><option value="">Select EMI bank</option><option value="HDFC">HDFC Bank</option><option value="ICIC">ICICI Bank</option><option value="SBIN">State Bank of India</option><option value="UTIB">Axis Bank</option><option value="KKBK">Kotak Bank</option></select><select name="emi_duration" required><option value="">Select tenure</option><option value="3">3 months</option><option value="6">6 months</option><option value="9">9 months</option><option value="12">12 months</option></select></div>`;
    if (method === "NETBANKING") fields = `<select name="bank" required><option value="">Select bank</option><option value="HDFC">HDFC Bank</option><option value="ICIC">ICICI Bank</option><option value="SBIN">State Bank of India</option><option value="UTIB">Axis Bank</option><option value="KKBK">Kotak Mahindra Bank</option></select>`;
    if (method === "WALLET") fields = `<div class="megaska-express-choice-grid"><label><input type="radio" name="wallet" value="paytm" required> Paytm</label><label><input type="radio" name="wallet" value="amazonpay" required> Amazon Pay</label><label><input type="radio" name="wallet" value="phonepe" required> PhonePe</label><label><input type="radio" name="wallet" value="freecharge" required> Freecharge</label></div>`;
    if (method === "COD") fields = renderCodAdvanceFields(totalLabel);
    if (method !== "COD" && isInlinePaymentUnavailableMessage(state.inlinePaymentError)) {
      return `<div class="megaska-express-inline-panel"><div class="megaska-express-inline-panel-head"><div><span>Selected method</span><h4>${escapeHtml(title)}</h4></div><button type="button" data-express-action="change-payment-method">Change payment method</button></div><div class="megaska-express-inline-fields"><p class="megaska-express-inline-error" data-express-inline-error>Inline payment is not available right now.</p><p class="megaska-express-secure-note">Continue with Razorpay’s secure hosted checkout to complete this payment.</p></div><button class="megaska-otp-primary-btn" type="button" data-express-action="standard-razorpay" ${busy ? "disabled" : ""}>${busy ? "Opening..." : "Continue with secure Razorpay Checkout"}</button></div>`;
    }
    const codDisabled = method === "COD" && (
      cod.loadingPolicy ||
      !cod.policyLoaded ||
      !cod.available ||
      !cod.eligible ||
      (
        cod.requiresAdvance &&
        !cod.verified &&
        (
          cod.advanceAmountPaise <= 0 ||
          cod.preventDuplicatePayment
        )
      )
    );
    const paymentMethodLocked = method === "COD" && (
      cod.verified ||
      cod.resumeAction === "CREATE_PARTIAL_COD_ORDER" ||
      cod.preventDuplicatePayment
    );
    const changePaymentMethodButton = paymentMethodLocked ? "" : `<button type="button" data-express-action="change-payment-method">Change payment method</button>`;
    const buttonAction = method === "COD" && cod.verified ? " data-express-action=\"resume-partial-cod-order\"" : "";
    const buttonLabel = method === "COD" && cod.verified ? "Continue to confirm order" : (busy ? "Processing..." : escapeHtml(submit));
    return `<form data-express-form="inline-payment" data-inline-method="${escapeHtml(method)}" class="megaska-express-inline-panel"><div class="megaska-express-inline-panel-head"><div><span>Selected method</span><h4>${escapeHtml(title)}</h4></div>${changePaymentMethodButton}</div>${error}<div class="megaska-express-inline-fields">${fields}</div><button class="megaska-otp-primary-btn" type="${method === "COD" && cod.verified ? "button" : "submit"}"${buttonAction} ${busy || codDisabled ? "disabled aria-disabled=\"true\"" : ""}>${buttonLabel}</button>${method !== "COD" ? `<button class="megaska-express-fallback-btn" type="button" data-express-action="standard-razorpay" hidden>Continue with secure Razorpay Checkout</button>` : ""}</form>`;
  }

  function codAdvanceBreakdownRow(label, value, emphasize) {
    return `<p class="megaska-express-cod-advance-row${emphasize ? " megaska-express-cod-advance-row--strong" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>`;
  }

  function renderCodAdvanceFields(totalLabel) {
    const cod = codAdvanceState();
    if (cod.loadingPolicy) return `<div class="megaska-express-cod-confirm" aria-live="polite"><strong>Confirm Cash on Delivery</strong><p>Loading Cash on Delivery options...</p></div>`;
    if (cod.policyLoaded && (!cod.available || !cod.eligible)) return `<div class="megaska-express-cod-confirm" aria-live="polite"><strong>Cash on Delivery unavailable</strong><p class="megaska-express-inline-error" data-express-inline-error>${escapeHtml(cod.error || cod.customerMessage || "Cash on Delivery is not available for this checkout.")}</p></div>`;
    if (!cod.requiresAdvance) return `<div class="megaska-express-cod-confirm" aria-live="polite">${prepaidNudgeMarkup()}<strong>Confirm Cash on Delivery</strong><p>${escapeHtml(state.settings?.codInformationText || "Pay to the delivery agent at delivery.")}</p><p>Total payable on delivery: <b>${escapeHtml(totalLabel)}</b></p>${cod.error ? `<p class="megaska-express-inline-error" data-express-inline-error>${escapeHtml(cod.error)}</p>` : ""}</div>`;
    if (cod.verified) {
      return `<div class="megaska-express-cod-confirm megaska-express-cod-advance" aria-live="polite" tabindex="-1" data-express-cod-success><strong>Advance payment received</strong><p>${escapeHtml(money(cod.advanceAmountPaise, cod.currency))} paid online</p><p>${escapeHtml(money(cod.codBalanceAmountPaise, cod.currency))} due on delivery</p>${cod.error ? `<p class="megaska-express-secure-note">${escapeHtml(cod.error)}</p>` : ""}</div>`;
    }
    const rows = [
      codAdvanceBreakdownRow("Order total", money(cod.orderTotalPaise, cod.currency)),
      cod.storeCreditAppliedPaise > 0 ? codAdvanceBreakdownRow("Store Credit", `- ${money(cod.storeCreditAppliedPaise, cod.currency)}`) : "",
      codAdvanceBreakdownRow("Amount payable by customer  : ", money(cod.customerCashLiabilityPaise, cod.currency), true),
      codAdvanceBreakdownRow("Pay now to confirm  : ", money(cod.advanceAmountPaise, cod.currency), true),
      codAdvanceBreakdownRow("Pay on delivery  : ", money(cod.codBalanceAmountPaise, cod.currency), true),
    ].join("");
    const message = cod.customerMessage || cod.policyText || "A small online advance is required to confirm this Cash on Delivery order.";
    return `<div class="megaska-express-cod-confirm megaska-express-cod-advance" aria-live="polite"><strong>${escapeHtml(cod.customerTitle || "Confirm Cash on Delivery")}</strong><div class="megaska-express-cod-advance-breakdown">${rows}</div><p>${escapeHtml(message)}</p>${cod.error ? `<p class="megaska-express-inline-error" data-express-inline-error tabindex="-1">${escapeHtml(cod.error)}</p>` : ""}</div>`;
  }

  // Inner HTML of the order-summary totals block. Method-dependent (COD adds its
  // fee and drops the prepaid discount; PREPAID applies it), so it is factored
  // out of render() to be refreshed in place whenever the method changes.
  function totalsMarkup() {
    const intent = state.intent || {};
    const priceHydrating = state.hydration.intent !== "ready";
    const selected = payMethod();
    const totalAmount = priceHydrating ? "Calculating..." : money(payableAmount(selected), intent.currency);
    return `<p><span>Merchandise subtotal</span><strong>${priceHydrating ? "Calculating..." : money(intent.subtotalAmountPaise, intent.currency)}</strong></p>${discountSummary(intent)}${prepaidSummary(selected)}<p><span>Delivery</span><strong>${Number(intent.shippingAmountPaise || 0) ? money(intent.shippingAmountPaise, intent.currency) : "Free"}</strong></p>${checkoutTaxSummary()}<p class="megaska-express-total"><span>You pay</span><strong>${totalAmount}</strong></p>`;
  }

  // Sticky-footer payable. When the two methods cost the same (no prepaid
  // discount / no COD fee) or COD is unavailable, a single figure is clearer;
  // otherwise show both Prepaid and COD side by side with the current choice
  // highlighted, so the shopper is never surprised by which price applies.
  function footerAmountsMarkup() {
    const cur = state.intent?.currency;
    if (state.hydration.intent !== "ready") return `<span>Total Payable</span><strong>Calculating...</strong>`;
    const selected = payMethod();
    const prepaidPaise = payableAmount("PREPAID");
    const codPaise = payableAmount("COD");
    const codAvailable = typeof isCodUnavailable === "function" ? !isCodUnavailable() : true;
    // COD-only mode shows the COD total alone - no Prepaid/COD comparison.
    if (state.codOnly) {
      return `<span>Total Payable</span><strong>${money(codPaise, cur)}</strong>`;
    }
    if (!codAvailable || prepaidPaise === codPaise) {
      return `<span>Total Payable</span><strong>${money(payableAmount(selected), cur)}</strong>`;
    }
    const amount = (key, label, paise) => `<div class="megaska-express-footer-amount${selected === key ? " is-active" : ""}"><em>${label}</em><b>${money(paise, cur)}</b></div>`;
    return `<span class="megaska-express-footer-label">Payable Amount</span><div class="megaska-express-footer-amounts">${amount("PREPAID", "Prepaid", prepaidPaise)}${amount("COD", "COD", codPaise)}</div>`;
  }

  // The sticky footer total and the order-summary totals sit outside the payment
  // section, so a payment-section-only re-render would leave them stale on a
  // method switch (e.g. COD still showing the prepaid-discounted total). Refresh
  // them in place alongside every payment-section render.
  function renderTotalsOnly() {
    const modal = ensureModal();
    if (!modal) return;
    const totals = modal.querySelector("[data-express-totals]");
    if (totals) totals.innerHTML = totalsMarkup();
    const footerTotal = modal.querySelector("[data-express-footer-total]");
    if (footerTotal) footerTotal.innerHTML = footerAmountsMarkup();
  }

  function renderPaymentSectionOnly() {
    const section = getInlinePaymentContainer();
    if (!section) return;
    section.innerHTML = state.inlinePaymentMode ? renderInlinePaymentPanel(selectedDisplayPaymentMethod()) : renderPaymentMethodList();
    renderTotalsOnly();
  }

  async function ensureBackendPaymentMethod(method) {
    if (!state.intent?.id) throw new Error("Checkout is not ready yet.");
    if (state.intent?.selectedPaymentMethod === method && state.optimisticPaymentMethod !== method) {
      state.optimisticPaymentMethod = null;
      return;
    }
    // A background prepaid warm-up must never override an explicit COD choice.
    // Without this, a warm-up POST that lands after the shopper taps COD flips
    // the intent back to PREPAID and the sticky total diverges from the COD box.
    if (method === "PREPAID" && state.codLocked) return;
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/payment-method`, { method: "POST", body: { method } });
    if (data?.intent) state.intent = data.intent;
    if (method === "COD") {
      state.activeRazorpayOrder = null;
      state.activeRazorpayOrderPromise = null;
    }
    state.optimisticPaymentMethod = null;
    if (state.intent?.selectedPaymentMethod !== method) await refreshIntent();
    if (state.intent?.selectedPaymentMethod !== method) throw new Error("Could not update payment method. Please try again.");
  }


  async function warmupPrepaidPayment(displayMethod) {
    const method = backendPaymentMethodForDisplay(displayMethod);
    const intentId = state.intent?.id;
    if (remainingBasePayablePaise() <= 0 || method === "COD" || state.codLocked || !intentId) return null;
    const warmupKey = `${intentId}:${displayMethod || selectedDisplayPaymentMethod()}`;
    if (state.prepaidWarmupCompletedKey === warmupKey && state.activeRazorpayOrder?.intentId === intentId && state.intent?.selectedPaymentMethod === "PREPAID") return state.prepaidWarmupPromise;
    if (state.prepaidWarmupKey === warmupKey && state.prepaidWarmupPromise) return state.prepaidWarmupPromise;
    state.prepaidWarmupKey = warmupKey;
    state.prepaidWarmupPromise = (async () => {
      try {
        if (state.codLocked) return;
        const scriptPromise = ensureRazorpayScript();
        await ensureBackendPaymentMethod("PREPAID");
        if (state.codLocked) return;
        await Promise.all([scriptPromise, ensureRazorpayOrder()]);
        state.prepaidWarmupCompletedKey = warmupKey;
      } catch (error) {
        if (window.console && typeof window.console.info === "function") {
          console.info("[EXPRESS PAYMENT PERF] prepaid_warmup_non_fatal", {
            intentId,
            selectedDisplayMethod: displayMethod || selectedDisplayPaymentMethod(),
            message: error instanceof Error ? error.message : "Payment warmup failed",
          });
        }
      }
    })().finally(() => {
      if (state.prepaidWarmupKey === warmupKey) state.prepaidWarmupPromise = null;
    });
    return state.prepaidWarmupPromise;
  }

  async function ensureAddressSavedOnce() {
    if (state.addressSavedForIntentId === state.intent?.id && hasCompleteAddress(address()) && !state.editingAddress) return;
    await saveAddressFromCheckout();
  }

  async function proceedWithSelectedPayment(displayMethod) {
    if (state.orderSubmitting || state.paymentInProgress) return;
    await setSelectedDisplayPaymentMethod(displayMethod);
  }

  function onChange(event) {
    if (!event.target.matches('input[name="paymentMethod"]')) return;
    if (event.target.disabled) return;
    void setSelectedDisplayPaymentMethod(event.target.value);
  }

  function findRazorpayScript(src) {
    return Array.from(document.querySelectorAll("script[src]")).find((script) => script.src === src);
  }

  function logRazorpayScriptLoaded(label, src) {
    if (window.console && typeof window.console.debug === "function") {
      window.console.debug(`[Megaska Express] Razorpay ${label} script loaded`, { src });
    }
  }

  function restoreRazorpayGlobal(previousConstructor, preferredConstructor) {
    if (preferredConstructor) window.Razorpay = preferredConstructor;
    else if (previousConstructor) window.Razorpay = previousConstructor;
  }

  function hasInlineCreatePayment(RazorpayCtor) {
    try {
      if (typeof RazorpayCtor !== "function") return false;
      const prototype = RazorpayCtor.prototype || {};
      if (typeof prototype.createPayment === "function") return true;

      try {
        const probe = Object.create(prototype);
        return typeof probe.createPayment === "function";
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  function loadRazorpayConstructor(src, cacheKey, unavailableMessage, preferredRestoreKey, isSupported) {
    if (window[cacheKey] && (!isSupported || isSupported(window[cacheKey]))) return Promise.resolve(window[cacheKey]);
    const previousConstructor = window.Razorpay;
    return new Promise((resolve, reject) => {
      const finish = () => {
        const constructor = window.Razorpay;
        if (typeof constructor !== "function" || (isSupported && !isSupported(constructor))) {
          restoreRazorpayGlobal(previousConstructor, window[preferredRestoreKey]);
          reject(new Error(unavailableMessage));
          return;
        }
        window[cacheKey] = constructor;
        logRazorpayScriptLoaded(cacheKey === "MegaskaRazorpayInline" ? "inline" : "checkout", src);
        restoreRazorpayGlobal(previousConstructor, window[preferredRestoreKey]);
        resolve(constructor);
      };
      const fail = () => {
        restoreRazorpayGlobal(previousConstructor, window[preferredRestoreKey]);
        reject(new Error(unavailableMessage));
      };
      const existing = findRazorpayScript(src);
      if (existing && window.Razorpay && !window[cacheKey] && (!isSupported || isSupported(window.Razorpay))) {
        finish();
        return;
      }
      const script = document.createElement("script");
      window.Razorpay = undefined;
      script.src = src;
      script.async = true;
      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", fail, { once: true });
      document.head.appendChild(script);
    });
  }

  function ensureRazorpayScript() {
    if (backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) === "COD" || state.intent?.selectedPaymentMethod === "COD") return Promise.reject(new Error("COD orders do not use Razorpay."));
    if (hasInlineCreatePayment(window.MegaskaRazorpayInline)) return Promise.resolve(window.MegaskaRazorpayInline);
    if (!state.razorpayInlineScriptPromise) {
      state.razorpayInlineScriptPromise = loadRazorpayConstructor(RAZORPAY_INLINE_SCRIPT_SRC, "MegaskaRazorpayInline", "Razorpay inline script loaded but is unavailable.", "MegaskaRazorpayCheckout", hasInlineCreatePayment).catch((error) => { state.razorpayInlineScriptPromise = null; throw error; });
    }
    return state.razorpayInlineScriptPromise;
  }

  function ensureRazorpayCheckoutScript() {
    if (backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) === "COD" || state.intent?.selectedPaymentMethod === "COD") return Promise.reject(new Error("COD orders do not use Razorpay."));
    if (window.MegaskaRazorpayCheckout) return Promise.resolve(window.MegaskaRazorpayCheckout);
    if (!state.razorpayCheckoutScriptPromise) {
      state.razorpayCheckoutScriptPromise = loadRazorpayConstructor(RAZORPAY_CHECKOUT_SCRIPT_SRC, "MegaskaRazorpayCheckout", "Unable to load Razorpay Checkout.", "MegaskaRazorpayInline").catch((error) => { state.razorpayCheckoutScriptPromise = null; throw error; });
    }
    return state.razorpayCheckoutScriptPromise;
  }

  function loadRazorpay() { return ensureRazorpayScript(); }

  async function ensureRazorpayOrder() {
    if (backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) === "COD" || state.intent?.selectedPaymentMethod === "COD") throw new Error("COD orders do not use Razorpay.");
    const intentId = state.intent?.id;
    if (state.activeRazorpayOrder?.intentId === intentId) return state.activeRazorpayOrder.checkout;
    if (state.activeRazorpayOrderPromise?.intentId === intentId) return state.activeRazorpayOrderPromise.promise;
    const promise = (async () => {
      const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(intentId)}/razorpay-order`, { method: "POST", body: {} });
      const checkout = data.checkout || {};
      if (!checkout.razorpayOrderId || !checkout.key) throw new MegaskaApiError("Could not start secure payment. Please try again.", { stage: "RAZORPAY_ORDER_CREATE", code: "RAZORPAY_ORDER_DETAILS_MISSING" });
      state.activeRazorpayOrder = { intentId, checkout };
      return checkout;
    })().finally(() => {
      if (state.activeRazorpayOrderPromise?.intentId === intentId) state.activeRazorpayOrderPromise = null;
    });
    state.activeRazorpayOrderPromise = { intentId, promise };
    return promise;
  }

  function sanitizedRazorpaySuccessShape(response) {
    const body = response && typeof response === "object" ? response : {};
    const payment = body.payment && typeof body.payment === "object" ? body.payment : null;
    const order = body.order && typeof body.order === "object" ? body.order : null;
    return {
      topLevelKeys: Object.keys(body),
      paymentKeys: payment ? Object.keys(payment) : [],
      orderKeys: order ? Object.keys(order) : [],
      hasRazorpayOrderId: Boolean(body.razorpay_order_id),
      hasRazorpayPaymentId: Boolean(body.razorpay_payment_id),
      hasRazorpaySignature: Boolean(body.razorpay_signature),
      hasOrderId: Boolean(body.order_id || order?.id),
      hasPaymentId: Boolean(body.payment_id || payment?.id),
      hasSignature: Boolean(body.signature),
      intentId: state.intent?.id || null,
      activeRazorpayOrderId: state.activeRazorpayOrder?.checkout?.razorpayOrderId || null,
      normalizedOrderId: body.razorpay_order_id || body.order_id || order?.id || null,
      normalizedPaymentId: body.razorpay_payment_id || body.payment_id || payment?.id || null,
    };
  }

  function normalizeRazorpaySuccessPayload(response) {
    const body = response && typeof response === "object" ? response : {};
    const payment = body.payment && typeof body.payment === "object" ? body.payment : null;
    const order = body.order && typeof body.order === "object" ? body.order : null;
    return {
      razorpay_order_id: String(body.razorpay_order_id || body.order_id || order?.id || state.activeRazorpayOrder?.checkout?.razorpayOrderId || "").trim(),
      razorpay_payment_id: String(body.razorpay_payment_id || body.payment_id || payment?.id || "").trim(),
      razorpay_signature: String(body.razorpay_signature || body.signature || "").trim(),
    };
  }


  function checkoutResponseIntentId(payload) {
    return String(payload?.intentId || payload?.intent?.id || payload?.orderLink?.intentId || "").trim();
  }

  function checkoutResponseOrderName(payload) {
    return String(payload?.shopifyOrder?.name || payload?.shopifyOrderName || payload?.orderName || "").trim();
  }

  function checkoutResponseOrderId(payload) {
    return String(payload?.shopifyOrder?.id || payload?.shopifyOrderId || "").trim();
  }

  function assertFreshCheckoutSuccess(payload, paymentMethod) {
    const currentIntentId = String(state.intent?.id || "").trim();
    const returnedIntentId = checkoutResponseIntentId(payload);
    const orderName = checkoutResponseOrderName(payload);
    const orderId = checkoutResponseOrderId(payload);
    const acceptedCompletionSource = payload?.completionSource === "draft_order_complete" || (paymentMethod === "PREPAID" && payload?.completionSource === "fresh_completion");
    const freshCompletion = payload?.freshCompletion === true && acceptedCompletionSource;
    const recovery = payload?.recovery === true || payload?.idempotent === true || payload?.code === "stale_order_link" || !acceptedCompletionSource;
    console.info("[Megaska Express] checkout_success_validation", {
      currentIntentId,
      returnedIntentId,
      returnedOrderName: orderName || null,
      returnedOrderId: orderId || null,
      freshCompletion,
      recovery,
      paymentMethod,
      successAccepted: Boolean(payload?.ok === true && payload?.success === true && currentIntentId && returnedIntentId === currentIntentId && orderId && orderName && freshCompletion && !recovery),
    });
    if (payload?.ok !== true || payload?.success !== true) {
      console.info("[Megaska Express] checkout_success_rejected", { currentIntentId, returnedIntentId, returnedOrderName: orderName || null, returnedOrderId: orderId || null, paymentMethod, reason: "not_success_response" });
      throw new Error("Order confirmation was not successful. Please try again.");
    }
    if (!currentIntentId || returnedIntentId !== currentIntentId) {
      console.info("[Megaska Express] checkout_success_rejected", { currentIntentId, returnedIntentId, returnedOrderName: orderName || null, returnedOrderId: orderId || null, paymentMethod, reason: "intent_mismatch" });
      throw new Error("Order confirmation did not match this checkout attempt. Please try again.");
    }
    if (!orderId || !orderName) {
      console.info("[Megaska Express] checkout_success_rejected", { currentIntentId, returnedIntentId, returnedOrderName: orderName || null, returnedOrderId: orderId || null, paymentMethod, reason: "missing_current_order" });
      throw new Error("Order confirmation was incomplete. Please contact support if the order was created.");
    }
    if (!freshCompletion || recovery) {
      console.info("[Megaska Express] checkout_success_rejected", { currentIntentId, returnedIntentId, returnedOrderName: orderName || null, returnedOrderId: orderId || null, paymentMethod, reason: recovery ? "recovery_or_stale_source" : "not_fresh_draft_order_complete" });
      throw new Error("We could not confirm a new order for this checkout attempt. Please try again.");
    }
    console.info("[Megaska Express] checkout_success_accepted", { currentIntentId, returnedIntentId, returnedOrderName: orderName, returnedOrderId: orderId, paymentMethod, reason: "fresh_draft_order_complete" });
    return { orderName, orderId, freshCompletion, recovery };
  }

  function showCheckoutSuccess(payload, paymentMethod) {
    const confirmation = assertFreshCheckoutSuccess(payload, paymentMethod);
    state.step = "success";
    state.error = `${confirmation.orderName} has been created.`;
    state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.paymentInProgress = false; state.activeRazorpayInstance = null;
  }

  function paymentSuccess(response) {
    const payload = normalizeRazorpaySuccessPayload(response);
    console.info("[Megaska Express] Razorpay payment.success payload shape", sanitizedRazorpaySuccessShape(response));
    if (!payload.razorpay_order_id || !payload.razorpay_payment_id || !payload.razorpay_signature) {
      console.error("[Megaska Express] Razorpay payment.success missing verification fields", { intentId: state.intent?.id || null, activeRazorpayOrder: state.activeRazorpayOrder || null, normalizedPayload: payload, rawResponse: response });
      state.inlinePaymentError = "Payment received but order confirmation is pending. Please contact support.";
      state.error = state.inlinePaymentError;
      state.busy = false; state.orderSubmitting = false; state.paymentInProgress = false; state.activeRazorpayInstance = null;
      renderPaymentSectionOnly();
      showInlinePaymentError(state.inlinePaymentError);
      return Promise.resolve();
    }
    return apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/razorpay-verify`, { method: "POST", body: payload }).then(async (verified) => {
      showCheckoutSuccess(verified, "PREPAID");
      await refreshIntent(); render();
    }).catch((error) => {
      console.error("[Megaska Express] Razorpay payment verified by gateway but order confirmation is pending", { intentId: state.intent?.id || null, payload, error });
      state.inlinePaymentError = error instanceof Error ? error.message : "Payment received but order confirmation is pending. Please contact support.";
      state.error = state.inlinePaymentError;
      state.busy = false; state.orderSubmitting = false; state.paymentInProgress = false; state.activeRazorpayInstance = null;
      renderPaymentSectionOnly();
      showInlinePaymentError(state.inlinePaymentError);
    });
  }

  function attachRazorpayListeners(instance) {
    if (!instance || instance.__megaskaListenersAttached) return instance;
    if (typeof instance.on === "function") {
      instance.on("payment.success", paymentSuccess);
      instance.on("payment.error", (error) => {
        const message = error?.error?.description || error?.description || "Payment failed. Please check details and try again.";
        state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.paymentInProgress = false; state.activeRazorpayInstance = null; renderPaymentSectionOnly();
        if (selectedDisplayPaymentMethod() === "EMI") showInlinePaymentError(`${message} If EMI is not available for this card, try Card payment instead.`);
        else showInlinePaymentError(message);
      });
    }
    instance.__megaskaListenersAttached = true;
    return instance;
  }

  function razorpayScriptSrc(src) {
    return findRazorpayScript(src)?.src || null;
  }

  function logRazorpayRuntimeDiagnostics(rzp, checkout, displayMethod, RazorpayInline) {
    const diagnostics = {
      windowRazorpayType: typeof window.Razorpay,
      inlineScriptSrc: razorpayScriptSrc(RAZORPAY_INLINE_SCRIPT_SRC),
      checkoutScriptSrc: razorpayScriptSrc(RAZORPAY_CHECKOUT_SCRIPT_SRC),
      razorpayOrderIdPresent: Boolean(checkout?.razorpayOrderId),
      keyPresent: Boolean(checkout?.key),
      instanceKeys: rzp && typeof rzp === "object" ? Object.keys(rzp) : [],
      inlineCreatePaymentType: typeof rzp?.createPayment,
      selectedPaymentMethod: displayMethod,
    };
    if (typeof rzp?.createPayment === "function") {
      if (window.console && typeof window.console.debug === "function") window.console.debug("[Megaska Express] Razorpay runtime diagnostics", diagnostics);
    } else if (window.console && typeof window.console.warn === "function") {
      window.console.warn("[Megaska Express] Razorpay inline createPayment unavailable", diagnostics);
    }
    if (window.console && typeof window.console.info === "function") {
      window.console.info("[Megaska Express] inline payment runtime", {
        selectedPaymentMethod: displayMethod,
        inlineConstructorAvailable: typeof RazorpayInline === "function",
        createPaymentType: typeof rzp?.createPayment,
        inlineScriptSrc: razorpayScriptSrc(RAZORPAY_INLINE_SCRIPT_SRC),
        checkoutScriptSrc: razorpayScriptSrc(RAZORPAY_CHECKOUT_SCRIPT_SRC),
        hasMegaskaInline: Boolean(window.MegaskaRazorpayInline),
        hasMegaskaCheckout: Boolean(window.MegaskaRazorpayCheckout),
      });
    }
  }

  function createRazorpayInstance(RazorpayInline, checkout, displayMethod) {
    const options = buildStandardRazorpayOptions(checkout, displayMethod);
    const instance = new RazorpayInline(options);
    state.activeRazorpayInstance = attachRazorpayListeners(instance);
    logRazorpayRuntimeDiagnostics(state.activeRazorpayInstance, checkout, displayMethod, RazorpayInline);
    return state.activeRazorpayInstance;
  }

  function buildStandardRazorpayOptions(checkout, displayMethod) {
    const display = buildRazorpayDisplayConfig(displayMethod);
    const options = {
      key: checkout.key, amount: checkout.amountPaise, currency: checkout.currency || "INR", name: shopLabel(), description: "Express Checkout", order_id: checkout.razorpayOrderId, checkout_config_id: "config_T7vYfjdxuFvAQM", prefill: checkout.customer || {}, notes: checkout.notes || {},
      handler: paymentSuccess,
      modal: { ondismiss: () => { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.paymentInProgress = false; state.activeRazorpayInstance = null; showInlinePaymentError("Payment was not completed. You can try again."); } },
    };
    if (display) options.display = display;
    return options;
  }

  function isInlinePaymentUnavailableMessage(message) { return /createPayment|standard Razorpay|unavailable|Inline payment is not available/i.test(String(message || "")); }

  function showInlinePaymentError(message) {
    state.inlinePaymentError = message || "Payment failed. Please try again.";
    renderPaymentSectionOnly();
    const el = ensureModal().querySelector("[data-express-inline-error]");
    if (el) { el.hidden = false; el.textContent = state.inlinePaymentError; }
    const fallback = ensureModal().querySelector('[data-express-action="standard-razorpay"]');
    if (fallback && isInlinePaymentUnavailableMessage(state.inlinePaymentError)) fallback.hidden = false;
  }

  function resetInlinePaymentState() { state.activeRazorpayInstance = null; state.activeRazorpayOrder = null; state.activeRazorpayOrderPromise = null; state.prepaidWarmupKey = ""; state.prepaidWarmupCompletedKey = ""; state.prepaidWarmupPromise = null; state.paymentInProgress = false; state.paymentStarted = false; state.orderSubmitting = false; state.inlinePaymentError = ""; state.inlinePaymentMode = false; }

  async function createOrder() {
    const paymentMethod = backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) === "COD" || state.intent?.selectedPaymentMethod === "COD" ? "COD" : "PREPAID";
    const currentIntentId = String(state.intent?.id || "").trim();
    console.info("[Megaska Express] checkout_submit_branch", { branch: "create_order", currentIntentId, selectedPaymentMethod: paymentMethod });
    const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(currentIntentId)}/order`, { method: "POST", body: {} });
    const responsePaymentMethod = data?.paymentMethod || paymentMethod;
    console.info("[Megaska Express] checkout_order_response", { currentIntentId, returnedIntentId: checkoutResponseIntentId(data), returnedOrderName: checkoutResponseOrderName(data) || null, returnedOrderId: checkoutResponseOrderId(data) || null, selectedPaymentMethod: paymentMethod, freshCompletion: data?.freshCompletion === true, completionSource: data?.completionSource || null });
   showCheckoutSuccess(data, responsePaymentMethod);
    render();
  }

  function inlinePayload(method, data, checkout) {
    const basePayload = { order_id: checkout.razorpayOrderId, amount: checkout.amountPaise, currency: checkout.currency || "INR", email: checkout.customer?.email || state.customer?.email || "", contact: checkout.customer?.contact || state.intent?.phoneSnapshot || "" };
    const card = () => ({ "card[number]": String(data.get("cardNumber") || "").replace(/\s+/g, ""), "card[expiry]": String(data.get("cardExpiry") || "").trim(), "card[cvv]": String(data.get("cardCvv") || "").trim(), "card[name]": String(data.get("cardName") || "").trim() });
    if (method === "UPI") return Object.assign(basePayload, { method: "upi", vpa: String(data.get("vpa") || "").trim() });
    if (method === "CARD") return Object.assign(basePayload, { method: "card" }, card());
    if (method === "EMI") return Object.assign(basePayload, { method: "emi", bank: String(data.get("bank") || ""), emi_duration: String(data.get("emi_duration") || "") }, card());
    if (method === "NETBANKING") return Object.assign(basePayload, { method: "netbanking", bank: String(data.get("bank") || "") });
    if (method === "WALLET") return Object.assign(basePayload, { method: "wallet", wallet: String(data.get("wallet") || "") });
    return basePayload;
  }

  function validateInlinePayment(method, data) {
    if (method === "UPI" && !/^[\w.-]+@[\w.-]+$/.test(String(data.get("vpa") || "").trim())) throw new Error("Enter a valid UPI ID, for example name@bank.");
    if (["CARD", "EMI"].includes(method)) {
      if (String(data.get("cardNumber") || "").replace(/\s+/g, "").length < 12) throw new Error("Enter a valid card number.");
      if (!/^\d{2}\/?\d{2,4}$/.test(String(data.get("cardExpiry") || "").trim())) throw new Error("Enter expiry as MM/YY.");
      if (!/^\d{3,4}$/.test(String(data.get("cardCvv") || "").trim())) throw new Error("Enter a valid CVV.");
      if (!String(data.get("cardName") || "").trim()) throw new Error("Enter the name on card.");
    }
    if (method === "EMI" && (!data.get("bank") || !data.get("emi_duration"))) throw new Error("Select EMI bank and tenure.");
    if (method === "NETBANKING" && !data.get("bank")) throw new Error("Select your bank.");
    if (method === "WALLET" && !data.get("wallet")) throw new Error("Select your wallet.");
  }

  function logCheckoutSubmitBranch(method, branch) {
    if (window.console && typeof window.console.info === "function") {
      window.console.info("[Megaska Express] checkout_submit_branch", {
        paymentMethod: method,
        intentStatus: state.intent?.status || null,
        remainingPayable: remainingBasePayablePaise(),
        storeCreditApplied: storeCreditAppliedPaise(),
        branch,
      });
    }
  }

  async function submitInlinePayment(method, formData) {
    if (method === "COD" && isCodUnavailable()) {
      state.selectedDisplayPaymentMethod = "UPI";
      state.inlinePaymentMode = true;
      throw new Error("COD unavailable for this pincode");
    }
    if (state.paymentInProgress) return;
    const cod = codAdvanceState();
    if (method === "COD") {
      if (cod.loadingPolicy) {
        cod.error = "Cash on Delivery options are still loading. Please wait.";
        renderPaymentSectionOnly();
        return;
      }

      if (!cod.policyLoaded) {
        cod.error = "Cash on Delivery options could not be confirmed. Please retry.";
        loadCodPolicy("submit_retry");
        renderPaymentSectionOnly();
        return;
      }

      if (!cod.available || !cod.eligible) {
        cod.error =
          cod.customerMessage ||
          "Cash on Delivery is not available for this checkout.";
        renderPaymentSectionOnly();
        return;
      }

      if (cod.requiresAdvance) {
        return startCodAdvancePayment();
      }
    }
    const submitStartedAt = perfNow();
    const remainingPayable = remainingBasePayablePaise();
    const branch = remainingPayable <= 0 ? "STORE_CREDIT_ONLY" : (method === "COD" ? "COD" : "RAZORPAY");
    logCheckoutSubmitBranch(method, branch);
    if (branch === "RAZORPAY") validateInlinePayment(method, formData);
    state.paymentInProgress = true; state.orderSubmitting = true; state.busy = true; state.paymentStarted = branch === "RAZORPAY"; state.inlinePaymentError = ""; renderPaymentSectionOnly();
    try {
      if (state.addressSavedForIntentId !== state.intent?.id || !hasCompleteAddress(address()) || state.editingAddress) await ensureAddressSavedOnce();
      paymentPerfLog("address_ready_ms", submitStartedAt, { alreadySaved: state.addressSavedForIntentId === state.intent?.id });
      if (branch === "STORE_CREDIT_ONLY") return createOrder();
      await ensureBackendPaymentMethod(backendPaymentMethodForDisplay(method));
      paymentPerfLog("payment_method_ready_ms", submitStartedAt, { backendPaymentMethod: backendPaymentMethodForDisplay(method) });
      if (branch === "COD") {
        console.info("[Megaska Express] razorpay_branch_skipped_for_cod", { intentId: state.intent?.id || null, intentStatus: state.intent?.status || null, selectedPaymentMethod: method, remainingPayable });
        return createOrder();
      }
      console.info("[EXPRESS PAYMENT PERF] prepaid_submit_start", {
        intentId: state.intent?.id || null,
        selectedDisplayMethod: method,
        backendPaymentMethod: backendPaymentMethodForDisplay(method),
      });
      const scriptPromise = ensureRazorpayScript();
      const hadCachedOrder = state.activeRazorpayOrder?.intentId === state.intent?.id;
      const orderPromise = hadCachedOrder ? Promise.resolve(state.activeRazorpayOrder.checkout) : ensureRazorpayOrder();
      const RazorpayInline = await scriptPromise;
      paymentPerfLog("razorpay_script_ready_ms", submitStartedAt);
      const checkout = await orderPromise;
      paymentPerfLog("razorpay_order_ready_ms", submitStartedAt, { cached: hadCachedOrder });
      const rzp = createRazorpayInstance(RazorpayInline, checkout, method);
      if (typeof rzp.createPayment !== "function") {
        state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false; state.paymentStarted = false; state.activeRazorpayInstance = null; renderPaymentSectionOnly();
        showInlinePaymentError("Inline payment is unavailable right now. Please use secure payment popup."); return;
      }
      paymentPerfLog("create_payment_called_ms", submitStartedAt);
      rzp.createPayment(inlinePayload(method, formData, checkout));
    } catch (error) {
      state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false; state.paymentStarted = false; state.activeRazorpayInstance = null;
      renderPaymentSectionOnly();
      showInlinePaymentError(error instanceof Error ? error.message : (branch === "COD" ? "We could not place your COD order." : "Payment was not completed. You can try again."));
    }
  }

  function applyCodOrderPayload(data) {
    const cod = codAdvanceState();
    const returned = data?.cod || {};
    cod.codAdvanceIntentId = returned.codAdvanceIntentId || cod.codAdvanceIntentId;
    cod.advanceAmountPaise = Number(returned.advanceAmountPaise || cod.advanceAmountPaise || 0);
    cod.codBalanceAmountPaise = Number(returned.codBalanceAmountPaise || cod.codBalanceAmountPaise || 0);
    cod.orderTotalPaise = Number(returned.orderTotalPaise || cod.orderTotalPaise || 0);
    cod.storeCreditAppliedPaise = Number(returned.storeCreditAppliedPaise || cod.storeCreditAppliedPaise || 0);
    cod.customerCashLiabilityPaise = Math.max(0, cod.orderTotalPaise - cod.storeCreditAppliedPaise);
    cod.currency = data?.razorpayOrder?.currency || returned.currency || cod.currency || "INR";
    cod.razorpayOrderId = data?.razorpayOrder?.id || null;
    cod.paymentId = data?.paymentId || cod.paymentId || null;
  }

  function buildCodAdvanceRazorpayOptions(order) {
    return {
      key: order.keyId, order_id: order.id, amount: order.amount, currency: order.currency || "INR", name: shopLabel(), description: "COD advance payment",
      prefill: { email: state.customer?.email || "", contact: state.intent?.phoneSnapshot || state.customer?.phoneE164 || state.customer?.phone || "" },
      handler: verifyCodAdvancePayment,
      modal: { ondismiss: () => { const cod = codAdvanceState(); cod.creatingOrder = false; cod.verifying = false; cod.error = "Payment was not completed. You can try again."; state.busy = false; state.orderSubmitting = false; state.paymentInProgress = false; state.activeRazorpayInstance = null; codAdvanceLog("cod_advance.ui.payment_dismissed"); renderPaymentSectionOnly(); } },
    };
  }

  async function startCodAdvancePayment() {
    const cod = codAdvanceState();
    if (cod.loadingPolicy || cod.creatingOrder || cod.verifying || cod.verified || cod.preventDuplicatePayment || cod.advanceAmountPaise <= 0) return;
    cod.creatingOrder = true; cod.error = null; state.paymentInProgress = true; state.orderSubmitting = true; renderPaymentSectionOnly();
    try {
      await ensureAddressSavedOnce();
      await ensureBackendPaymentMethod("COD");
      const RazorpayCheckout = await ensureRazorpayCheckoutScriptForCodAdvance();
      const data = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/cod-advance/razorpay-order`, { method: "POST", body: {} });
      applyCodOrderPayload(data);
      if (cod.advanceAmountPaise <= 0) throw new Error("COD advance is not available for this checkout. Please review payment options.");
      const order = data?.razorpayOrder || {};
      if (!order.id || !order.keyId || !order.amount) throw new Error("Could not start COD advance payment. Please try again.");
      codAdvanceLog("cod_advance.ui.payment_started", { razorpayOrderId: order.id });
      state.activeRazorpayInstance = new RazorpayCheckout(buildCodAdvanceRazorpayOptions(order));
      cod.creatingOrder = false;
      state.activeRazorpayInstance.open();
    } catch (error) {
      cod.creatingOrder = false; state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false;
      cod.error = codAdvanceErrorMessage(error);
      if (error?.code === "PAYMENT_IN_PROGRESS") cod.retryAfterMs = Date.now() + 5000;
      renderPaymentSectionOnly();
    }
  }

  async function verifyCodAdvancePayment(response) {
    const payload = normalizeRazorpaySuccessPayload(response);
    const cod = codAdvanceState();
    if (!payload.razorpay_order_id || !payload.razorpay_payment_id || !payload.razorpay_signature) { cod.error = "Payment verification failed. Please retry or contact support if money was deducted."; renderPaymentSectionOnly(); return; }
    cod.verifying = true; cod.error = null; renderPaymentSectionOnly();
    try {
      const verified = await apiFetch(`/express/checkout/intents/${encodeURIComponent(state.intent.id)}/cod-advance/razorpay/verify`, { method: "POST", body: payload });
      const returned = verified?.cod || {};
      cod.verified = verified?.verified === true; cod.verificationReused = Boolean(verified?.reused); cod.verifiedAt = new Date().toISOString();
      cod.paymentId = verified?.paymentId || payload.razorpay_payment_id; cod.codAdvanceIntentId = returned.codAdvanceIntentId || cod.codAdvanceIntentId;
      cod.advanceAmountPaise = Number(returned.advancePaidPaise || cod.advanceAmountPaise || 0); cod.codBalanceAmountPaise = Number(returned.codBalanceAmountPaise || cod.codBalanceAmountPaise || 0); cod.orderTotalPaise = Number(returned.orderTotalPaise || cod.orderTotalPaise || 0); cod.storeCreditAppliedPaise = Number(returned.storeCreditAppliedPaise || cod.storeCreditAppliedPaise || 0); cod.currency = returned.currency || cod.currency || "INR";
      cod.resumeAction = cod.verified && verified?.resume?.allowed === true && verified?.resume?.nextAction === "CREATE_PARTIAL_COD_ORDER" ? "CREATE_PARTIAL_COD_ORDER" : null;
      cod.verifying = false; state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false; state.activeRazorpayInstance = null; cod.error = null;
      codAdvanceLog("cod_advance.ui.payment_verified", { reused: cod.verificationReused }); if (cod.resumeAction) codAdvanceLog("cod_advance.ui.resume_ready", { nextAction: cod.resumeAction });
      renderPaymentSectionOnly();
      window.setTimeout(() => ensureModal().querySelector("[data-express-cod-success]")?.focus(), 0);
    } catch (error) {
      cod.verifying = false; state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false;
      cod.error = codAdvanceErrorMessage(error); codAdvanceLog("cod_advance.ui.verification_failed", { code: error?.code || null });
      if (error?.code === "COD_ADVANCE_RECONCILIATION_REQUIRED") cod.preventDuplicatePayment = true;
      if (error?.code === "COD_ADVANCE_POLICY_CHANGED") loadCodPolicy("policy_changed");
      renderPaymentSectionOnly();
    }
  }

  function resumePartialCodOrder() {
    const cod = codAdvanceState();
    if (cod.verified && cod.resumeAction === "CREATE_PARTIAL_COD_ORDER") {
      cod.error = "Advance received. Your order is ready to be confirmed.";
      renderPaymentSectionOnly();
    }
  }

  function ensureRazorpayCheckoutScriptForCodAdvance() {
    if (window.MegaskaRazorpayCheckout) return Promise.resolve(window.MegaskaRazorpayCheckout);
    if (!state.razorpayCheckoutScriptPromise) state.razorpayCheckoutScriptPromise = loadRazorpayConstructor(RAZORPAY_CHECKOUT_SCRIPT_SRC, "MegaskaRazorpayCheckout", "Unable to load Razorpay Checkout.", "MegaskaRazorpayInline").catch((error) => { state.razorpayCheckoutScriptPromise = null; throw error; });
    return state.razorpayCheckoutScriptPromise;
  }

  async function openStandardRazorpayFallback() {
    if (backendPaymentMethodForDisplay(selectedDisplayPaymentMethod()) === "COD") {
      await submitInlinePayment("COD", new FormData(ensureModal().querySelector('[data-express-form="inline-payment"]') || document.createElement("form")));
      return;
    }
    try {
      state.inlinePaymentError = ""; state.paymentInProgress = true; state.orderSubmitting = true; state.busy = true; renderPaymentSectionOnly();
      await ensureAddressSavedOnce(); await ensureBackendPaymentMethod("PREPAID");
      const RazorpayCheckout = await ensureRazorpayCheckoutScript();
      const checkout = await ensureRazorpayOrder();
      const options = buildStandardRazorpayOptions(checkout, selectedDisplayPaymentMethod());
      logRazorpayDisplayConfig(selectedDisplayPaymentMethod(), options.display?.blocks?.selected_method?.instruments?.[0]?.method || null, options);
      state.activeRazorpayInstance = new RazorpayCheckout(options);
      state.activeRazorpayInstance.open();
    } catch (error) { state.paymentInProgress = false; state.orderSubmitting = false; state.busy = false; state.activeRazorpayInstance = null; showInlinePaymentError(prepaidPlaceOrderMessage(error)); renderPaymentSectionOnly(); }
  }

  async function placeOrder() {
    const method = selectedDisplayPaymentMethod();
    await submitInlinePayment(method, new FormData(ensureModal().querySelector('[data-express-form="inline-payment"]') || document.createElement("form")));
  }

  async function onActionClick(event) {
    const paymentRow = event.target.closest("[data-express-payment-method]");
    if (paymentRow) {
      event.preventDefault();
      const input = paymentRow.querySelector('input[name="paymentMethod"]');
      if (input?.disabled) return;
      await proceedWithSelectedPayment(paymentRow.getAttribute("data-express-payment-method"));
      return;
    }

    const action = event.target.closest("[data-express-action]")?.getAttribute("data-express-action"); if (!action) return;
    try {
      if (action === "retry") await open({});
      if (action === "change-address") { state.editingAddress = true; state.addressSavedForIntentId = null; render(); }
      if (action === "change-payment-method") {
        if (codAdvanceState().verified || codAdvanceState().resumeAction === "CREATE_PARTIAL_COD_ORDER" || codAdvanceState().preventDuplicatePayment) return;
        state.inlinePaymentMode = false; state.inlinePaymentError = ""; renderPaymentSectionOnly();
      }
      if (action === "standard-razorpay") await openStandardRazorpayFallback();
      if (action === "switch-to-prepaid") { try { if (window.LoopDeskAnalytics) window.LoopDeskAnalytics.track('COD_NUDGE_SWITCH_PREPAID'); } catch (e) {} await setSelectedDisplayPaymentMethod("UPI"); }
      if (action === "apply-store-credit") await applyStoreCredit();
      if (action === "release-store-credit") await releaseStoreCredit();
      if (action === "resume-partial-cod-order") resumePartialCodOrder();
      if (action === "store-credit-order") { logCheckoutSubmitBranch(selectedDisplayPaymentMethod(), "STORE_CREDIT_ONLY"); state.orderSubmitting = true; state.busy = true; renderPaymentSectionOnly(); await ensureAddressSavedOnce(); await createOrder(); }
    } catch (error) { state.busy = false; state.orderSubmitting = false; state.paymentStarted = false; state.paymentInProgress = false; state.error = error instanceof Error ? error.message : "Something went wrong."; render(); }
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
