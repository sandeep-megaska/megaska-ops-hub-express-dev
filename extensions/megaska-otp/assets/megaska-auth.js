(function () {
  const API_BASE = "https://megaska-ops-hub-exs1.vercel.app/api";
  const SESSION_KEY = "megaska_session_token";
  const ACCOUNT_ENTRY_SELECTORS = [
    "[data-megaska-open-login]",
    "a[href='/account']",
    "a[href^='/account?']",
    "a[href$='/account']",
    "a[href='/account/login']",
    "a[href^='/account/login?']",
    "a[href*='/account/login']",
    "a[href*='/account/register']",
    "[data-account-link]",
    "[data-customer-login]",
    ".header__icon--account",
    ".header__account",
    ".site-nav__link--account",
    ".js_link_acc",
    ".kalles-account-icon",
    ".iccl-user",
    ".icon-user",
    ".site-header__account",
    ".customer-account-link",
    "[aria-label*='account' i]",
    "[title*='account' i]",
  ];

  function normalizeShopDomain(input) {
    return String(input || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .toLowerCase();
  }

  function getCurrentShopDomain() {
    const fromWindowMegaska = normalizeShopDomain(
      typeof window !== "undefined" ? window.MEGASKA_SHOP_DOMAIN : ""
    );
    if (fromWindowMegaska) return fromWindowMegaska;

    const fromWindowShopify = normalizeShopDomain(
      typeof window !== "undefined" ? window?.Shopify?.shop : ""
    );
    if (fromWindowShopify) return fromWindowShopify;

    const fromHtml = normalizeShopDomain(
      document?.documentElement?.getAttribute?.("data-shop-domain")
    );
    if (fromHtml) return fromHtml;

    const fromBody = normalizeShopDomain(
      document?.body?.getAttribute?.("data-shop-domain")
    );
    if (fromBody) return fromBody;

    const canonicalHref =
      document?.querySelector?.("link[rel='canonical']")?.getAttribute?.("href") || "";
    if (canonicalHref) {
      try {
        const url = new URL(canonicalHref, window.location.origin);
        const fromCanonical = normalizeShopDomain(url.hostname);
        if (fromCanonical) return fromCanonical;
      } catch (_error) {}
    }

    const locationHost = normalizeShopDomain(
      typeof window !== "undefined" ? window.location.hostname : ""
    );
    if (locationHost && locationHost.includes(".myshopify.com")) {
      return locationHost;
    }

    return "";
  }

  function getSessionToken() {
    return localStorage.getItem(SESSION_KEY) || "";
  }

  function setSessionToken(token) {
    if (!token) return;
    localStorage.setItem(SESSION_KEY, token);
  }

  function clearSessionToken() {
    localStorage.removeItem(SESSION_KEY);
  }

  function buildHeaders(extraHeaders) {
    const token = getSessionToken();
    const shopDomain = getCurrentShopDomain();

    const headers = Object.assign(
      {
        "Content-Type": "application/json",
      },
      extraHeaders || {}
    );

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (shopDomain) {
      headers["x-shopify-shop-domain"] = shopDomain;
    }

    return headers;
  }

  function buildApiUrl(path) {
    const shopDomain = getCurrentShopDomain();
    const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
    const url = new URL(`${API_BASE}${normalizedPath}`);

    // Send shop in query also as a safe fallback for proxies/CDN/header-stripping edge cases.
    if (shopDomain) {
      url.searchParams.set("shop", shopDomain);
    }

    return url.toString();
  }

  async function apiFetch(path, options) {
    const opts = Object.assign(
      {
        method: "GET",
        headers: buildHeaders(),
      },
      options || {}
    );

    opts.headers = buildHeaders(opts.headers);

    const response = await fetch(buildApiUrl(path), opts);

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        (data && (data.error || data.message)) ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }

    return data;
  }

  function extractCustomer(sessionPayload) {
    return (
      sessionPayload?.customer ||
      sessionPayload?.user ||
      sessionPayload?.data?.customer ||
      null
    );
  }

  function extractSessionToken(payload) {
    return (
      payload?.sessionToken ||
      payload?.token ||
      payload?.data?.sessionToken ||
      payload?.data?.token ||
      ""
    );
  }

  async function requestOtp(phone) {
    return apiFetch("/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  }

  async function verifyOtp(phone, otp) {
    const data = await apiFetch("/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    });

   const token = extractSessionToken(data);
console.log("[Megaska Auth] verifyOtp response token", {
  hasToken: Boolean(token),
  tokenLength: token ? token.length : 0,
});

if (token) {
  setSessionToken(token);
  console.log("[Megaska Auth] session token saved", {
    hasStoredToken: Boolean(getSessionToken()),
  });
}

    return data;
  }

  async function fetchSession() {
  const token = getSessionToken();

  if (!token) {
    return {
      authenticated: false,
      customer: null,
    };
  }

  try {
    const data = await apiFetch("/auth/session", {
      method: "GET",
    });

    if (!data?.authenticated) {
      return {
        authenticated: false,
        customer: null,
      };
    }

    return {
      authenticated: true,
      customer: extractCustomer(data),
      raw: data,
    };
  } catch (error) {
    console.warn("[Megaska Auth] Session check failed, keeping token", error);

    return {
      authenticated: false,
      customer: null,
      error,
    };
  }
}
  async function fetchDashboardSummary() {
    return apiFetch("/dashboard/summary", {
      method: "GET",
    });
  }

  async function completeProfile(payload) {
    return apiFetch("/profile/complete", {
      method: "POST",
      body: JSON.stringify({
        firstName: payload?.firstName || "",
        lastName: payload?.lastName || "",
        email: payload?.email || "",
        addressLine1: payload?.addressLine1 || "",
        addressLine2: payload?.addressLine2 || "",
        city: payload?.city || "",
        stateProvince: payload?.stateProvince || "",
        postalCode: payload?.postalCode || "",
        countryRegion: payload?.countryRegion || "",
      }),
    });
  }

  async function logout() {
    const token = getSessionToken();

    if (!token) {
      return { success: true, revoked: false };
    }

    try {
      const data = await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      clearSessionToken();
      return data;
    } catch (error) {
      clearSessionToken();
      throw error;
    }
  }

  function splitName(fullNameRaw) {
    const normalized = String(fullNameRaw || "").replace(/\s+/g, " ").trim();
    if (!normalized) return { firstName: "", lastName: "" };

    const parts = normalized.split(" ");
    return {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ").trim(),
    };
  }

  function buildCheckoutPrefillParams(customer) {
    const source = customer || {};
    const fullName = source.fullName || source.firstName || "";
    const nameParts = splitName(fullName);
    const firstName = String(source.firstName || nameParts.firstName || "").trim();
    const lastName = String(source.lastName || nameParts.lastName || "").trim();
    const email = String(source.email || "").trim();
    const phone = String(source.phoneE164 || source.phone || "").trim();
    const addressLine1 = String(source.addressLine1 || "").trim();
    const addressLine2 = String(source.addressLine2 || "").trim();
    const city = String(source.city || "").trim();
    const stateProvince = String(source.stateProvince || "").trim();
    const postalCode = String(source.postalCode || "").trim();
    const countryRegion = String(source.countryRegion || "").trim();
    const params = {};

    if (email) {
      params["checkout[email]"] = email;
    }

    if (phone) {
      params["checkout[shipping_address][phone]"] = phone;
      params["checkout[phone]"] = phone;
      params["checkout[contact][phone]"] = phone;
    }

    if (firstName) {
      params["checkout[shipping_address][first_name]"] = firstName;
    }
    if (lastName) {
      params["checkout[shipping_address][last_name]"] = lastName;
    }
    if (addressLine1) {
      params["checkout[shipping_address][address1]"] = addressLine1;
    }
    if (addressLine2) {
      params["checkout[shipping_address][address2]"] = addressLine2;
    }
    if (city) {
      params["checkout[shipping_address][city]"] = city;
    }
    if (stateProvince) {
      params["checkout[shipping_address][province]"] = stateProvince;
    }
    if (postalCode) {
      params["checkout[shipping_address][zip]"] = postalCode;
    }
    if (countryRegion) {
      params["checkout[shipping_address][country]"] = countryRegion;
    }

    return params;
  }

  function applyCheckoutPrefillToUrl(rawUrl, customer) {
    if (!rawUrl) return rawUrl;
    const params = buildCheckoutPrefillParams(customer);
    if (!Object.keys(params).length) return rawUrl;

    const url = new URL(rawUrl, window.location.origin);

    Object.entries(params).forEach(([key, value]) => {
      if (value && !url.searchParams.get(key)) {
        url.searchParams.set(key, value);
      }
    });

    return `${url.pathname}${url.search}${url.hash}`;
  }

  function applyCheckoutPrefillToForm(form, customer) {
    if (!form || typeof form.querySelector !== "function") return false;
    const params = buildCheckoutPrefillParams(customer);
    const entries = Object.entries(params);
    if (!entries.length) return false;

    entries.forEach(([name, value]) => {
      let input = form.querySelector(`input[type="hidden"][name="${name}"]`);
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.setAttribute("data-megaska-prefill", "1");
        form.appendChild(input);
      }
      input.value = value;
    });

    return true;
  }

  async function fetchActiveCartContext() {
    const response = await fetch("/cart.js", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to read /cart.js (${response.status})`);
    }

    const cart = await response.json();
    return {
      cartToken: String(cart?.token || "").trim(),
      checkoutUrl: String(cart?.checkout_url || "").trim(),
      itemCount: Number(cart?.item_count || 0),
    };
  }

  async function writeMegaskaCartAttributes(attributes) {
    const sanitized = {};
    Object.entries(attributes || {}).forEach(([key, value]) => {
      const normalizedKey = String(key || "").trim();
      const normalizedValue = String(value || "").trim();
      if (!normalizedKey || !normalizedValue) return;
      sanitized[normalizedKey] = normalizedValue;
    });

    const response = await fetch("/cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        attributes: sanitized,
      }),
    });

    if (!response.ok) {
      throw new Error(`Unable to write cart attributes (${response.status})`);
    }

    return response.json();
  }

  async function applyBuyerIdentityToActiveCart(customer, options) {
    const opts = options || {};
    const source = customer || {};
    const email = String(source.email || "").trim();
    const phone = String(source.phoneE164 || source.phone || "").trim();
    const customerProfileId = String(source.id || "").trim();
    const shopifyCustomerId = String(source.shopifyCustomerId || "").trim();
    const verifiedAt = String(source.phoneVerifiedAt || "").trim();
    const hasContactInfo = Boolean(email || phone);

    if (!hasContactInfo) {
      console.log("[Megaska Buyer Identity] skipped - missing customer contact");
      return {
        ok: false,
        skipped: true,
        reason: "missing-customer-contact",
      };
    }

    const sessionToken = getSessionToken();
    if (!sessionToken) {
      console.log("[Megaska Buyer Identity] skipped - missing session token");
      return {
        ok: false,
        skipped: true,
        reason: "missing-session-token",
      };
    }

    const cartContext = await fetchActiveCartContext();
    const payload = {
      cartToken: cartContext.cartToken || undefined,
      checkoutUrl: opts.checkoutUrl || cartContext.checkoutUrl || undefined,
    };

    console.log("[Megaska Checkout Prefill] active cart detected", {
      cartToken: payload.cartToken || null,
      cartTokenSource: "cart.js.token",
      checkoutUrl: payload.checkoutUrl || null,
      checkoutUrlSource: opts.checkoutUrl ? "caller.checkoutUrl" : "cart.js.checkout_url",
      itemCount: cartContext.itemCount,
    });

    console.log("[Megaska Buyer Identity] update request", {
      cartToken: payload.cartToken || null,
      email: email || null,
      phone: phone || null,
    });

    console.log("[Megaska Verified Phone] active cart annotation started", {
      cartTokenPresent: Boolean(payload.cartToken),
      cartToken: payload.cartToken || null,
      hasVerifiedPhone: Boolean(phone),
    });

    if (!phone) {
      return {
        ok: false,
        skipped: false,
        reason: "missing-verified-phone",
        checkoutUrl: payload.checkoutUrl || null,
      };
    }

    try {
      const cartUpdateResult = await writeMegaskaCartAttributes({
        megaska_phone_verified: "true",
        megaska_verified_phone: phone,
        megaska_customer_profile_id: customerProfileId,
        megaska_shopify_customer_id: shopifyCustomerId,
        megaska_auth_source: "otp",
        megaska_auth_verified_at: verifiedAt,
      });
      console.log("[Megaska Verified Phone] active cart annotation complete", {
        cartToken: cartUpdateResult?.token || payload.cartToken || null,
        itemCount: Number(cartUpdateResult?.item_count || 0),
      });
    } catch (error) {
      console.error("[Megaska Verified Phone] active cart annotation failed", error);
    }

    const response = await fetch(buildApiUrl("/checkout/prefill"), {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(data?.error || `Buyer identity update failed (${response.status})`);
    }

    return {
      ok: Boolean(data?.ok),
      skipped: Boolean(data?.skipped),
      reason: data?.reason || "",
      blocked: Boolean(data?.blocked),
      cartId: data?.cartId || null,
      checkoutUrl: data?.checkoutUrl || payload.checkoutUrl || null,
      buyerIdentity: data?.buyerIdentity || null,
      wallet: data?.wallet || null,
      userErrors: Array.isArray(data?.userErrors) ? data.userErrors : [],
      apiErrors: Array.isArray(data?.apiErrors) ? data.apiErrors : [],
    };
  }

  function updateAuthUILoggedOut() {
    document.documentElement.classList.remove("megaska-authenticated");
    document.documentElement.classList.add("megaska-logged-out");

    document.querySelectorAll("[data-megaska-auth-guest]").forEach((el) => {
      el.hidden = false;
    });

    document.querySelectorAll("[data-megaska-auth-user]").forEach((el) => {
      const hasAccountEntry = Boolean(
        (typeof el.matches === "function" && el.matches(ACCOUNT_ENTRY_SELECTORS.join(","))) ||
          (typeof el.querySelector === "function" &&
            el.querySelector(ACCOUNT_ENTRY_SELECTORS.join(",")))
      );
      el.hidden = !hasAccountEntry;
    });
  }

  function updateAuthUILoggedIn(sessionData) {
    const customer = sessionData?.customer || sessionData || {};

    document.documentElement.classList.add("megaska-authenticated");
    document.documentElement.classList.remove("megaska-logged-out");

    document.querySelectorAll("[data-megaska-auth-guest]").forEach((el) => {
      el.hidden = true;
    });

    document.querySelectorAll("[data-megaska-auth-user]").forEach((el) => {
      el.hidden = false;
    });

    document.querySelectorAll("[data-megaska-customer-phone]").forEach((el) => {
      el.textContent = customer.phoneE164 || customer.phone || "";
    });

    document.querySelectorAll("[data-megaska-customer-name]").forEach((el) => {
      el.textContent =
        customer.fullName || customer.firstName || customer.name || "Account";
    });
  }

  async function refreshAuthState() {
    const session = await fetchSession();

    if (session.authenticated) {
      updateAuthUILoggedIn(session.customer);
    } else {
      updateAuthUILoggedOut();
    }

    document.dispatchEvent(
      new CustomEvent("megaska:auth-state-changed", {
        detail: { authenticated: session.authenticated, customer: session.customer || null },
      })
    );

    return session;
  }

  function escHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(isoDate) {
    if (!isoDate) return "";
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatAddress(address) {
    if (!address) return "";
    return [
      address.line1 || address.address1,
      address.line2 || address.address2,
      [address.city, address.state || address.province].filter(Boolean).join(", "),
      [address.country, address.postalCode || address.zip].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join("<br/>");
  }

  function formatMinorCurrency(amountMinor, currency) {
    const amountMajor = Number(amountMinor || 0) / 100;
    return `${escHtml(currency || "INR")} ${amountMajor.toFixed(2)}`;
  }

  function formatInrFromMinor(amountMinor) {
    const amountMajor = Number(amountMinor || 0) / 100;
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountMajor);
    } catch {
      return `₹${amountMajor.toFixed(2)}`;
    }
  }

  function sanitizeCartToken(rawValue) {
    const trimmed = String(rawValue || "").trim();
    if (!trimmed) return "";
    const quotedMatch = trimmed.match(/^["'](.+)["']$/);
    return quotedMatch ? quotedMatch[1].trim() : trimmed;
  }

  function getStoredCartToken() {
    const storageKeys = ["cartToken", "cart_token", "shopifyCartToken"];
    for (const key of storageKeys) {
      const token = sanitizeCartToken(localStorage.getItem(key));
      if (token) return token;
    }
    return "";
  }

  async function applyWalletDiscountCodeFromDashboard(input) {
    const availableToRedeem = Number(input?.availableToRedeem || 0);
    const button = input?.button || null;
    if (!button) return;
    if (button.dataset.megaskaApplying === "1") return;
    if (availableToRedeem <= 0) return;

    button.dataset.megaskaApplying = "1";
    const originalLabel = button.textContent || "Apply Wallet";
    button.disabled = true;
    button.textContent = "Applying...";

    let cartContext = null;
    try {
      cartContext = await fetchActiveCartContext();
    } catch (error) {
      console.warn("[WALLET UI] unable to fetch cart context from /cart.js", error);
    }

    const localStorageToken = getStoredCartToken();
    const cartToken = sanitizeCartToken(cartContext?.cartToken || localStorageToken || "");
    const cartId = cartToken.startsWith("gid://shopify/Cart/") ? cartToken : "";

    console.log("[WALLET UI] apply click", {
      availableToRedeem,
      cartTokenPresent: Boolean(cartToken),
      cartIdPresent: Boolean(cartId),
    });

    try {
      const walletAmount = Number((availableToRedeem / 100).toFixed(2));
      const data = await apiFetch("/wallet/apply", {
        method: "POST",
        body: JSON.stringify({
          walletAmount,
          cartToken: cartToken || undefined,
          cartId: cartId || undefined,
          sourceFlow: "CHECKOUT",
        }),
      });

      if (!data?.ok || !data?.code) {
        throw new Error(data?.error || "Wallet apply failed");
      }

      console.log("[WALLET UI] apply success", {
        reservationId: data?.reservationId || null,
        code: data?.code || null,
        discountNodeId: data?.discountNodeId || null,
        amountMinor: data?.amountMinor || null,
      });

      const code = String(data.code || "").trim();
      const targetUrl = `/discount/${encodeURIComponent(code)}?redirect=/cart`;
      console.log("[WALLET UI] redirecting to wallet discount attach", {
        code,
        targetUrl,
      });

      window.location.assign(targetUrl);
    } catch (error) {
      console.error("[WALLET UI] apply failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      button.disabled = false;
      button.textContent = originalLabel;
      button.dataset.megaskaApplying = "0";
      alert("Unable to apply wallet right now. Please try again.");
    }
  }

  function bindWalletApplyButtons(container) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    container.querySelectorAll("[data-megaska-wallet-apply]").forEach((button) => {
      if (button.dataset.megaskaBound === "1") return;
      button.dataset.megaskaBound = "1";

      button.addEventListener("click", function () {
        const availableToRedeem = Number(button.getAttribute("data-wallet-available") || 0);
        applyWalletDiscountCodeFromDashboard({
          availableToRedeem,
          button,
        });
      });
    });
  }

  function renderWalletSectionIntoLiveContainer(container, summary, containerSelector) {
    const availableToRedeem = Number(summary?.wallet?.availableToRedeem || 0);
    console.log("[WALLET UI] render attempt", {
      availableToRedeem,
      hasContainer: Boolean(container),
      containerSelector: String(containerSelector || ""),
    });

    if (!container) return;

    const existing = container.querySelector("[data-megaska-wallet-ui='true']");
    if (existing) {
      existing.remove();
    }

    const walletSection = document.createElement("section");
    walletSection.className = "megaska-dashboard-card";
    walletSection.setAttribute("data-megaska-wallet-ui", "true");
    walletSection.innerHTML = `
      <h3>Wallet Balance</h3>
      <p>${escHtml(formatInrFromMinor(availableToRedeem))}</p>
      <div class="megaska-dashboard-actions">
        <button
          type="button"
          data-megaska-wallet-apply
          data-wallet-available="${escHtml(String(availableToRedeem))}"
          class="megaska-dashboard-btn"
          ${availableToRedeem > 0 ? "" : "disabled"}
        >
          ${availableToRedeem > 0 ? "Apply Wallet" : "No Wallet Balance"}
        </button>
      </div>
    `;

    container.appendChild(walletSection);
    bindWalletApplyButtons(container);

    console.log("[WALLET UI] render success", {
      mounted: true,
      availableToRedeem,
    });
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getOrderCancellationDisplayState(order) {
    const financialStatus = normalizeStatus(order?.financialStatus);
    const fulfillmentStatus = normalizeStatus(order?.fulfillmentStatus);
    const cancellationStatus = String(order?.latestCancellationStatus || "").trim().toUpperCase();

    if (["void", "cancel", "refunded"].some((keyword) => financialStatus.includes(keyword))) {
      return "Cancelled";
    }

    if (["fulfilled", "delivered", "shipped", "in transit", "out for delivery", "ready for pickup", "label printed", "partial"].some((keyword) => fulfillmentStatus.includes(keyword))) {
      return "Cancellation not possible — already shipped";
    }

    if (["OPEN", "APPROVED"].includes(cancellationStatus)) {
      return "Cancellation Requested";
    }

    if (cancellationStatus === "CLOSED") {
      return "Cancelled";
    }

    return "Cancel Order";
  }

  function getOrderActionStatePills(order) {
    const financialStatus = normalizeStatus(order?.financialStatus);
    const fulfillmentStatus = normalizeStatus(order?.fulfillmentStatus);
    const cancellationStatus = String(order?.latestCancellationStatus || "").trim().toUpperCase();
    const exchangeStatus = String(order?.latestExchangeStatus || "").trim().toUpperCase();
    const hasActiveExchangeRequest = Boolean(order?.hasActiveExchangeRequest);

    const isCancelled =
      ["void", "cancel", "refunded"].some((keyword) => financialStatus.includes(keyword)) ||
      cancellationStatus === "CLOSED";
    const hasCancellationRequest = ["OPEN", "APPROVED"].includes(cancellationStatus);
    const isShippedOrFulfilled = [
      "fulfilled",
      "delivered",
      "shipped",
      "in transit",
      "out for delivery",
      "ready for pickup",
      "label printed",
      "partial",
    ].some((keyword) => fulfillmentStatus.includes(keyword));
    const exchangeAvailable =
      !isCancelled && !hasCancellationRequest && !hasActiveExchangeRequest && ["fulfilled", "delivered"].some((keyword) => fulfillmentStatus.includes(keyword));

    const pills = [];

    if (isCancelled) {
      pills.push({ label: "Cancelled", tone: "danger" });
    } else if (hasCancellationRequest) {
      pills.push({ label: "Cancellation Requested", tone: "warning" });
    } else if (isShippedOrFulfilled) {
      pills.push({ label: "Shipped", tone: "neutral" });
    }

    if (hasActiveExchangeRequest) {
      pills.push({ label: "Exchange Requested", tone: "info" });
    } else if (exchangeAvailable) {
      pills.push({ label: "Exchange Available", tone: "success" });
    } else if (exchangeStatus === "CLOSED") {
      pills.push({ label: "Exchange Completed", tone: "neutral" });
    }

    return pills;
  }

  function renderDashboardSummary(container, summary, containerSelector) {
    const profileName =
      [summary?.customer?.firstName, summary?.customer?.lastName].filter(Boolean).join(" ") ||
      "Megaska Customer";
    const verifiedPhone = summary?.customer?.phone || "-";
    const email = summary?.customer?.email || "-";
    const verified = Boolean(summary?.customer?.verified);
    const totalOrders = Number(summary?.stats?.totalOrders || 0);
    const openRequests = Number(summary?.stats?.openRequests || 0);
    const savedAddresses = Number(summary?.stats?.savedAddresses || 0);
    const storeCredit = Number(summary?.wallet?.balance || 0);
    const currency = summary?.wallet?.currency || "INR";
    const walletTransactions = Array.isArray(summary?.wallet?.transactions) ? summary.wallet.transactions : [];
    const addressHtml = formatAddress(summary?.address);
    const orders = Array.isArray(summary?.orders) ? summary.orders : [];

    const walletHistoryHtml = walletTransactions.length
      ? walletTransactions
          .map((txn) => {
            const direction = String(txn?.direction || "").toUpperCase();
            const sign = direction === "DEBIT" ? "-" : "+";
            const reason = txn?.reason || txn?.transactionType || "Wallet transaction";
            const orderRef = txn?.orderNumber ? ` • Order ${escHtml(txn.orderNumber)}` : "";
            return `<li class="megaska-dashboard-list-item">
              <div>
                <strong>${escHtml(reason)}</strong>
                <div class="megaska-dashboard-subtle">${escHtml(formatDate(txn?.createdAt) || "")}${orderRef}</div>
              </div>
              <div class="megaska-dashboard-order-right">
                <strong>${sign} ${formatMinorCurrency(txn?.amount, txn?.currency || currency)}</strong>
                <div class="megaska-dashboard-subtle">${escHtml(direction)}</div>
              </div>
            </li>`;
          })
          .join("")
      : '<li class="megaska-dashboard-empty">No wallet transactions yet.</li>';

    const ordersHtml = orders.length
      ? orders
          .map((order) => {
            const deliveredAt = order?.deliveredAt || order?.processedAt || "";
            const fulfillmentStatus = order?.fulfillmentStatus || "";
            const shopifyOrderId = order?.shopifyOrderId || order?.id || "";
            const lineItemId = order?.firstLineItemId || "";
            const itemTitle = order?.firstLineItemTitle || order?.displayTitle || "";
            const variantTitle = order?.firstLineItemVariantTitle || "";
            const sku = order?.firstLineItemSku || "";
            const orderTotal =
              order?.totalAmount && order?.currencyCode
                ? `${escHtml(order.currencyCode)} ${escHtml(order.totalAmount)}`
                : "-";
            const orderLink = order?.statusPageUrl
              ? `<a href="${escHtml(order.statusPageUrl)}" target="_blank" rel="noopener noreferrer">View</a>`
              : "";
            const cancellationState = getOrderCancellationDisplayState(order);
            const actionStatePills = getOrderActionStatePills(order);
            const actionStateStrip = actionStatePills.length
              ? `<div class="megaska-order-state-strip">${actionStatePills
                  .map(
                    (pill) =>
                      `<span class="megaska-order-state-pill megaska-order-state-pill--${escHtml(
                        pill.tone
                      )}">${escHtml(pill.label)}</span>`
                  )
                  .join("")}</div>`
              : "";

            return `<li class="megaska-dashboard-list-item" data-order-fulfillment-status="${escHtml(
              fulfillmentStatus
            )}" data-order-delivered-at="${escHtml(deliveredAt)}" data-shopify-order-id="${escHtml(
              shopifyOrderId
            )}" data-shopify-line-item-id="${escHtml(lineItemId)}" data-item-title="${escHtml(
              itemTitle
            )}" data-variant-title="${escHtml(variantTitle)}" data-sku="${escHtml(sku)}">
              <div>
                <strong>${escHtml(order?.name || "Order")}</strong>
                <div class="megaska-dashboard-subtle">${escHtml(formatDate(order?.processedAt) || "")}</div>
                ${actionStateStrip}
              </div>
              <div class="megaska-dashboard-order-right">
                <div>${orderTotal}</div>
                <div class="megaska-dashboard-subtle">${escHtml(order?.financialStatus || "")}</div>
                <div class="megaska-dashboard-subtle">${escHtml(cancellationState)}</div>
                ${orderLink}
              </div>
            </li>`;
          })
          .join("")
      : '<li class="megaska-dashboard-empty">No recent orders yet.</li>';

    container.innerHTML = `
      <section class="megaska-dashboard-card">
        <h2>${escHtml(profileName)}</h2>
        <p class="megaska-dashboard-subtle">Verified phone: ${escHtml(verifiedPhone)}</p>
        <p class="megaska-dashboard-subtle">Email: ${escHtml(email)}</p>
        <p class="megaska-dashboard-subtle">Verification status: ${verified ? "Verified" : "Pending"}</p>
      </section>
      <section class="megaska-dashboard-grid">
        <article class="megaska-dashboard-card"><h3>Total orders</h3><p>${totalOrders}</p></article>
        <article class="megaska-dashboard-card"><h3>Open requests</h3><p>${openRequests}</p></article>
        <article class="megaska-dashboard-card"><h3>Saved addresses</h3><p>${savedAddresses}</p></article>
        <article class="megaska-dashboard-card"><h3>Wallet balance</h3><p>${formatMinorCurrency(storeCredit, currency)}</p></article>
      </section>
      <section class="megaska-dashboard-card">
        <h3>Wallet history</h3>
        <ul class="megaska-dashboard-list">${walletHistoryHtml}</ul>
      </section>
      <section class="megaska-dashboard-card">
        <h3>Recent orders</h3>
        <ul class="megaska-dashboard-list">${ordersHtml}</ul>
      </section>
      <section class="megaska-dashboard-card">
        <h3>Saved address</h3>
        ${
          addressHtml
            ? `<p class="megaska-dashboard-address">${addressHtml}</p>`
            : '<p class="megaska-dashboard-empty">No default address saved yet.</p>'
        }
      </section>
      <section class="megaska-dashboard-card">
        <h3>Quick actions</h3>
        <div class="megaska-dashboard-actions">
          <a href="/collections/all" class="megaska-dashboard-btn">Continue Shopping</a>
          <a href="/pages/contact" class="megaska-dashboard-btn megaska-dashboard-btn--secondary">Contact Support</a>
          <button type="button" data-megaska-logout class="megaska-dashboard-btn megaska-dashboard-btn--danger">Logout</button>
        </div>
      </section>
    `;

    renderWalletSectionIntoLiveContainer(container, summary, containerSelector);
  }

  async function initDashboardPage() {
    const pathname = String(window?.location?.pathname || "");
    if (!pathname.includes("/pages/megaska-dashboard")) return;

    const mountTarget =
      [
        {
          selector: "[data-megaska-account-dashboard]",
          element: document.querySelector("[data-megaska-account-dashboard]"),
        },
        {
          selector: "#megaska-account-dashboard",
          element: document.getElementById("megaska-account-dashboard"),
        },
        {
          selector: "main",
          element: document.querySelector("main"),
        },
        {
          selector: "body",
          element: document.body,
        },
      ].find((entry) => Boolean(entry.element)) || null;

    const mountEl = mountTarget?.element || null;
    const containerSelector = mountTarget?.selector || "";

    if (!mountEl) return;

    mountEl.classList.add("megaska-dashboard-root");
    mountEl.innerHTML = '<div class="megaska-dashboard-loading">Loading account dashboard...</div>';

    try {
      const summary = await fetchDashboardSummary();
      renderDashboardSummary(mountEl, summary, containerSelector);
      bindLogoutButtons();
      bindWalletApplyButtons(mountEl);

      const observer = new MutationObserver(function () {
        if (!mountEl.querySelector("[data-megaska-wallet-ui='true']")) {
          renderWalletSectionIntoLiveContainer(mountEl, summary, containerSelector);
        }
      });
      observer.observe(mountEl, { childList: true, subtree: true });
    } catch (error) {
      console.error("[Megaska Dashboard] summary fetch failed", error);
      mountEl.innerHTML =
        '<div class="megaska-dashboard-error">Unable to load dashboard. Please login again.</div>';
    }
  }

  async function bootstrapAuth() {
    return refreshAuthState();
  }

  function bindLogoutButtons() {
    document.querySelectorAll("[data-megaska-logout]").forEach((button) => {
      if (button.dataset.megaskaBound === "1") return;
      button.dataset.megaskaBound = "1";

      button.addEventListener("click", async function (event) {
        event.preventDefault();

        try {
          await logout();
        } catch (error) {
          console.error("[Megaska Auth] logout failed", error);
          alert("Logout failed. Please try again.");
        }

        updateAuthUILoggedOut();
      });
    });
  }

  async function init() {
    bindLogoutButtons();
    await bootstrapAuth();
    // await initDashboardPage();
  }

  window.MegaskaAuth = {
    API_BASE,
    getCurrentShopDomain,
    getSessionToken,
    setSessionToken,
    clearSessionToken,
    // Backward compatible aliases
    saveSessionToken: setSessionToken,
    fetchSession,
    fetchDashboardSummary,
    refreshAuthState,
    bootstrapAuth,
    requestOtp,
    verifyOtp,
    completeProfile,
    logout,
    buildCheckoutPrefillParams,
    applyCheckoutPrefillToUrl,
    applyCheckoutPrefillToForm,
    applyBuyerIdentityToActiveCart,
    fetchActiveCartContext,
    updateAuthUILoggedOut,
    updateAuthUILoggedIn,
    init,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
