(function () {
  const OTP_LENGTH = 4;
  const RESEND_SECONDS = 30;
  const SUCCESS_CLOSE_DELAY_MS = 1400;
  const INDIA_OTP_COUNTRY = Object.freeze({ iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" });
  const INTERNATIONAL_PHONE_MAX_LENGTH = 20;
  const OTP_POLICY_HYDRATION_TIMEOUT_MS = 400;
  let cachedOtpCountryPolicy = null;
  let otpRuntimePolicyReady = false;
  let modalInteractionId = 0;
  let policyHydrationTimerId = null;

  function sanitizeOtpCountryPolicy(policy) {
    const seen = new Set();
    const allowedCountries = Array.isArray(policy?.allowedCountries)
      ? policy.allowedCountries.reduce((countries, entry) => {
          const iso2 = String(entry?.iso2 || "").trim().toUpperCase();
          const name = String(entry?.name || "").trim();
          const dialCode = String(entry?.dialCode || "").trim();
          const flag = String(entry?.flag || "").trim();
          if (!/^[A-Z]{2}$/.test(iso2) || !name || !/^\+\d+$/.test(dialCode) || !flag || seen.has(iso2)) return countries;
          seen.add(iso2);
          countries.push({ iso2, name, dialCode, flag });
          return countries;
        }, [])
      : [];
    if (!allowedCountries.length) {
      return { defaultCountryCode: "IN", allowedCountries: [{ ...INDIA_OTP_COUNTRY }] };
    }
    const configuredDefault = String(policy?.defaultCountryCode || "").trim().toUpperCase();
    const defaultCountryCode = allowedCountries.some((country) => country.iso2 === configuredDefault)
      ? configuredDefault
      : allowedCountries[0].iso2;
    return { defaultCountryCode, allowedCountries };
  }

  function hasUsableOtpCountryPolicy(policy) {
    return Array.isArray(policy?.allowedCountries) && policy.allowedCountries.some((entry) => {
      const iso2 = String(entry?.iso2 || "").trim().toUpperCase();
      const name = String(entry?.name || "").trim();
      const dialCode = String(entry?.dialCode || "").trim();
      const flag = String(entry?.flag || "").trim();
      return /^[A-Z]{2}$/.test(iso2) && Boolean(name) && /^\+\d+$/.test(dialCode) && Boolean(flag);
    });
  }

  function cloneOtpCountryPolicy(policy) {
    return {
      defaultCountryCode: policy.defaultCountryCode,
      allowedCountries: policy.allowedCountries.map((country) => ({ ...country })),
    };
  }

  function setCachedOtpCountryPolicy(rawPolicy, options) {
    if (!hasUsableOtpCountryPolicy(rawPolicy)) return null;
    const policy = sanitizeOtpCountryPolicy(rawPolicy);
    cachedOtpCountryPolicy = cloneOtpCountryPolicy(policy);
    otpRuntimePolicyReady = true;
    if (options?.applyToModal !== false) applyCountryPolicyToCurrentPhoneStep(policy);
    return cloneOtpCountryPolicy(policy);
  }

  function resolveOtpCountryPolicy() {
    const runtimePolicy = window.LoopDeskConfig && window.LoopDeskConfig.otpCountryPolicy;
    if (hasUsableOtpCountryPolicy(runtimePolicy)) {
      return setCachedOtpCountryPolicy(runtimePolicy, { applyToModal: false });
    }
    if (otpRuntimePolicyReady && cachedOtpCountryPolicy) return cloneOtpCountryPolicy(cachedOtpCountryPolicy);
    return sanitizeOtpCountryPolicy(undefined);
  }

  function sanitizePhoneInputForCountry(value, countryCode) {
    const digits = String(value || "").replace(/\D/g, "");
    return countryCode === "IN" ? digits.slice(0, 10) : digits.slice(0, INTERNATIONAL_PHONE_MAX_LENGTH);
  }

  function maskOtpDestination({ phoneE164, phoneInput, country }) {
    const dialCode = country?.dialCode || "";
    let nationalDigits = String(phoneE164 || "").replace(/\D/g, "");
    const dialDigits = dialCode.replace(/\D/g, "");
    if (dialDigits && nationalDigits.startsWith(dialDigits)) nationalDigits = nationalDigits.slice(dialDigits.length);
    if (!nationalDigits) nationalDigits = String(phoneInput || "").replace(/\D/g, "");
    const visible = nationalDigits.slice(-4);
    const maskedCount = Math.max(4, nationalDigits.length - visible.length);
    return `${country?.flag ? `${country.flag} ` : ""}${dialCode} ${"•".repeat(maskedCount)}${visible}`.trim();
  }
  const state = {
  isOpen: false,
  step: "phone",
  phoneDigits: "",
  normalizedPhone: "",
  lastRequestedPhone: "",
  otpCountryPolicy: { defaultCountryCode: "IN", allowedCountries: [{ ...INDIA_OTP_COUNTRY }] },
  selectedOtpCountryCode: "IN",
  otpRequestPhoneInput: "",
  otpRequestCountryCode: "",
  otpRequestPhoneE164: "",
  countryMenuOpen: false,
  countrySelectionTouched: false,
  otpPolicyHydrating: false,
  otpDigits: ["", "", "", ""],
  requesting: false,
  verifying: false,
  savingProfile: false,
  resendSeconds: 0,
  resendTimerId: null,
  errorMessage: "",
  statusMessage: "",
  successMessage: "You're in!",
  profileFirstName: "",
  profileLastName: "",
  profileEmail: "",
  disambiguateEmail: "",
  emailVerifyDestination: "",
  emailCode: "",
  requestingEmailCode: false,
  verifyingEmailCode: false,
};

  let globalClickBound = false;
  let checkoutSubmitBound = false;
  let cartAddSubmitBound = false;
  let submitDebugBound = false;
  let paymentButtonsLogged = false;
  let pendingAction = null;
  let checkoutInterceptionEnabled = true;
  let accountMenuContainer = null;
  let accountMenuTrigger = null;
  let accountFallbackObserverBound = false;
  let accountFallbackObserver = null;
  let accountFallbackTimer = null;
  let accountFallbackDiscoveryStartedAt = 0;
  let lastLoggedStep = "";
  let desktopAccountContainerObserver = null;
  let observedDesktopAccountContainer = null;
  const resumingCartAddForms = new WeakSet();
  const ACCOUNT_FALLBACK_DESKTOP_ID = "megaska-account-fallback-desktop";
  const ACCOUNT_FALLBACK_MOBILE_ID = "megaska-account-fallback-mobile";
  const DEFAULT_MEGASKA_DASHBOARD_URL = "/apps/loopd2c/account";
  const ACCOUNT_FALLBACK_DISCOVERY_DELAY_MS = 1500;

  const ACCOUNT_TRIGGER_SELECTORS = [
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
    "[data-account]",
    "[data-account-trigger]",
    ".header__icon--account",
    ".header__account",
    ".site-nav__link--account",
    ".js__tc",
    ".js_link_acc",
    ".kalles-account-icon",
    ".iccl-user",
    ".icon-user",
    ".site-header__account",
    ".customer-account-link",
    "[class*='account-icon' i]",
    "[class*='account-toggle' i]",
    "[class*='account-trigger' i]",
    "[class*='account-link' i]",
    "[class*='header-account' i]",
    "[class*='header__icon--account' i]",
    "[class*='my-account' i]",
    "[id*='account-icon' i]",
    "[id*='account-trigger' i]",
    "[aria-controls*='account' i]",
    "[aria-label*='account' i]",
    "[aria-label*='sign in' i]",
    "[aria-label*='signin' i]",
    "[title*='account' i]",
  ];
  const ACCOUNT_TRIGGER_KEYWORD_REGEX =
    /\b(account|login|signin|profile)\b|account-icon|account-toggle|account-trigger|header__icon--account|my-account/;
  const ACCOUNT_EXCLUDED_INTENT_SELECTOR = [
    "[href*='checkout']",
    "[action*='checkout']",
    "[class*='checkout' i]",
    "[id*='checkout' i]",
    "[aria-label*='checkout' i]",
    "a[href*='/cart']",
    "[class*='cart' i]",
    "[aria-label*='cart' i]",
    "[aria-label*='bag' i]",
    "[class*='search' i]",
    "[aria-label*='search' i]",
    "[class*='logout' i]",
    "[aria-label*='logout' i]",
    "[aria-label*='log out' i]",
    "[class*='hamburger' i]",
    "[class*='nav-toggle' i]",
    "[class*='mobile-nav' i]",
    "[class*='wishlist' i]",
    "[class*='compare' i]",
    "[name='plus']",
    "[name='minus']",
    "[data-quantity]",
    "[class*='quantity' i]",
    "[aria-label*='quantity' i]",
    // The LoopD2C customer dashboard owns its own buttons (Order details, order
    // actions, its own sign-in trigger). Its "Order details" button carries the
    // class `ld-account-link-button`, which otherwise matches [class*='account-link'],
    // so the account-trigger scanner would hijack the click and navigate away.
    "[data-loopdesk-customer-dashboard]",
    "[data-loopdesk-customer-dashboard] *",
  ].join(",");

  function getAccountCustomTriggerSelector() {
    const raw = window.LoopDeskConfig && window.LoopDeskConfig.account && window.LoopDeskConfig.account.customTriggerSelector;
    if (!raw || typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
      document.querySelectorAll(trimmed);
      return trimmed;
    } catch {
      return "";
    }
  }

  function isAccountDashboardRedirectEnabled() {
    const value = window.LoopDeskConfig && window.LoopDeskConfig.account && window.LoopDeskConfig.account.dashboardRedirectEnabled;
    return value !== false;
  }

  function isExcludedAccountControl(element) {
    if (!element || typeof element.closest !== "function") return true;
    if (element.closest(ACCOUNT_EXCLUDED_INTENT_SELECTOR)) return true;
    const text = [
      typeof element.getAttribute === "function" ? element.getAttribute("aria-label") : "",
      typeof element.getAttribute === "function" ? element.getAttribute("title") : "",
      element.className,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /\b(checkout|cart|search|logout|log out|quantity|wishlist|compare)\b/.test(text);
  }

  function accountIconGlyphText(element) {
    if (!element || typeof element.querySelectorAll !== "function") return "";
    const parts = [];
    const useNodes = element.querySelectorAll("use");
    for (let i = 0; i < useNodes.length; i += 1) {
      parts.push(useNodes[i].getAttribute("href") || useNodes[i].getAttribute("xlink:href") || "");
    }
    const glyphNodes = element.querySelectorAll("img[alt], svg[aria-label], symbol[id], [data-icon]");
    for (let j = 0; j < glyphNodes.length; j += 1) {
      parts.push(
        glyphNodes[j].getAttribute("alt") ||
          glyphNodes[j].getAttribute("aria-label") ||
          glyphNodes[j].getAttribute("id") ||
          glyphNodes[j].getAttribute("data-icon") ||
          ""
      );
    }
    return parts.join(" ").toLowerCase();
  }

  function findAccountTrigger(event) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return null;

    // Never treat a control inside the LoopD2C customer dashboard as a native
    // account trigger — it manages its own clicks (drawer, actions, sign-in).
    if (target.closest("[data-loopdesk-customer-dashboard]")) return null;

    const customSelector = getAccountCustomTriggerSelector();
    if (customSelector) {
      const customTrigger = target.closest(customSelector);
      if (customTrigger && !isExcludedAccountControl(customTrigger)) return customTrigger;
    }

    const matched = findClosestMatchingElement(event, ACCOUNT_TRIGGER_SELECTORS);
    if (matched) return matched;

    const candidate = target.closest("button,[role='button']");
    if (!candidate || isExcludedAccountControl(candidate)) return null;
    const text = [
      typeof candidate.getAttribute === "function" ? candidate.getAttribute("aria-label") : "",
      typeof candidate.getAttribute === "function" ? candidate.getAttribute("title") : "",
      candidate.className,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!/\baccount\b|account-icon|account-toggle|account-trigger/.test(text) && !/\baccount\b|account-icon/.test(accountIconGlyphText(candidate))) {
      return null;
    }
    return candidate;
  }
  const MOBILE_CONTEXT_SELECTORS = [
    ".mobile-nav",
    ".mobile-menu",
    ".menu_mobile",
    ".menu-sidebar",
    ".sidebar-menu",
    ".drawer",
    "[data-drawer]",
    "[id*='menu_canvas']",
    "[id*='drawer']",
    ".mfp-content",
  ];
  const DESKTOP_ACCOUNT_CONTAINER_SELECTORS = [
    "header .nt_action",
    "header .header__icons",
    "header .site-header__icons",
    "header .header-icons",
    "header .header__actions",
    "header .header-actions",
    "header .h_icon_iccl",
    "header .icon-action",
    "header .list-inline",
    "header .h_right",
    "header .right",
  ];
  const MOBILE_ACCOUNT_CONTAINER_SELECTORS = [
    "#nt_menu_canvas .menu",
    "#nt_menu_canvas ul",
    ".menu_sidebar .menu",
    ".mobile-nav ul",
    ".mobile-menu ul",
    ".drawer__content ul",
    ".drawer ul",
    "nav[aria-label*='mobile' i] ul",
    "aside .menu",
  ];
  const NATIVE_DESKTOP_ACCOUNT_SELECTORS = [
    ...ACCOUNT_TRIGGER_SELECTORS,
    "header .my-account",
    "header .my-account a.push_side[href='/account/login']",
  ];
  const HEADER_ICON_REFERENCE_SELECTORS = Object.freeze({
    search: ["[aria-label*='search' i]", "[title*='search' i]", ".header__search", ".icon-search", ".search-icon"],
    cart: ["a[href*='/cart']", "[aria-label*='cart' i]", "[aria-label*='bag' i]", ".cart-icon", ".icon-cart", ".js_car_tt"],
    action: ["button", "a", "[role='button']"],
  });

  const CHECKOUT_TRIGGER_SELECTORS = [
    "a[href='/checkout']",
    "a[href*='/checkout']",
    "button[name='checkout']",
    "button[name='goto_pp']",
    "input[name='checkout']",
    "input[name='goto_pp']",
    "button[data-action='checkout']",
    "button[data-action='proceed-to-checkout']",
    "[data-checkout-button]",
    ".shopify-payment-button__button",
    ".checkout-button",
    ".btn-checkout",
    ".mini-cart__checkout",
    ".cart__checkout",
  ];

  const CHECKOUT_PHONE_SELECTORS = [
    "input[name='checkout[shipping_address][phone]']",
    "input[name='checkout[billing_address][phone]']",
    "input[name='phone']",
    "input[type='tel']",
    "#CheckoutPhone",
    "#phone",
  ];

  const LOGOUT_TRIGGER_SELECTORS = [
    "[data-megaska-logout]",
    "a[href='/account/logout']",
    "a[href*='/account/logout']",
    "button[data-action='logout']",
    "[data-customer-logout]",
  ];

  const CART_DRAWER_SELECTORS = [".cart-drawer", ".drawer", ".mini-cart", "[data-cart-drawer]"];

  const CART_DRAWER_OPEN_CLASSES = [
    "active",
    "open",
    "is-open",
    "drawer--active",
    "drawer--open",
    "cart-drawer--active",
    "cart-drawer--open",
    "mini-cart--active",
    "mini-cart--open",
  ];

  const CART_DRAWER_CLOSE_EVENTS = [
    "cart:close",
    "drawer:close",
    "cart-drawer:close",
    "theme:cart:close",
  ];

  function sanitizeDigits(value, maxLength) {
    return String(value || "")
      .replace(/\D/g, "")
      .slice(0, maxLength);
  }

  function normalizeIndianPhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";

    while (digits.startsWith("0") && digits.length > 10) {
      digits = digits.slice(1);
    }

    if (digits.length === 12 && digits.startsWith("91")) {
      digits = digits.slice(2);
    }

    if (!/^[6-9]\d{9}$/.test(digits)) return "";
    return `+91${digits}`;
  }



  function isBusy() {
    return state.requesting || state.verifying || state.savingProfile || state.requestingEmailCode || state.verifyingEmailCode;
  }

  function isModalOpen() {
    return state.isOpen;
  }

  function hardBlockEvent(event) {
    if (!event) return false;
    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    return false;
  }

  function clearResendTimer() {
    if (state.resendTimerId) {
      clearInterval(state.resendTimerId);
      state.resendTimerId = null;
    }
  }

  function startResendTimer() {
    clearResendTimer();
    state.resendSeconds = RESEND_SECONDS;

    state.resendTimerId = setInterval(() => {
      state.resendSeconds = Math.max(0, state.resendSeconds - 1);
      updateResendUi();

      if (state.resendSeconds <= 0) {
        clearResendTimer();
      }
    }, 1000);

    updateResendUi();
  }

  function resetModalState(options) {
    const opts = options || {};
    const preservePhone = Boolean(opts.preservePhone);
    const savedPhone = preservePhone ? state.phoneDigits : "";
    const savedNormalizedPhone = preservePhone ? state.normalizedPhone : "";
    state.otpCountryPolicy = resolveOtpCountryPolicy();
    state.selectedOtpCountryCode = state.otpCountryPolicy.defaultCountryCode;
    state.otpRequestPhoneInput = preservePhone ? state.otpRequestPhoneInput : "";
    state.otpRequestCountryCode = preservePhone ? state.otpRequestCountryCode : "";
    state.otpRequestPhoneE164 = preservePhone ? state.otpRequestPhoneE164 : "";
    state.countryMenuOpen = false;
    state.countrySelectionTouched = false;
    state.otpPolicyHydrating = false;

    clearResendTimer();
    state.step = preservePhone && savedPhone ? "otp" : "phone";
    state.phoneDigits = savedPhone;
    state.normalizedPhone = savedNormalizedPhone;
    state.lastRequestedPhone = preservePhone ? savedNormalizedPhone : "";
    state.otpDigits = ["", "", "", ""];
    state.requesting = false;
    state.verifying = false;
    state.savingProfile = false;
    state.resendSeconds = 0;
    state.errorMessage = "";
    state.statusMessage = "";
    state.successMessage = "You're in!";
    state.profileFirstName = "";
    state.profileLastName = "";
    state.profileEmail = "";
    state.disambiguateEmail = "";
    state.emailVerifyDestination = "";
    state.emailCode = "";
    state.requestingEmailCode = false;
    state.verifyingEmailCode = false;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isSafeImageUrl(value) {
    const next = String(value || "").trim();
    if (!next) return "";
    try {
      const parsed = new URL(next, window.location.origin);
      return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "data:" ? next : "";
    } catch {
      return "";
    }
  }

  function shopNameFallback() {
    const fromConfig = window.LoopDeskConfig && window.LoopDeskConfig.general && (window.LoopDeskConfig.general.storeName || window.LoopDeskConfig.general.merchantName);
    const shop = window.Shopify && window.Shopify.shop ? String(window.Shopify.shop).replace(/\.myshopify\.com$/i, "") : "";
    return String(fromConfig || shop || "Secure Login").trim() || "Secure Login";
  }

  function getOtpModalBranding() {
    const config = (window.LoopDeskConfig && window.LoopDeskConfig.otpModalBranding) || {};
    const fallbackBrandText = String(config.fallbackBrandText || shopNameFallback()).trim() || "Secure Login";
    const trustItems = Array.isArray(config.trustItems) ? config.trustItems : [];
    return {
      logoUrl: isSafeImageUrl(config.logoUrl),
      logoAlt: String(config.logoAlt || fallbackBrandText).trim() || fallbackBrandText,
      fallbackBrandText,
      heading: String(config.heading || "Login or Signup").trim() || "Login or Signup",
      description: String(config.description || "Sign in securely to continue").trim() || "Sign in securely to continue",
      promotionEnabled: config.promotionEnabled === true,
      promotionBadgeText: String(config.promotionBadgeText || "").trim(),
      promotionMessage: String(config.promotionMessage || "").trim(),
      showTrustItems: config.showTrustItems !== false,
      trustItems: [trustItems[0] || "Secure login", trustItems[1] || "Faster checkout", trustItems[2] || ""].map((item) => String(item || "").trim()),
      inputHelperText: String(config.inputHelperText || "Enter 10 digits to receive an OTP automatically.").trim() || "Enter 10 digits to receive an OTP automatically.",
      privacyText: String(config.privacyText || "We never share your number.").trim() || "We never share your number.",
      successMessage: String(config.successMessage || "You're in!").trim() || "You're in!",
    };
  }

  function applyOtpModalBranding(modal) {
    if (!modal) return;
    const branding = getOtpModalBranding();

    const logoWrap = modal.querySelector("[data-megaska-otp-logo-wrap]");
    const brandText = modal.querySelector("[data-megaska-otp-brand-text]");
    if (logoWrap) {
      let logo = logoWrap.querySelector("[data-megaska-otp-logo]");
      if (branding.logoUrl) {
        if (!logo) {
          logo = document.createElement("img");
          logo.className = "megaska-otp-logo";
          logo.setAttribute("data-megaska-otp-logo", "");
          logoWrap.insertBefore(logo, brandText || null);
        }
        logo.src = branding.logoUrl;
        logo.alt = branding.logoAlt;
        logo.hidden = false;
        if (brandText) brandText.hidden = true;
      } else {
        if (logo) logo.remove();
        if (brandText) {
          brandText.textContent = branding.fallbackBrandText;
          brandText.hidden = false;
        }
      }
    }

    if (brandText && !branding.logoUrl) {
      brandText.textContent = branding.fallbackBrandText;
      brandText.hidden = false;
    }

    const title = modal.querySelector("[data-megaska-otp-title]");
    if (title) title.textContent = branding.heading;

    const description = modal.querySelector("[data-megaska-otp-description]");
    if (description) description.textContent = branding.description;

    const offerContainer = modal.querySelector("[data-megaska-otp-offer-container]");
    if (offerContainer) {
      offerContainer.textContent = "";
      const hasOffer = branding.promotionEnabled && (branding.promotionBadgeText || branding.promotionMessage);
      offerContainer.hidden = !hasOffer;
      if (hasOffer) {
        if (branding.promotionBadgeText) {
          const badge = document.createElement("span");
          badge.className = "megaska-otp-offer-badge";
          badge.textContent = branding.promotionBadgeText;
          offerContainer.appendChild(badge);
        }
        if (branding.promotionMessage) {
          const message = document.createElement("span");
          message.textContent = branding.promotionMessage;
          offerContainer.appendChild(message);
        }
      }
    }

    const trustStrip = modal.querySelector("[data-megaska-otp-trust-strip]");
    if (trustStrip) {
      const trustItems = branding.showTrustItems ? branding.trustItems.filter(Boolean) : [];
      trustStrip.textContent = "";
      trustStrip.hidden = trustItems.length === 0;
      trustItems.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "megaska-otp-chip";
        chip.textContent = item;
        trustStrip.appendChild(chip);
      });
    }

    const phoneHint = modal.querySelector("[data-megaska-phone-hint]");
    if (phoneHint && state.step === "phone" && !state.requesting && state.phoneDigits.length < 10) {
      phoneHint.textContent = branding.inputHelperText;
    }

    const privacy = modal.querySelector("[data-megaska-otp-privacy]");
    if (privacy) privacy.textContent = branding.privacyText;
  }

  function getOtpCountry(countryCode) {
    return state.otpCountryPolicy.allowedCountries.find((country) => country.iso2 === countryCode) || null;
  }

  function getSelectedOtpCountry() {
    return getOtpCountry(state.selectedOtpCountryCode) || state.otpCountryPolicy.allowedCountries[0] || INDIA_OTP_COUNTRY;
  }

  function closeOtpCountryMenu(options) {
    state.countryMenuOpen = false;
    const control = document.querySelector("[data-megaska-country-control]");
    if (control) renderOtpCountryControl(control);
    if (options?.focusTrigger) control?.querySelector("[data-megaska-country-trigger]")?.focus();
  }

  function selectOtpCountry(countryCode) {
    if (state.step !== "phone" || state.otpRequestCountryCode || !getOtpCountry(countryCode)) return;
    state.selectedOtpCountryCode = countryCode;
    state.countrySelectionTouched = true;
    state.phoneDigits = sanitizePhoneInputForCountry(state.phoneDigits, countryCode);
    state.countryMenuOpen = false;
    state.errorMessage = "";
    renderStep();
    focusPhoneInput();
  }

  function renderOtpCountryControl(control) {
    if (!control) return;
    const selected = getSelectedOtpCountry();
    const countries = state.otpCountryPolicy.allowedCountries;
    control.textContent = "";
    if (countries.length === 1) {
      const prefix = document.createElement("div");
      prefix.className = "megaska-otp-country-prefix";
      prefix.setAttribute("aria-label", `${selected.name} ${selected.dialCode}`);
      prefix.innerHTML = `<span class="megaska-otp-country-iso">${escapeHtml(selected.iso2)}</span><span class="megaska-otp-country-dial-code">${escapeHtml(selected.dialCode)}</span>`;
      control.appendChild(prefix);
      return;
    }

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "megaska-otp-country-trigger";
    trigger.dataset.megaskaCountryTrigger = "";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", String(state.countryMenuOpen));
    trigger.setAttribute("aria-label", `Select country, currently ${selected.name} ${selected.dialCode}`);
    trigger.innerHTML = `<span class="megaska-otp-country-iso">${escapeHtml(selected.iso2)}</span><span class="megaska-otp-country-dial-code">${escapeHtml(selected.dialCode)}</span><span aria-hidden="true">▾</span>`;
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      state.countryMenuOpen = !state.countryMenuOpen;
      renderOtpCountryControl(control);
      if (state.countryMenuOpen) control.querySelector('[role="option"][aria-selected="true"]')?.focus();
    });
    control.appendChild(trigger);
    if (!state.countryMenuOpen) return;

    const menu = document.createElement("div");
    menu.className = "megaska-otp-country-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Allowed countries");
    countries.forEach((country) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "megaska-otp-country-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(country.iso2 === selected.iso2));
      option.innerHTML = `<span class="megaska-otp-country-iso">${escapeHtml(country.iso2)}</span><span class="megaska-otp-country-name">${escapeHtml(country.name)}</span><span class="megaska-otp-country-dial-code">${escapeHtml(country.dialCode)}</span>`;
      option.addEventListener("click", () => selectOtpCountry(country.iso2));
      option.addEventListener("keydown", (event) => {
        const options = Array.from(menu.querySelectorAll('[role="option"]'));
        const index = options.indexOf(option);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
        }
      });
      menu.appendChild(option);
    });
    control.appendChild(menu);
  }

  function applyCountryPolicyToCurrentPhoneStep(policy) {
    if (state.step !== "phone" || state.requesting || state.otpRequestCountryCode) return false;
    const currentCountryAllowed = policy.allowedCountries.some((country) => country.iso2 === state.selectedOtpCountryCode);
    state.otpCountryPolicy = cloneOtpCountryPolicy(policy);
    if (!state.countrySelectionTouched && !state.phoneDigits || !currentCountryAllowed) {
      state.selectedOtpCountryCode = policy.defaultCountryCode;
    }
    state.phoneDigits = sanitizePhoneInputForCountry(state.phoneDigits, state.selectedOtpCountryCode);
    state.countryMenuOpen = false;
    state.otpPolicyHydrating = false;
    if (policyHydrationTimerId) {
      clearTimeout(policyHydrationTimerId);
      policyHydrationTimerId = null;
    }
    if (state.isOpen) renderStep();
    return true;
  }

  function refreshOtpCountryPolicy(rawPolicy) {
    const policy = rawPolicy
      ? setCachedOtpCountryPolicy(rawPolicy, { applyToModal: false })
      : resolveOtpCountryPolicy();
    return policy ? applyCountryPolicyToCurrentPhoneStep(policy) : false;
  }

  function ensureModal() {
    let modal = document.querySelector("[data-megaska-otp-modal]");
    if (modal) {
      applyOtpModalBranding(modal);
      return modal;
    }

    modal = document.createElement("div");
    modal.setAttribute("data-megaska-otp-modal", "1");
    modal.setAttribute("aria-hidden", "true");
    modal.className = "megaska-otp-modal";
    modal.hidden = true;


    modal.innerHTML = `
      <div class="megaska-otp-backdrop" data-megaska-otp-backdrop></div>

      <div class="megaska-otp-dialog" role="dialog" aria-modal="true" aria-labelledby="megaska-otp-title">
        <section class="megaska-otp-flow">
          <button
            class="megaska-otp-close"
            data-megaska-otp-close
            type="button"
            aria-label="Close"
          >×</button>

          <div class="megaska-otp-header">
            <div class="megaska-otp-handle" aria-hidden="true"></div>

            <div class="megaska-otp-logo-wrap" data-megaska-otp-logo-wrap>
              <span class="megaska-otp-brand-text" data-megaska-otp-brand-text></span>
            </div>

            <div class="megaska-otp-offer" data-megaska-otp-offer-container hidden></div>

            <h2 id="megaska-otp-title" class="megaska-otp-title" data-megaska-otp-title></h2>
            <p class="megaska-otp-subtitle" data-megaska-otp-description></p>

            <div class="megaska-otp-trust-strip" data-megaska-otp-trust-strip hidden></div>
          </div>

          <div data-megaska-step-phone class="megaska-otp-step-phone">
            <label class="megaska-otp-label" for="megaska-phone-input">Mobile number</label>
            <div class="megaska-otp-phone-wrap megaska-otp-phone-field" role="group" aria-label="Mobile number">
              <div data-megaska-country-control class="megaska-otp-country-control"></div>
              <input
                id="megaska-phone-input"
                data-megaska-phone-input
                class="megaska-otp-phone-input"
                type="tel"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel-national"
                placeholder="Mobile number"
                aria-label="Enter your mobile number"
              />
            </div>
            <p class="megaska-otp-hint" data-megaska-phone-hint></p>
            <button type="button" class="megaska-otp-primary-btn megaska-otp-send-btn" data-megaska-send-otp hidden>Send OTP</button>
            <p class="megaska-otp-trouble" data-megaska-otp-privacy></p>
          </div>

          <div data-megaska-step-otp hidden class="megaska-otp-step-otp">
            <h2 class="megaska-otp-step-title">OTP Verification</h2>
            <p class="megaska-otp-step-subtitle">
              We sent a verification code to <span data-megaska-phone-display></span>
            </p>
            <p class="megaska-otp-helper-link-row">
              <button type="button" class="megaska-otp-link" data-megaska-edit-phone>Edit number</button>
            </p>
<p class="megaska-otp-status" data-megaska-otp-status></p>
            <div class="megaska-otp-inputs" data-megaska-otp-inputs>
              ${Array.from({ length: OTP_LENGTH })
                .map(
                  (_, index) => `
                <input
                  type="tel"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="1"
                  class="megaska-otp-digit"
                  data-megaska-otp-digit
                  data-index="${index}"
                  aria-label="OTP digit ${index + 1}"
                />`
                )
                .join("")}
            </div>

            <div class="megaska-otp-resend-row">
              <span data-megaska-resend-text>Resend available in 30s</span>
              <button type="button" class="megaska-otp-link" data-megaska-resend disabled>Resend OTP</button>
            </div>
            <p class="megaska-otp-trouble">
              <button type="button" class="megaska-otp-link" data-megaska-edit-phone>Entered wrong number?</button>
            </p>
          </div>

          <div data-megaska-step-profile hidden class="megaska-otp-step-profile">
            <h2 class="megaska-otp-step-title">Complete your profile</h2>
            <p class="megaska-otp-step-subtitle">Just your name and email to get started</p>
            <div class="megaska-otp-profile-grid">
              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-firstname-input">First Name</label>
                <input
                  id="megaska-firstname-input"
                  data-megaska-profile-firstname
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="given-name"
                  placeholder="Enter your first name"
                  aria-label="Enter your first name"
                />
              </div>

              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-lastname-input">Last Name</label>
                <input
                  id="megaska-lastname-input"
                  data-megaska-profile-lastname
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="family-name"
                  placeholder="Enter your last name"
                  aria-label="Enter your last name"
                />
              </div>

              <div class="megaska-otp-form-field megaska-otp-col-span-2">
                <label class="megaska-otp-label" for="megaska-email-input">Email Address</label>
                <input
                  id="megaska-email-input"
                  data-megaska-profile-email
                  class="megaska-otp-text-input"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                  aria-label="Enter your email address"
                />
              </div>
            </div>

            <button type="button" class="megaska-otp-primary-btn" data-megaska-profile-submit>
              Save and Continue
            </button>
          </div>

          <div data-megaska-step-email-disambiguate hidden class="megaska-otp-step-profile">
            <h2 class="megaska-otp-step-title">Find your account</h2>
            <p class="megaska-otp-step-subtitle">We found more than one account for this number. Enter the email on your account and we'll send a verification code.</p>
            <div class="megaska-otp-profile-grid">
              <div class="megaska-otp-form-field megaska-otp-col-span-2">
                <label class="megaska-otp-label" for="megaska-disambiguate-email-input">Email Address</label>
                <input
                  id="megaska-disambiguate-email-input"
                  data-megaska-disambiguate-email
                  class="megaska-otp-text-input"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                  aria-label="Enter your email address"
                />
              </div>
            </div>

            <button type="button" class="megaska-otp-primary-btn" data-megaska-disambiguate-submit>
              Send verification code
            </button>
          </div>

          <div data-megaska-step-email-code hidden class="megaska-otp-step-profile">
            <h2 class="megaska-otp-step-title">Enter verification code</h2>
            <p class="megaska-otp-step-subtitle">We sent a 6-digit code to <span data-megaska-email-code-destination></span></p>
            <div class="megaska-otp-profile-grid">
              <div class="megaska-otp-form-field megaska-otp-col-span-2">
                <label class="megaska-otp-label" for="megaska-email-code-input">Verification code</label>
                <input
                  id="megaska-email-code-input"
                  data-megaska-email-code-input
                  class="megaska-otp-text-input"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  autocomplete="one-time-code"
                  placeholder="Enter 6-digit code"
                  aria-label="Enter 6-digit verification code"
                />
              </div>
            </div>

            <button type="button" class="megaska-otp-primary-btn" data-megaska-email-code-submit>
              Verify and Continue
            </button>
            <p class="megaska-otp-trouble">
              <button type="button" class="megaska-otp-link" data-megaska-email-code-resend>Resend code</button>
            </p>
          </div>

          <div data-megaska-step-success hidden class="megaska-otp-success">
            <div class="megaska-otp-success-icon" aria-hidden="true">✓</div>
            <h2>You’re in</h2>
            <p data-megaska-success-message>Welcome back</p>
          </div>

          <p class="megaska-otp-error" data-megaska-otp-error role="alert" aria-live="polite"></p>
        </section>
      </div>
    `;

    document.body.appendChild(modal);
    applyOtpModalBranding(modal);

    modal.querySelector("[data-megaska-otp-close]").addEventListener("click", () => {
      closeModal("close-button");
    });

    modal.querySelector("[data-megaska-otp-backdrop]").addEventListener("click", () => {
      closeModal("backdrop");
    });

    const phoneInput = modal.querySelector("[data-megaska-phone-input]");
    phoneInput.addEventListener("input", handlePhoneInput);
    phoneInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        console.log("[Megaska OTP] mobile form submitted", { digitCount: state.phoneDigits.length });
        handleSendOtpClick(event);
      }
    });
    modal.querySelector("[data-megaska-send-otp]").addEventListener("click", handleSendOtpClick);
    modal.querySelectorAll("[data-megaska-edit-phone]").forEach((editBtn) => {
      editBtn.addEventListener("click", handleEditPhone);
    });
    modal.querySelector("[data-megaska-resend]").addEventListener("click", handleResend);

    modal.querySelectorAll("[data-megaska-otp-digit]").forEach((input) => {
      input.addEventListener("input", handleOtpInput);
      input.addEventListener("keydown", handleOtpKeyDown);
      input.addEventListener("paste", handleOtpPaste);
      input.addEventListener("focus", () => {
        input.select();
      });
    });

    modal
      .querySelector("[data-megaska-profile-submit]")
      .addEventListener("click", handleProfileSubmit);

    modal
      .querySelector("[data-megaska-profile-firstname]")
      .addEventListener("input", (event) => {
        state.profileFirstName = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-lastname]")
      .addEventListener("input", (event) => {
        state.profileLastName = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-email]")
      .addEventListener("input", (event) => {
        state.profileEmail = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-disambiguate-email]")
      .addEventListener("input", (event) => {
        state.disambiguateEmail = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-disambiguate-submit]")
      .addEventListener("click", handleEmailDisambiguateSubmit);

    modal
      .querySelector("[data-megaska-email-code-input]")
      .addEventListener("input", (event) => {
        state.emailCode = String(event.target.value || "").replace(/\D/g, "").slice(0, 6);
        event.target.value = state.emailCode;
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-email-code-submit]")
      .addEventListener("click", handleEmailCodeSubmit);

    modal
      .querySelector("[data-megaska-email-code-resend]")
      .addEventListener("click", handleEmailCodeResend);

    document.addEventListener("keydown", handleEscClose);
    document.addEventListener("click", (event) => {
      if (state.countryMenuOpen && !event.target.closest?.("[data-megaska-country-control]")) closeOtpCountryMenu();
    });

    return modal;
  }

  function getModalParts() {
  const modal = ensureModal();
  return {
    modal,
    stepPhone: modal.querySelector("[data-megaska-step-phone]"),
    stepOtp: modal.querySelector("[data-megaska-step-otp]"),
    stepProfile: modal.querySelector("[data-megaska-step-profile]"),
    stepEmailDisambiguate: modal.querySelector("[data-megaska-step-email-disambiguate]"),
    stepEmailCode: modal.querySelector("[data-megaska-step-email-code]"),
    stepSuccess: modal.querySelector("[data-megaska-step-success]"),
    phoneInput: modal.querySelector("[data-megaska-phone-input]"),
    phoneHint: modal.querySelector("[data-megaska-phone-hint]"),
    countryControl: modal.querySelector("[data-megaska-country-control]"),
    sendOtpBtn: modal.querySelector("[data-megaska-send-otp]"),
    phoneDisplay: modal.querySelector("[data-megaska-phone-display]"),
    otpInputs: Array.from(modal.querySelectorAll("[data-megaska-otp-digit]")),
    resendText: modal.querySelector("[data-megaska-resend-text]"),
    resendBtn: modal.querySelector("[data-megaska-resend]"),
    profileFirstNameInput: modal.querySelector("[data-megaska-profile-firstname]"),
    profileLastNameInput: modal.querySelector("[data-megaska-profile-lastname]"),
    profileEmailInput: modal.querySelector("[data-megaska-profile-email]"),
    profileSubmitBtn: modal.querySelector("[data-megaska-profile-submit]"),
    disambiguateEmailInput: modal.querySelector("[data-megaska-disambiguate-email]"),
    disambiguateSubmitBtn: modal.querySelector("[data-megaska-disambiguate-submit]"),
    emailCodeInput: modal.querySelector("[data-megaska-email-code-input]"),
    emailCodeSubmitBtn: modal.querySelector("[data-megaska-email-code-submit]"),
    emailCodeResendBtn: modal.querySelector("[data-megaska-email-code-resend]"),
    emailCodeDestination: modal.querySelector("[data-megaska-email-code-destination]"),
    errorEl: modal.querySelector("[data-megaska-otp-error]"),
    statusEl: modal.querySelector("[data-megaska-otp-status]"),
    successMessage: modal.querySelector("[data-megaska-success-message]"),
  };
}
  function renderStep() {
  const {
    stepPhone,
    stepOtp,
    stepProfile,
    stepEmailDisambiguate,
    stepEmailCode,
    stepSuccess,
    phoneInput,
    phoneHint,
    phoneDisplay,
    countryControl,
    sendOtpBtn,
    otpInputs,
    resendText,
    resendBtn,
    profileFirstNameInput,
    profileLastNameInput,
    profileEmailInput,
    profileSubmitBtn,
    disambiguateEmailInput,
    disambiguateSubmitBtn,
    emailCodeInput,
    emailCodeSubmitBtn,
    emailCodeResendBtn,
    emailCodeDestination,
    errorEl,
    statusEl,
    successMessage,
  } = getModalParts();

  stepPhone.hidden = state.step !== "phone";
  stepOtp.hidden = state.step !== "otp";
  stepProfile.hidden = state.step !== "profile";
  stepEmailDisambiguate.hidden = state.step !== "email-disambiguate";
  stepEmailCode.hidden = state.step !== "email-code";
  stepSuccess.hidden = state.step !== "success";

  if (lastLoggedStep !== state.step) {
    lastLoggedStep = state.step;
    console.log("[Megaska OTP] step state changed", { step: state.step });
  }

  const selectedCountry = getSelectedOtpCountry();
  phoneInput.value = state.phoneDigits;
  phoneInput.disabled = state.otpPolicyHydrating || state.requesting;
  phoneInput.maxLength = selectedCountry.iso2 === "IN" ? 10 : INTERNATIONAL_PHONE_MAX_LENGTH;
  phoneInput.placeholder = "Mobile number";
  phoneDisplay.textContent = maskOtpDestination({
    phoneE164: state.otpRequestPhoneE164,
    phoneInput: state.otpRequestPhoneInput,
    country: getOtpCountry(state.otpRequestCountryCode) || selectedCountry,
  });
  if (state.otpPolicyHydrating) {
    countryControl.textContent = "";
    const placeholder = document.createElement("div");
    placeholder.className = "megaska-otp-country-prefix";
    placeholder.setAttribute("aria-label", "Loading country options");
    placeholder.textContent = "--";
    countryControl.appendChild(placeholder);
  } else {
    renderOtpCountryControl(countryControl);
  }
  sendOtpBtn.hidden = selectedCountry.iso2 === "IN";
  sendOtpBtn.disabled = state.otpPolicyHydrating || state.requesting || !state.phoneDigits;
  successMessage.textContent = state.successMessage;

  profileFirstNameInput.value = state.profileFirstName;
  profileLastNameInput.value = state.profileLastName;
  profileEmailInput.value = state.profileEmail;

  profileFirstNameInput.disabled = state.savingProfile;
  profileLastNameInput.disabled = state.savingProfile;
  profileEmailInput.disabled = state.savingProfile;
  profileSubmitBtn.disabled = state.savingProfile;
  profileSubmitBtn.textContent = state.savingProfile ? "Saving..." : "Save and Continue";

  disambiguateEmailInput.value = state.disambiguateEmail;
  disambiguateEmailInput.disabled = state.requestingEmailCode;
  disambiguateSubmitBtn.disabled = state.requestingEmailCode;
  disambiguateSubmitBtn.textContent = state.requestingEmailCode ? "Sending..." : "Send verification code";

  emailCodeInput.value = state.emailCode;
  emailCodeInput.disabled = state.verifyingEmailCode;
  emailCodeDestination.textContent = state.emailVerifyDestination;
  emailCodeSubmitBtn.disabled = state.verifyingEmailCode;
  emailCodeSubmitBtn.textContent = state.verifyingEmailCode ? "Verifying..." : "Verify and Continue";
  emailCodeResendBtn.disabled = state.requestingEmailCode;

  otpInputs.forEach((input, index) => {
    input.value = state.otpDigits[index] || "";
    input.disabled = state.verifying;
  });

  if (state.step === "phone") {
    if (state.requesting) {
      phoneHint.textContent = "Sending OTP...";
    } else if (selectedCountry.iso2 !== "IN" || state.phoneDigits.length < 10) {
      phoneHint.textContent = "Enter your mobile number without the country code.";
    } else {
      phoneHint.textContent = state.normalizedPhone === state.lastRequestedPhone ? "OTP sent. Check your messages." : "Sending OTP automatically...";
    }
  }

  if (statusEl) {
    statusEl.textContent = state.statusMessage || "";
  }

  errorEl.textContent = state.errorMessage || "";

  if (state.step !== "otp") {
    resendBtn.disabled = true;
    resendText.textContent = "";
  } else if (state.requesting) {
    resendText.textContent = "Sending new OTP...";
    resendBtn.disabled = true;
  } else if (state.resendSeconds > 0) {
    resendText.textContent = `Resend available in ${state.resendSeconds}s`;
    resendBtn.disabled = true;
  } else {
    resendText.textContent = "Didn't get the code?";
    resendBtn.disabled = false;
  }
}

  function updateResendUi() {
    const { resendBtn, resendText } = getModalParts();

    if (state.step !== "otp") {
      resendBtn.disabled = true;
      resendText.textContent = "";
      return;
    }

    if (state.requesting) {
      resendText.textContent = "Sending new OTP...";
      resendBtn.disabled = true;
      return;
    }

    if (state.resendSeconds > 0) {
      resendText.textContent = `Resend available in ${state.resendSeconds}s`;
      resendBtn.disabled = true;
      return;
    }

    resendText.textContent = "Didn't get the code?";
    resendBtn.disabled = false;
  }

  function focusPhoneInput() {
    const { phoneInput } = getModalParts();
    setTimeout(() => phoneInput.focus(), 0);
  }

  function focusOtpInput(index) {
    const { otpInputs } = getModalParts();
    const safeIndex = Math.max(0, Math.min(OTP_LENGTH - 1, index));
    setTimeout(() => otpInputs[safeIndex].focus(), 0);
  }

  function focusProfileInput() {
    const { profileFirstNameInput } = getModalParts();
    setTimeout(() => profileFirstNameInput.focus(), 0);
  }

  function focusDisambiguateEmailInput() {
    const { disambiguateEmailInput } = getModalParts();
    setTimeout(() => disambiguateEmailInput.focus(), 0);
  }

  function focusEmailCodeInput() {
    const { emailCodeInput } = getModalParts();
    setTimeout(() => emailCodeInput.focus(), 0);
  }

  function openModal(triggerSource) {
    closeAccountMenu();
    closeCartDrawerBeforeModal();
    const { modal } = getModalParts();
    state.isOpen = true;
    resetModalState();
    const interactionId = ++modalInteractionId;
    const hasImmediatePolicy = otpRuntimePolicyReady || hasUsableOtpCountryPolicy(window.LoopDeskConfig?.otpCountryPolicy);
    if (!hasImmediatePolicy) {
      state.otpPolicyHydrating = true;
      policyHydrationTimerId = setTimeout(() => {
        policyHydrationTimerId = null;
        if (interactionId !== modalInteractionId || !state.isOpen || state.step !== "phone" || state.otpRequestCountryCode) return;
        state.otpPolicyHydrating = false;
        renderStep();
      }, OTP_POLICY_HYDRATION_TIMEOUT_MS);
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("megaska-otp-open");
    renderStep();
    //focusPhoneInput();

    if (triggerSource) {
      console.log("[Megaska OTP] modal opened", { triggerSource });
    }
  }

  function closeModal(reason, options) {
    if (reason && reason !== "success") {
      document.dispatchEvent(new CustomEvent("megaska:otp-cancelled", { detail: { reason } }));
    }
    const opts = options || {};
    const force = Boolean(opts.force);

    if (!force && isBusy()) return false;

    const { modal } = getModalParts();
    state.isOpen = false;
    modalInteractionId += 1;
    if (policyHydrationTimerId) {
      clearTimeout(policyHydrationTimerId);
      policyHydrationTimerId = null;
    }
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("megaska-otp-open");
    resetModalState();
    renderStep();

    if (reason) {
      console.log("[Megaska OTP] modal closed", { reason });
    }

    return true;
  }

  function renderPhoneStep() {
  state.step = "phone";
  state.errorMessage = "";
  state.statusMessage = "";
  state.otpDigits = ["", "", "", ""];
  state.otpRequestPhoneInput = "";
  state.otpRequestCountryCode = "";
  state.otpRequestPhoneE164 = "";
  state.lastRequestedPhone = "";
  renderStep();
  focusPhoneInput();
}

function renderOtpStep() {
  state.step = "otp";
  console.log("[Megaska OTP] OTP step state changes", { requesting: state.requesting });
  state.errorMessage = "";
  state.statusMessage = state.requesting ? "Sending OTP..." : "";
  state.otpDigits = ["", "", "", ""];
  renderStep();
  const { otpInputs } = getModalParts();
  console.log("[Megaska OTP] OTP input fields rendered", { count: otpInputs.length });
  if (!state.requesting) focusOtpInput(0);
}

function renderSuccessStep(message) {
  state.step = "success";
  state.statusMessage = "";
  state.errorMessage = "";
  state.successMessage = message || "You're in!";
  renderStep();
}

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function renderProfileStep(customer) {
    state.step = "profile";
    state.errorMessage = "";
    state.profileFirstName = normalizeText(customer?.firstName || "");
    state.profileLastName = normalizeText(customer?.lastName || "");
    state.profileEmail = normalizeEmail(customer?.email || "");
    renderStep();
    focusProfileInput();
  }

  function renderEmailDisambiguateStep() {
    state.step = "email-disambiguate";
    state.errorMessage = "";
    renderStep();
    focusDisambiguateEmailInput();
  }

  function renderEmailCodeStep(email) {
    state.step = "email-code";
    state.errorMessage = "";
    state.emailVerifyDestination = email;
    state.emailCode = "";
    renderStep();
    focusEmailCodeInput();
  }

  function getOtpRequestPayload(response) {
    if (!response || typeof response !== "object") return null;
    if (response.data && typeof response.data === "object") {
      return response.data;
    }
    return response;
  }

  function didOtpRequestSucceed(response) {
    if (!response) {
      return true;
    }

    const payload = getOtpRequestPayload(response);
    if (!payload) return false;

    if (payload.ok === true || payload.success === true || payload.otpSent === true || payload.sent === true) {
      return true;
    }

    if (typeof payload.status === "string") {
      const normalizedStatus = payload.status.trim().toLowerCase();
      if (normalizedStatus === "sent" || normalizedStatus === "pending" || normalizedStatus === "approved") {
        return true;
      }
    }

    return Boolean(payload.challengeId || payload.requestId);
  }

  function getOtpRequestErrorMessage(response) {
    const payload = getOtpRequestPayload(response);
    return (
      payload?.error ||
      payload?.message ||
      payload?.data?.error ||
      payload?.data?.message ||
      "Unable to send OTP. Please try again."
    );
  }

  async function submitPhoneIfReady(options) {
    if (!isModalOpen() || state.requesting || state.verifying) return;
    const country = getSelectedOtpCountry();
    const isIndia = country.iso2 === "IN";
    if (isIndia && state.phoneDigits.length !== 10) return;
    if (!isIndia && !options?.explicit) return;
    if (!state.phoneDigits) {
      state.errorMessage = "Enter a valid mobile number for the selected country.";
      renderStep();
      return;
    }

    const normalizedPhone = isIndia ? normalizeIndianPhone(state.phoneDigits) : state.phoneDigits;
    if (!normalizedPhone) {
      state.errorMessage = "Enter a valid mobile number for the selected country.";
      renderStep();
      return;
    }
    if (state.lastRequestedPhone === normalizedPhone && state.otpRequestCountryCode === country.iso2) return;

    state.requesting = true;
    state.errorMessage = "";
    state.statusMessage = "📲 Sending your beach passcode...";
    state.normalizedPhone = normalizedPhone;
    state.lastRequestedPhone = normalizedPhone;
    state.otpRequestPhoneInput = state.phoneDigits;
    state.otpRequestCountryCode = country.iso2;
    state.otpRequestPhoneE164 = "";
    renderOtpStep();
    startResendTimer();

    try {
      const otpRequestResponse = await window.MegaskaAuth.requestOtp(state.otpRequestPhoneInput, state.otpRequestCountryCode);
      if (!isModalOpen()) return;
      if (!didOtpRequestSucceed(otpRequestResponse)) {
        const error = new Error(getOtpRequestErrorMessage(otpRequestResponse));
        error.code = getOtpRequestPayload(otpRequestResponse)?.code || getOtpRequestPayload(otpRequestResponse)?.errorCode;
        throw error;
      }
      const payload = getOtpRequestPayload(otpRequestResponse);
      state.otpRequestPhoneE164 = String(payload?.phoneE164 || payload?.phone || "");
      state.requesting = false;
      state.statusMessage = "";
      renderStep();
      focusOtpInput(0);
    } catch (error) {
      state.requesting = false;
      state.step = "phone";
      state.statusMessage = "";
      state.lastRequestedPhone = "";
      state.otpRequestPhoneInput = "";
      state.otpRequestCountryCode = "";
      state.otpRequestPhoneE164 = "";
      if (error.code === "COUNTRY_NOT_ALLOWED") {
        refreshOtpCountryPolicy();
        state.errorMessage = "OTP login is no longer available for this country. Select another country.";
      } else if (["PHONE_REQUIRED", "INVALID_PHONE", "INVALID_COUNTRY"].includes(error.code)) {
        state.errorMessage = "Enter a valid mobile number for the selected country.";
      } else {
        state.errorMessage = error.message || "Could not send OTP. Please try again.";
      }
      renderStep();
      focusPhoneInput();
    }
  }

  function handlePhoneInput(event) {
    if (!isModalOpen()) return;
    const countryCode = getSelectedOtpCountry().iso2;
    state.phoneDigits = sanitizePhoneInputForCountry(event.target.value, countryCode);
    event.target.value = state.phoneDigits;
    state.errorMessage = "";
    renderStep();
    if (countryCode === "IN") submitPhoneIfReady();
  }

  function handleSendOtpClick(event) {
    if (event) event.preventDefault();
    submitPhoneIfReady({ explicit: true });
  }

  function collectOtpDigits() {
    return state.otpDigits.join("");
  }

 async function submitOtpIfReady() {
  const otp = collectOtpDigits();

  if (!isModalOpen()) return;
  if (state.verifying || state.requesting) return;
  if (otp.length !== OTP_LENGTH || !state.normalizedPhone) return;

  state.verifying = true;
  state.errorMessage = "";
  state.statusMessage = "✨ Verifying your secure access OTP...";
  renderStep();

  try {
    await window.MegaskaAuth.verifyOtp(state.otpRequestPhoneInput, otp, state.otpRequestCountryCode);
    const refreshedSession = await window.MegaskaAuth.refreshAuthState();
    state.verifying = false;
    state.statusMessage = "";

    const sessionCustomer = refreshedSession?.customer || null;

    const hasCheckoutPending =
      pendingAction &&
      ["navigate", "buy-now-submit"].includes(pendingAction.type);

    if (hasCheckoutPending) {
      await completeAuthenticatedLogin(sessionCustomer, { hasCheckoutPending: true });
      return;
    }

    let linkStatus = "new";
    try {
      const linkStatusResponse = await window.MegaskaAuth.getProfileLinkStatus();
      linkStatus = linkStatusResponse?.status || "new";
    } catch (error) {
      console.warn("[Megaska OTP] profile link status check failed", error);
      linkStatus = "new";
    }

    if (linkStatus === "ambiguous") {
      renderEmailDisambiguateStep();
      return;
    }

    if (linkStatus === "new") {
      renderProfileStep(sessionCustomer);
      return;
    }

    await completeAuthenticatedLogin(sessionCustomer, { hasCheckoutPending: false });
  } catch (error) {
    state.verifying = false;
    state.statusMessage = "";
    state.errorMessage = error.message || "Invalid or expired OTP. Please try again.";
    state.otpDigits = ["", "", "", ""];
    renderStep();
    //focusOtpInput(0);
  }
}

/** Shared tail for every path that ends in an authenticated, linked session. */
async function completeAuthenticatedLogin(sessionCustomer, options) {
  const opts = options || {};
  const hasCheckoutPending = Boolean(opts.hasCheckoutPending);

  hideAccountMenu();
  await syncAccountUiState();

  const accountRedirectTarget = consumePendingAccountRedirect();
  if (accountRedirectTarget) {
    console.log("[Megaska OTP] account redirect after login", { accountRedirectTarget });
    window.location.assign(accountRedirectTarget);
    return;
  }

  if (hasCheckoutPending) {
    renderSuccessStep("Preparing your checkout...");
  } else {
    renderSuccessStep(opts.successMessage || getOtpModalBranding().successMessage);
  }

  await resumePendingAction(sessionCustomer);

  if (!hasCheckoutPending) {
    setTimeout(() => closeModal("success", { force: true }), SUCCESS_CLOSE_DELAY_MS);
  }
}
  async function handleProfileSubmit() {
    if (!isModalOpen()) return;
    if (state.step !== "profile") return;
    if (state.savingProfile) return;

    const firstName = normalizeText(state.profileFirstName);
    const lastName = normalizeText(state.profileLastName);
    const email = normalizeEmail(state.profileEmail);

    if (!firstName) {
      state.errorMessage = "Please enter your first name.";
      renderStep();
      focusProfileInput();
      return;
    }

    if (!lastName) {
      state.errorMessage = "Please enter your last name.";
      renderStep();
      const { profileLastNameInput } = getModalParts();
      setTimeout(() => profileLastNameInput.focus(), 0);
      return;
    }

    if (!email || !isValidEmail(email)) {
      state.errorMessage = "Please enter a valid email address.";
      renderStep();
      const { profileEmailInput } = getModalParts();
      setTimeout(() => profileEmailInput.focus(), 0);
      return;
    }

    state.savingProfile = true;
    state.errorMessage = "";
    renderStep();

    try {
      await window.MegaskaAuth.completeProfile({ firstName, lastName, email });
      const refreshedSession = await window.MegaskaAuth.refreshAuthState();
      const sessionCustomer = refreshedSession?.customer || null;
      state.savingProfile = false;
      await completeAuthenticatedLogin(sessionCustomer, {
        successMessage: "✨ Saved! Your next checkout will be even faster",
      });
    } catch (error) {
      state.savingProfile = false;
      state.errorMessage = error.message || "Unable to save your profile right now.";
      renderStep();
    }
  }

  async function handleEmailDisambiguateSubmit() {
    if (!isModalOpen()) return;
    if (state.step !== "email-disambiguate") return;
    if (state.requestingEmailCode) return;

    const email = normalizeEmail(state.disambiguateEmail);

    if (!email || !isValidEmail(email)) {
      state.errorMessage = "Please enter a valid email address.";
      renderStep();
      focusDisambiguateEmailInput();
      return;
    }

    state.requestingEmailCode = true;
    state.errorMessage = "";
    renderStep();

    try {
      await window.MegaskaAuth.requestEmailVerification(email);
      state.requestingEmailCode = false;
      renderEmailCodeStep(email);
    } catch (error) {
      state.requestingEmailCode = false;
      state.errorMessage =
        error.message === "EMAIL_NOT_FOUND"
          ? "We couldn't find that email on your account. Please check and try again."
          : error.message || "Unable to send a verification code right now.";
      renderStep();
    }
  }

  async function handleEmailCodeSubmit() {
    if (!isModalOpen()) return;
    if (state.step !== "email-code") return;
    if (state.verifyingEmailCode) return;

    const code = String(state.emailCode || "").trim();
    if (code.length !== 6) {
      state.errorMessage = "Please enter the 6-digit code.";
      renderStep();
      focusEmailCodeInput();
      return;
    }

    state.verifyingEmailCode = true;
    state.errorMessage = "";
    renderStep();

    try {
      await window.MegaskaAuth.confirmEmailVerification(state.emailVerifyDestination, code);
      const refreshedSession = await window.MegaskaAuth.refreshAuthState();
      const sessionCustomer = refreshedSession?.customer || null;
      state.verifyingEmailCode = false;
      await completeAuthenticatedLogin(sessionCustomer, {
        successMessage: "✨ Verified! Welcome back",
      });
    } catch (error) {
      state.verifyingEmailCode = false;
      state.errorMessage = error.message || "Incorrect code. Please try again.";
      state.emailCode = "";
      renderStep();
      focusEmailCodeInput();
    }
  }

  async function handleEmailCodeResend() {
    if (!isModalOpen()) return;
    if (state.step !== "email-code") return;
    if (state.requestingEmailCode) return;

    state.requestingEmailCode = true;
    state.errorMessage = "";
    renderStep();

    try {
      await window.MegaskaAuth.requestEmailVerification(state.emailVerifyDestination);
      state.requestingEmailCode = false;
      state.statusMessage = "A new code has been sent.";
      renderStep();
    } catch (error) {
      state.requestingEmailCode = false;
      state.errorMessage = error.message || "Unable to resend the code right now.";
      renderStep();
    }
  }

 function handleOtpInput(event) {
  if (!isModalOpen()) return;

  const input = event.target;
  const index = Number(input.dataset.index);
  const value = String(input.value || "");

  // FULL OTP autofill (key fix)
  if (value.length > 1) {
    const digits = value.replace(/\D/g, "").slice(0, OTP_LENGTH);
    state.otpDigits = digits.split("").concat(Array(OTP_LENGTH).fill("")).slice(0, OTP_LENGTH);
    state.errorMessage = "";
    renderStep();

    if (digits.length === OTP_LENGTH) {
      submitOtpIfReady();
    }
    return;
  }

  const digit = value.replace(/\D/g, "").slice(0, 1);
  state.otpDigits[index] = digit;
  input.value = digit;

  if (digit && index < OTP_LENGTH - 1) {
    focusOtpInput(index + 1);
  }

  if (collectOtpDigits().length === OTP_LENGTH) {
    submitOtpIfReady();
  }
}
  function handleOtpKeyDown(event) {
    if (!isModalOpen()) return;

    const index = Number(event.target.dataset.index);

    if (event.key === "Backspace") {
      if (state.otpDigits[index]) {
        state.otpDigits[index] = "";
        event.target.value = "";
        renderStep();
        return;
      }

      if (index > 0) {
        state.otpDigits[index - 1] = "";
        renderStep();
        focusOtpInput(index - 1);
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusOtpInput(index - 1);
    }

    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      focusOtpInput(index + 1);
    }
  }

  function handleOtpPaste(event) {
  if (!isModalOpen()) return;

  event.preventDefault();

  const pasted = event.clipboardData.getData("text");
  const digits = pasted.replace(/\D/g, "").slice(0, OTP_LENGTH);

  if (!digits) return;

  state.otpDigits = digits.split("").concat(Array(OTP_LENGTH).fill("")).slice(0, OTP_LENGTH);
  state.errorMessage = "";
  renderStep();

  if (digits.length === OTP_LENGTH) {
    submitOtpIfReady();
  }
}
  async function handleResend() {
    if (!isModalOpen()) return;
    if (state.requesting || state.resendSeconds > 0 || !state.normalizedPhone) return;

    state.requesting = true;
    state.errorMessage = "";
    renderStep();

    try {
      const otpRequestResponse = await window.MegaskaAuth.requestOtp(state.otpRequestPhoneInput, state.otpRequestCountryCode);
      if (!didOtpRequestSucceed(otpRequestResponse)) {
        throw new Error(getOtpRequestErrorMessage(otpRequestResponse));
      }
      state.requesting = false;
      state.lastRequestedPhone = state.normalizedPhone;
      state.otpDigits = ["", "", "", ""];
      renderStep();
      focusOtpInput(0);
      startResendTimer();
    } catch (error) {
      state.requesting = false;
      state.errorMessage = error.message || "Could not send OTP. Please try again.";
      renderStep();
    }
  }

  function handleEditPhone() {
    if (!isModalOpen()) return;
    if (isBusy()) return;
    renderPhoneStep();
  }

  function handleEscClose(event) {
    if (event.key === "Escape" && state.countryMenuOpen) {
      event.preventDefault();
      closeOtpCountryMenu({ focusTrigger: true });
      return;
    }
    if (event.key !== "Escape") return;
    if (!isModalOpen()) return;
    closeModal("escape");
  }

  async function handlePromptFallback() {
    const phone = prompt("Enter your 10-digit mobile number:");
    if (!phone) return;

    const phoneDigits = sanitizeDigits(phone, 10);
    const normalizedPhone = normalizeIndianPhone(phoneDigits);

    if (!normalizedPhone) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }

    try {
      await window.MegaskaAuth.requestOtp(phoneDigits, "IN");
      const otp = prompt("Enter the 4-digit OTP:");
      if (!otp) return;

      await window.MegaskaAuth.verifyOtp(phoneDigits, sanitizeDigits(otp, OTP_LENGTH), "IN");
      await window.MegaskaAuth.refreshAuthState();
      await resumePendingAction();
      alert("Login successful.");
    } catch (error) {
      alert(error.message || "Login failed. Please try again.");
    }
  }

  function findClosestMatchingElement(event, selectorList) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return null;
    const selector = selectorList.join(", ");
    return target.closest(selector);
  }

  function isCheckoutTarget(element) {
    if (!element) return false;

    if (
      element.matches("a[href='/checkout'], a[href*='/checkout']") ||
      element.matches(
        "button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], button[data-action='checkout'], button[data-action='proceed-to-checkout'], [data-checkout-button], .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout"
      )
    ) {
      return true;
    }

    const form = element.closest("form");
    if (!form) return false;

    const action = form.getAttribute("action") || "";
    return action.includes("/checkout");
  }

  function hasCheckoutIntentText(value) {
    return /(checkout|check-out|goto_pp|buy[\s_-]?now|proceed)/i.test(String(value || ""));
  }

  function inferCheckoutTriggerFromEvent(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return null;

    const directMatch = findClosestMatchingElement(event, CHECKOUT_TRIGGER_SELECTORS);
    if (directMatch) return directMatch;

    const candidate = target.closest("a,button,input,[role='button']");
    if (!candidate) return null;

    const href = candidate.getAttribute("href");
    const formAction = candidate.getAttribute("formaction");
    const name = candidate.getAttribute("name");
    const dataAction = candidate.getAttribute("data-action");
    const className = candidate.className;
    const id = candidate.id;
    const text = candidate.textContent;

    if (
      String(href || "").includes("/checkout") ||
      String(formAction || "").includes("/checkout") ||
      hasCheckoutIntentText(name) ||
      hasCheckoutIntentText(dataAction) ||
      hasCheckoutIntentText(className) ||
      hasCheckoutIntentText(id) ||
      hasCheckoutIntentText(text)
    ) {
      return candidate;
    }

    return null;
  }


  function getElementUrlPath(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) return "";
    try {
      return new URL(rawValue, window.location.origin).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return rawValue.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    }
  }

  function isCartAddPath(value) {
    const path = getElementUrlPath(value);
    return path === "/cart/add" || path === "/cart/add.js";
  }

  function hasAddToCartIntentText(value) {
    return /(add[\s_-]*(to[\s_-]*)?cart|cart[\s_-]*add|add-to-cart)/i.test(String(value || ""));
  }

  function isAddToCartIntent(target) {
    if (!target) return false;

    const element = target.target || target;
    const form =
      element && typeof element.closest === "function"
        ? element.closest("form")
        : element && typeof element.matches === "function" && element.matches("form")
          ? element
          : null;

    if (form && isCartAddPath(form.getAttribute("action"))) return true;

    const actionable =
      element && typeof element.closest === "function"
        ? element.closest("button,input,a,[role='button'],[data-add-to-cart],[data-cart-add],[data-action]")
        : element;

    if (!actionable || typeof actionable.getAttribute !== "function") return false;

    if (isCartAddPath(actionable.getAttribute("href"))) return true;
    if (isCartAddPath(actionable.getAttribute("formaction"))) return true;

    const name = String(actionable.getAttribute("name") || "").trim().toLowerCase();
    if (name === "add" || name === "add-to-cart" || name === "add_to_cart") return true;

    if (
      actionable.matches?.("[data-add-to-cart], [data-cart-add], [data-action='add-to-cart'], [data-action='cart-add'], .add-to-cart, .product-form__submit")
    ) {
      return true;
    }

    return (
      hasAddToCartIntentText(actionable.getAttribute("id")) ||
      hasAddToCartIntentText(actionable.getAttribute("class")) ||
      hasAddToCartIntentText(actionable.getAttribute("aria-label")) ||
      hasAddToCartIntentText(actionable.textContent)
    );
  }


  function isThemeCartDrawerCheckoutIntent(target) {
    const element = target?.target || target;
    if (!element || typeof element.closest !== "function") return false;
    const themeHost = element.closest(
      "cart-drawer, #CartDrawer, #cart-drawer, .cart-drawer, [data-cart-drawer], [data-drawer='cart']"
    );
    if (!themeHost) return false;
    return !element.closest("#loopdesk-cart-drawer-root, [data-loopdesk-cart-drawer]");
  }

  function isExpressCheckoutIntent(target) {
    const element = target?.target || target;
    if (!element || typeof element.closest !== "function") return false;
    return Boolean(
      element.closest("[data-megaska-express-checkout], [data-loopdesk-express-checkout], [data-bag-action='checkout'], .loopdesk-cart-drawer__express")
    );
  }

  function isCheckoutIntent(target) {
    if (isAddToCartIntent(target)) return false;
    if (isThemeCartDrawerCheckoutIntent(target)) return false;
    if (isExpressCheckoutIntent(target)) return true;

    const element = target?.target || target;
    if (!element) return false;
    if (isCheckoutTarget(element)) return true;

    const form = typeof element.closest === "function" ? element.closest("form") : null;
    if (form && isCartAddPath(form.getAttribute("action"))) return false;
    if (form && String(form.getAttribute("action") || "").includes("/checkout")) return true;

    return false;
  }

  function extractVerifiedPhoneFromSession(session) {
    const phoneCandidates = [
      session?.phoneE164,
      session?.customer?.phoneE164,
      session?.profile?.phoneE164,
      session?.customer?.phone,
      session?.profile?.phone,
      session?.raw?.phoneE164,
      session?.raw?.customer?.phoneE164,
      session?.raw?.profile?.phoneE164,
      session?.raw?.customer?.phone,
      session?.raw?.profile?.phone,
    ];

    for (const candidate of phoneCandidates) {
      const normalized = normalizeIndianPhone(candidate);
      if (normalized) return normalized;
    }

    return "";
  }

  function getBestPhoneFieldContainer(triggerEl, form) {
    if (form && typeof form.querySelector === "function") return form;
    if (triggerEl && typeof triggerEl.closest === "function") {
      return (
        triggerEl.closest("form") ||
        triggerEl.closest("[data-cart-drawer], .cart-drawer, .drawer, .cart__footer, .cart, .sticky-cart") ||
        document
      );
    }
    return document;
  }

  function findCheckoutPhoneInput(options) {
    const opts = options || {};
    const container = getBestPhoneFieldContainer(opts.triggerEl, opts.form);
    const selector = CHECKOUT_PHONE_SELECTORS.join(", ");

    const localMatch = container.querySelector(selector);
    if (localMatch) return localMatch;
    return document.querySelector(selector);
  }

  function prefillPhoneFieldIfEmpty(field, verifiedPhone) {
    if (!field || !verifiedPhone) return false;
    if (String(field.value || "").trim()) return false;
    field.value = verifiedPhone;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clearCheckoutErrors() {
    state.errorMessage = "";
    state.statusMessage = "";
    document.querySelectorAll("[data-megaska-checkout-guard-error]").forEach((element) => element.remove());
    if (state.isOpen) renderStep();
  }

  function renderCheckoutGuardError(options) {
    const opts = options || {};
    const message = String(opts.message || "").trim();
    const anchor = opts.anchor || opts.field || document.body;
    const container = anchor.parentElement || document.body;
    const existing = container.querySelector("[data-megaska-checkout-guard-error]");

    if (!message) {
      if (existing) existing.remove();
      return;
    }

    const errorEl = existing || document.createElement("p");
    errorEl.setAttribute("data-megaska-checkout-guard-error", "1");
    errorEl.setAttribute("role", "alert");
    errorEl.style.color = "#d72c0d";
    errorEl.style.fontSize = "13px";
    errorEl.style.marginTop = "8px";
    errorEl.textContent = message;

    if (!existing) {
      container.appendChild(errorEl);
    }
  }

  function clearPendingAction() {
    pendingAction = null;
  }

  function setPendingAction(action) {
    pendingAction = action;
  }

  async function getCurrentMegaskaCustomer() {
    try {
      if (window.MegaskaAuth && typeof window.MegaskaAuth.fetchSession === "function") {
        const session = await window.MegaskaAuth.fetchSession();
        return session?.customer || null;
      }
    } catch (error) {
      console.warn("[Megaska OTP] unable to fetch session for checkout prefill", error);
    }
    return null;
  }

  async function resolveMegaskaCustomer(preferredCustomer) {
    if (preferredCustomer && typeof preferredCustomer === "object") {
      return preferredCustomer;
    }
    return getCurrentMegaskaCustomer();
  }

  async function buildPrefilledCheckoutUrl(rawUrl, preferredCustomer) {
    if (!rawUrl || !rawUrl.includes("/checkout")) return rawUrl;
    const customer = await resolveMegaskaCustomer(preferredCustomer);
    if (!customer) return rawUrl;

    if (
      window.MegaskaAuth &&
      typeof window.MegaskaAuth.applyCheckoutPrefillToUrl === "function"
    ) {
      const prefilledUrl = window.MegaskaAuth.applyCheckoutPrefillToUrl(rawUrl, customer);
      if (prefilledUrl !== rawUrl) {
        console.log("[Megaska OTP] checkout prefill handoff executed", { targetUrl: prefilledUrl });
      }
      return prefilledUrl;
    }

    return rawUrl;
  }

  function isCheckoutSubmitter(element) {
    if (!element || typeof element.matches !== "function") return false;
    if (
      element.matches(
        "button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], button[data-action='checkout'], button[data-action='proceed-to-checkout'], [data-checkout-button], .shopify-payment-button__button, .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout"
      )
    ) {
      return true;
    }

    return (
      hasCheckoutIntentText(element.getAttribute("name")) ||
      hasCheckoutIntentText(element.getAttribute("data-action")) ||
      hasCheckoutIntentText(element.className) ||
      hasCheckoutIntentText(element.id) ||
      hasCheckoutIntentText(element.textContent)
    );
  }

  function mergeCheckoutQueryParams(baseUrl, prefilledUrl) {
    const fallback = prefilledUrl || baseUrl || "";
    if (!baseUrl || !prefilledUrl || !prefilledUrl.includes("?")) return fallback;

    try {
      const base = new URL(baseUrl, window.location.origin);
      const prefilled = new URL(prefilledUrl, window.location.origin);

      prefilled.searchParams.forEach((value, key) => {
        if (!base.searchParams.get(key)) {
          base.searchParams.set(key, value);
        }
      });

      return `${base.pathname}${base.search}${base.hash}`;
    } catch {
      return fallback;
    }
  }

  async function runBuyerIdentityHandoff(rawCheckoutUrl, preferredCustomer) {
    const customer = await resolveMegaskaCustomer(preferredCustomer);
    if (!customer) {
      return {
        ok: false,
        skipped: true,
        reason: "missing-customer",
        checkoutUrl: rawCheckoutUrl,
      };
    }

    if (
      !window.MegaskaAuth ||
      typeof window.MegaskaAuth.applyBuyerIdentityToActiveCart !== "function"
    ) {
      return {
        ok: false,
        skipped: true,
        reason: "missing-auth-bridge",
        checkoutUrl: rawCheckoutUrl,
      };
    }

    console.log("[Megaska Checkout Prefill] waiting for buyer identity update");
    const startedAt = Date.now();

    try {
      const result = await window.MegaskaAuth.applyBuyerIdentityToActiveCart(customer, {
        checkoutUrl: rawCheckoutUrl,
      });
      const mergedCheckoutUrl = mergeCheckoutQueryParams(
        result?.checkoutUrl || rawCheckoutUrl,
        rawCheckoutUrl
      );
      console.log("[Megaska Checkout Prefill] buyer identity update finished", {
        waitedMs: Date.now() - startedAt,
        ok: Boolean(result?.ok),
        skipped: Boolean(result?.skipped),
        reason: result?.reason || "",
        cartId: result?.cartId || null,
        buyerIdentity: result?.buyerIdentity || null,
        checkoutUrl: mergedCheckoutUrl || null,
        userErrors: result?.userErrors || [],
        apiErrors: (result?.apiErrors || []).map((err) => err?.message || err),
      });
      return Object.assign({}, result || {}, {
        checkoutUrl: mergedCheckoutUrl,
      });
    } catch (error) {
      console.error("[Megaska Checkout Prefill] buyer identity update failed", error);
      return {
        ok: false,
        skipped: false,
        reason: "request-failed",
        checkoutUrl: rawCheckoutUrl,
      };
    }
  }

  function isCheckoutContinuationBlocked(handoff) {
    if (!handoff) return false;
    return handoff.blocked || handoff.reason === "missing-verified-phone";
  }

  function buildWalletDiscountTarget(code) {
    const normalizedCode = encodeURIComponent(String(code || "").trim());
    return `/discount/${normalizedCode}?redirect=/cart`;
  }

 async function tryAutoApplyWalletDiscount(handoff) {
  const wallet = handoff?.wallet || null;
  const code = String(wallet?.code || "").trim();
  const reservationId = String(wallet?.reservationId || "").trim();
  const discountNodeId = String(wallet?.discountNodeId || "").trim();

  if (!handoff?.ok || !wallet?.applied || !code || !reservationId || !discountNodeId) {
    return false;
  }

  const target = buildWalletDiscountTarget(code);

  console.log("[WALLET UI] apply success", {
    reservationId,
    code,
    discountNodeId,
  });

  console.log("[WALLET UI] waiting before wallet discount redirect", {
    code,
    target,
  });

  await new Promise((resolve) => setTimeout(resolve, 700));

  console.log("[WALLET UI] redirecting to apply wallet discount", {
    code,
    target,
  });

  window.location.assign(target);
  return true;
}
  async function applyCheckoutPrefillToForm(form, preferredCustomer) {
    const customer = await resolveMegaskaCustomer(preferredCustomer);
    if (!customer) return false;
    if (
      window.MegaskaAuth &&
      typeof window.MegaskaAuth.applyCheckoutPrefillToForm === "function"
    ) {
      const applied = window.MegaskaAuth.applyCheckoutPrefillToForm(form, customer);
      if (applied) {
        console.log("[Megaska OTP] checkout prefill handoff executed", { target: "form" });
      }
      return applied;
    }
    return false;
  }

async function continueToCheckoutFromPendingAction(preferredCustomer, source) {
  const customer = await resolveMegaskaCustomer(preferredCustomer);
  const prefilledUrl = await buildPrefilledCheckoutUrl("/checkout", customer);

  console.log("[Megaska Checkout Prefill] checkout handoff start", {
    source,
    detectedCheckoutUrl: prefilledUrl,
  });

  const handoff = await runBuyerIdentityHandoff(prefilledUrl, customer);

  if (isCheckoutContinuationBlocked(handoff)) {
    console.warn("[Megaska Checkout Gate] continuation stopped after handoff", {
      reason: handoff.reason || "blocked",
    });
    openModal("checkout-gate-blocked");
    return;
  }

  if (await tryAutoApplyWalletDiscount(handoff)) {
    return;
  }

  const targetUrl = handoff?.checkoutUrl || prefilledUrl;

  window.__megaskaCheckoutDebug = {
    cartId: handoff?.cartId || null,
    buyerIdentityPayload: {
      email: String(handoff?.buyerIdentity?.email || "").trim() || null,
      phone: String(handoff?.buyerIdentity?.phone || "").trim() || null,
    },
    mutationResult: handoff || null,
    checkoutUrl: targetUrl || null,
  };

  console.log("[Megaska Checkout Prefill] checkout continuation", {
    mode: "navigate",
    finalCheckoutUrl: targetUrl,
    mutationWaited: true,
    debugSurface: "window.__megaskaCheckoutDebug",
  });

  window.location.assign(targetUrl);
}

function consumePendingAccountRedirect() {
  if (!pendingAction || pendingAction.type !== "account-redirect") {
    return null;
  }

  const target = resolveAccountDestinationUrl(pendingAction.accountDestination);
  clearPendingAction();
  return target;
}
  async function resumePendingAction(preferredCustomer) {
    if (!pendingAction) return;

    const action = pendingAction;
    clearPendingAction();
    console.log("[Megaska OTP] pending intent resumed", { type: action.type });

    if (action.type === "navigate" && action.url) {
      await continueToCheckoutFromPendingAction(
        preferredCustomer,
        "pendingAction.navigate.url"
      );
      return;
    }

    if (action.type === "callback" && typeof action.callback === "function") {
      action.callback();
      return;
    }

    if (action.type === "account-redirect") {
      const redirectTarget = resolveAccountDestinationUrl(action.accountDestination);
      window.location.assign(redirectTarget);
      return;
    }

    if (action.type === "cart-add-submit") {
      const form = action.form;
      if (!form || typeof form.submit !== "function") return;
      console.log("[Megaska OTP] pending cart/add resume", { form });

      try {
        resumingCartAddForms.add(form);
        if (
          action.submitter &&
          typeof action.submitter.click === "function" &&
          document.contains(action.submitter)
        ) {
          action.submitter.click();
        } else {
          form.submit();
        }
      } finally {
        setTimeout(() => {
          resumingCartAddForms.delete(form);
        }, 0);
      }
    }

    if (action.type === "buy-now-submit") {
      const form = action.form;
      if (!form) return;

      console.log("[Megaska OTP] resuming buy-now action", { form });

      const formData = new FormData(form);
      const submitterName = String(action.submitter?.name || "").trim();
      if (submitterName) {
        formData.append(submitterName, String(action.submitter?.value || ""));
      }

      const cartAddPath = `${
        window?.Shopify?.routes?.root || "/"
      }cart/add.js`.replace(/([^:]\/)\/+/g, "$1");

      try {
        const addResponse = await fetch(cartAddPath, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (!addResponse.ok) {
          throw new Error(`cart add failed with status ${addResponse.status}`);
        }

        console.log("[Megaska OTP] buy-now add-to-cart complete");
      } catch (error) {
        console.error("[Megaska OTP] buy-now add-to-cart failed, falling back to form submit", error);
        if (typeof form.submit === "function") {
          form.submit();
        }
        return;
      }

      console.log("[Megaska OTP] buy-now checkout handoff start");
      await continueToCheckoutFromPendingAction(
        preferredCustomer,
        "pendingAction.buy-now-submit"
      );
      console.log("[Megaska OTP] buy-now checkout continuation");
    }
  }

  async function getMegaskaCheckoutGateState() {
    try {
      if (window.MegaskaAuth && typeof window.MegaskaAuth.fetchSession === "function") {
        const session = await window.MegaskaAuth.fetchSession();
        const customer = session?.customer || null;
        const authenticated = Boolean(session?.authenticated);
        const verifiedPhone = extractVerifiedPhoneFromSession(session);
        const verifiedPhonePresent = Boolean(verifiedPhone);
        return {
          authenticated,
          verifiedPhonePresent,
          verifiedPhone,
          session,
          customer,
        };
      }
    } catch (error) {
      console.warn("[Megaska OTP] Session check failed", error);
    }
    return {
      authenticated: false,
      verifiedPhonePresent: false,
      verifiedPhone: "",
      session: null,
      customer: null,
    };
  }

  async function validateCheckoutPhoneMatch(options) {
    const opts = options || {};
    const gateState = await getMegaskaCheckoutGateState();
    const targetPhoneField = findCheckoutPhoneInput({
      triggerEl: opts.triggerEl,
      form: opts.form,
    });

    if (!gateState.authenticated) {
      return {
        ok: false,
        reason: "no-session",
        message: "Please verify your mobile number before checkout.",
        verifiedPhone: "",
        checkoutPhone: "",
        phoneField: targetPhoneField,
      };
    }

    if (!gateState.verifiedPhonePresent || !gateState.verifiedPhone) {
      return {
        ok: false,
        reason: "no-verified-phone",
        message: "Please verify your mobile number before checkout.",
        verifiedPhone: "",
        checkoutPhone: "",
        phoneField: targetPhoneField,
      };
    }

    if (!targetPhoneField) {
      return {
        ok: false,
        reason: "phone-field-missing",
        message: "Please enter your mobile number to continue checkout.",
        verifiedPhone: gateState.verifiedPhone,
        checkoutPhone: "",
      };
    }

    prefillPhoneFieldIfEmpty(targetPhoneField, gateState.verifiedPhone);
    const rawCheckoutPhone = String(targetPhoneField.value || "").trim();
    if (!rawCheckoutPhone) {
      return {
        ok: false,
        reason: "phone-empty",
        message: "Please enter your mobile number to continue checkout.",
        verifiedPhone: gateState.verifiedPhone,
        checkoutPhone: "",
        phoneField: targetPhoneField,
      };
    }

    const normalizedCheckoutPhone = normalizeIndianPhone(rawCheckoutPhone);
    if (!normalizedCheckoutPhone) {
      return {
        ok: false,
        reason: "phone-invalid",
        message: "Please enter a valid Indian mobile number.",
        verifiedPhone: gateState.verifiedPhone,
        checkoutPhone: rawCheckoutPhone,
        phoneField: targetPhoneField,
      };
    }

    if (normalizedCheckoutPhone !== gateState.verifiedPhone) {
      return {
        ok: false,
        reason: "phone-mismatch",
        message: "Please use your verified mobile number for delivery.",
        verifiedPhone: gateState.verifiedPhone,
        checkoutPhone: normalizedCheckoutPhone,
        phoneField: targetPhoneField,
      };
    }

    return {
      ok: true,
      reason: "match",
      message: "",
      verifiedPhone: gateState.verifiedPhone,
      checkoutPhone: normalizedCheckoutPhone,
      phoneField: targetPhoneField,
    };
  }

  async function requireAuthenticationOrOpenModal(options) {
    const opts = options || {};
    const validation = await validateCheckoutPhoneMatch({
      triggerEl: opts.triggerEl,
      form: opts.form,
    });

    if (validation.ok) {
      renderCheckoutGuardError({
        anchor: opts.triggerEl,
        field: validation.phoneField,
        message: "",
      });
      console.log("[Megaska Checkout Gate] allowed", {
        verifiedPhone: validation.verifiedPhone,
        checkoutPhone: validation.checkoutPhone,
      });
      return true;
    }

    hardBlockEvent(opts.event);

    renderCheckoutGuardError({
      anchor: opts.triggerEl,
      field: validation.phoneField,
      message: validation.message,
    });

    if (opts.pendingAction && ["no-session", "no-verified-phone"].includes(validation.reason)) {
      setPendingAction(opts.pendingAction);
    }

    console.log("[Megaska Checkout Gate] blocked", {
      reason: validation.reason,
      verifiedPhone: validation.verifiedPhone,
      checkoutPhone: validation.checkoutPhone,
    });

    if (["no-session", "no-verified-phone"].includes(validation.reason)) {
      try {
        openModal(opts.triggerSource || "auth-required");
      } catch {
        await handlePromptFallback();
      }
    }

    return false;
  }

  function removeAccountMenu() {
    if (!accountMenuContainer) return;
    accountMenuContainer.remove();
    accountMenuContainer = null;
    if (accountMenuTrigger) {
      accountMenuTrigger.setAttribute("aria-expanded", "false");
    }
    accountMenuTrigger = null;
  }

  function closeAccountMenu() {
    removeAccountMenu();
  }

  function closeCartDrawerBeforeModal() {
    const drawers = Array.from(document.querySelectorAll(CART_DRAWER_SELECTORS.join(",")));
    if (!drawers.length) return;

    drawers.forEach((drawer) => {
      try {
        CART_DRAWER_CLOSE_EVENTS.forEach((eventName) => {
          drawer.dispatchEvent(new CustomEvent(eventName, { bubbles: true, cancelable: true }));
          document.dispatchEvent(new CustomEvent(eventName, { bubbles: true, cancelable: true }));
        });

        if (typeof drawer.close === "function") {
          drawer.close();
        }

        const closeTrigger = drawer.querySelector(
          "[data-close], [data-cart-close], [data-drawer-close], .drawer__close, .cart-drawer__close, [aria-label='Close cart'], [aria-label='Close']"
        );

        if (closeTrigger && typeof closeTrigger.click === "function") {
          closeTrigger.click();
        }

        CART_DRAWER_OPEN_CLASSES.forEach((className) => drawer.classList.remove(className));
        drawer.removeAttribute("open");

        if (drawer.getAttribute("aria-hidden") === "false") {
          drawer.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        console.warn("[Megaska OTP] cart drawer close skipped", error);
      }
    });

    document.documentElement.classList.remove("drawer-open", "cart-open", "mini-cart-open", "js-drawer-open");
    document.body.classList.remove("drawer-open", "cart-open", "mini-cart-open", "js-drawer-open");
  }

  function hideAccountMenu() {
    closeAccountMenu();
  }

  function buildAccountMenu() {
    const dashboardUrl = resolveAccountDestinationUrl();
    const menu = document.createElement("div");
    menu.className = "megaska-account-menu-popover";
    menu.setAttribute("data-megaska-account-menu", "1");
    menu.innerHTML = `
      <div class="megaska-account-menu-card">
        <p class="megaska-account-menu-title">You are signed in</p>
        <a href="${dashboardUrl}" class="megaska-account-menu-link" data-megaska-menu-account>My Account</a>
        <button type="button" class="megaska-account-menu-logout" data-megaska-menu-logout>Logout</button>
      </div>
    `;
    return menu;
  }

  async function handleLogoutClick(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    console.log("[Megaska OTP] logout intercepted");

    try {
      if (window.MegaskaAuth && typeof window.MegaskaAuth.logout === "function") {
        await window.MegaskaAuth.logout();
      }
    } catch (error) {
      console.error("[Megaska OTP] logout failed", error);
    }

    if (window.MegaskaAuth && typeof window.MegaskaAuth.refreshAuthState === "function") {
      await window.MegaskaAuth.refreshAuthState();
    }

    syncAccountUiState();
    closeAccountMenu();
  }

  function openAccountMenu(triggerEl) {
    closeAccountMenu();
    const menu = buildAccountMenu();
    const rect = triggerEl.getBoundingClientRect();
    menu.style.top = `${window.scrollY + rect.bottom + 8}px`;
    menu.style.left = `${window.scrollX + Math.max(8, rect.right - 180)}px`;
    menu.querySelector("[data-megaska-menu-account]").addEventListener("click", (event) => {
      event.preventDefault();
    });
    menu.querySelector("[data-megaska-menu-logout]").addEventListener("click", handleLogoutClick);
    document.body.appendChild(menu);
    accountMenuContainer = menu;
    accountMenuTrigger = triggerEl;
    accountMenuTrigger.setAttribute("aria-expanded", "true");
    console.log("[Megaska OTP] authenticated menu opened");
  }

  function isAccountMenuOpen() {
    return Boolean(accountMenuContainer);
  }

  function toggleAccountMenu(triggerEl) {
    if (isAccountMenuOpen()) {
      closeAccountMenu();
      return;
    }
    openAccountMenu(triggerEl);
  }

  async function syncAccountUiState() {
    const gateState = await getMegaskaCheckoutGateState();
    const authenticated = gateState.authenticated;
    document.documentElement.classList.toggle("megaska-account-authenticated", authenticated);
    document.documentElement.classList.toggle("megaska-account-guest", !authenticated);
    if (!authenticated) {
      closeAccountMenu();
    }
    console.log("[Megaska OTP] header sync updated", { authenticated });
    return authenticated;
  }

  function normalizeAccountDestination(rawDestination) {
    const fallbackDestination = DEFAULT_MEGASKA_DASHBOARD_URL;
    const destination = String(rawDestination || "").trim();
    if (!destination) return "";
    if (!destination.startsWith("/") || destination.startsWith("//")) return "";

    let parsedUrl = null;
    try {
      parsedUrl = new URL(destination, window.location.origin);
    } catch {
      return "";
    }

    if (parsedUrl.origin !== window.location.origin) return "";

    const pathname = String(parsedUrl.pathname || "").trim();
    const normalizedPath = pathname.replace(/\/+$/, "") || "/";

    const isNativeShopifyAccountPath = isShopifyNativeAccountPath(normalizedPath);

    if (isNativeShopifyAccountPath) {
      return fallbackDestination;
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  }

  function isShopifyNativeAccountPath(pathname) {
    const normalizedPath = String(pathname || "").trim().replace(/\/+$/, "") || "/";
    return (
      normalizedPath === "/account" ||
      normalizedPath === "/account/login" ||
      normalizedPath === "/account/register"
    );
  }

  
  function isNativeAccountIntentElement(element) {
    if (!element || typeof element.getAttribute !== "function") return false;
    const href = String(element.getAttribute("href") || "").trim();
    if (!href) return false;
    try {
      const url = new URL(href, window.location.origin);
      return url.origin === window.location.origin && isShopifyNativeAccountPath(url.pathname);
    } catch {
      return false;
    }
  }

  function getAccountTriggerActionElement(element) {
    if (!element || typeof element.closest !== "function") return element;
    return element.closest("a,button,[role='button']") || element;
  }

  const LOOPDESK_ACCOUNT_TRIGGER_SELECTOR =
    "[data-megaska-open-login],[data-megaska-fallback-account],#megaska-account-fallback-desktop,#megaska-account-fallback-mobile";

  function isSafeLoopDeskAccountDestination(actionElement) {
    const href = String(actionElement?.getAttribute?.("href") || "").trim();
    if (!href) return true;

    let destinationUrl = null;
    try {
      destinationUrl = new URL(href, window.location.origin);
    } catch {
      return false;
    }
    if (destinationUrl.origin !== window.location.origin) return false;

    const destination = `${destinationUrl.pathname}${destinationUrl.search}${destinationUrl.hash}`;
    const allowedDestinations = new Set([
      DEFAULT_MEGASKA_DASHBOARD_URL,
      resolveAccountDestinationUrl(),
    ]);

    return allowedDestinations.has(destination);
  }

  function isUsableAccountEntryTrigger(element) {
    // The LoopD2C dashboard's own buttons must never be tagged as account
    // entries (its "Order details" button matches [class*='account-link']).
    if (element && typeof element.closest === "function" && element.closest("[data-loopdesk-customer-dashboard]")) {
      return false;
    }
    const actionElement = getAccountTriggerActionElement(element);
    if (!actionElement || typeof actionElement.getAttribute !== "function") return false;
    if (actionElement.closest && actionElement.closest("[data-loopdesk-customer-dashboard]")) return false;
    if (actionElement.hasAttribute("disabled") || actionElement.getAttribute("aria-disabled") === "true") {
      return false;
    }

    const isLoopDeskOwned = Boolean(
      actionElement.matches?.(LOOPDESK_ACCOUNT_TRIGGER_SELECTOR) ||
        element?.matches?.(LOOPDESK_ACCOUNT_TRIGGER_SELECTOR)
    );
    if (isLoopDeskOwned) {
      return Boolean(
        actionElement.matches?.("a,button,[role='button']") &&
          isSafeLoopDeskAccountDestination(actionElement)
      );
    }

    const href = String(actionElement.getAttribute("href") || "").trim();
    if (href) return isNativeAccountIntentElement(actionElement);

    return Boolean(
      actionElement.matches?.(
        "[data-megaska-open-login],[data-account-link],[data-customer-login],button,[role='button']"
      ) ||
        element.matches?.(ACCOUNT_TRIGGER_SELECTORS.join(",")) ||
        (accountIconGlyphText(actionElement) + " " + accountIconGlyphText(element)).includes("account")
    );
  }

  function resolveAccountDestinationUrl(source) {
    const preferredDestination =
      typeof source === "string"
        ? source
        : source?.getAttribute?.("data-megaska-account-destination") ||
          source?.getAttribute?.("data-account-destination") ||
          "";

    const configDestination = String(
      window?.LoopDeskCustomerDashboardConfig?.themePagePath ||
        window?.LOOPDESK_CUSTOMER_DASHBOARD_CONFIG?.themePagePath ||
        window?.LoopDeskCustomerDashboardConfig?.dashboardPath ||
        window?.LOOPDESK_CUSTOMER_DASHBOARD_CONFIG?.dashboardPath ||
        ""
    ).trim();
    const merchantConfigDestination = String(window?.LoopDeskConfig?.account?.dashboardPath || "").trim();
    const windowDestination = String(window?.MEGASKA_ACCOUNT_DASHBOARD_URL || "").trim();
    const htmlDestination = String(
      document?.documentElement?.getAttribute?.("data-megaska-account-destination") || ""
    ).trim();
    const bodyDestination = String(
      document?.body?.getAttribute?.("data-megaska-account-destination") || ""
    ).trim();

    return (
      normalizeAccountDestination(preferredDestination) ||
      normalizeAccountDestination(configDestination) ||
      normalizeAccountDestination(merchantConfigDestination) ||
      normalizeAccountDestination(windowDestination) ||
      normalizeAccountDestination(htmlDestination) ||
      normalizeAccountDestination(bodyDestination) ||
      DEFAULT_MEGASKA_DASHBOARD_URL
    );
  }

 async function handleAccountTriggerClick(event, triggerEl) {
  hardBlockEvent(event);

  const gateState = await getMegaskaCheckoutGateState();
  const accountDestination = resolveAccountDestinationUrl(triggerEl);

  const authenticated =
    Boolean(gateState?.authenticated) &&
    Boolean(gateState?.verifiedPhonePresent);

  if (!authenticated) {
    setPendingAction({
      type: "account-redirect",
      accountDestination,
      createdAt: Date.now(),
    });

    try {
      openModal("account-intercept");
    } catch {
      await handlePromptFallback();
    }

    console.log("[Megaska OTP] account trigger intercepted", {
      authenticated: false,
      accountDestination,
    });
    return;
  }

  hideAccountMenu();

  console.log("[Megaska OTP] account trigger intercepted", {
    authenticated: true,
    accountDestination,
  });

  window.location.assign(accountDestination);
}
  async function ensureMegaskaAuthenticatedBeforeCheckout(options) {
  const opts = options || {};
  const pending =
    opts.pendingAction ||
    (opts.targetUrl ? { type: "navigate", url: opts.targetUrl } : null);

  return requireAuthenticationOrOpenModal({
    event: opts.event,
    pendingAction: pending,
    triggerSource: "checkout-intercept",
    triggerEl: opts.triggerEl,
    form: opts.form,
  });
}

 async function handleCheckoutTriggerClick(event, triggerEl) {
  if (!checkoutInterceptionEnabled) return;

  const targetUrl =
    triggerEl?.tagName === "A" ? triggerEl.getAttribute("href") : "/checkout";

  const allowed = await ensureMegaskaAuthenticatedBeforeCheckout({
    event,
    targetUrl,
    triggerEl,
  });

  if (!allowed) {
    console.log("[Megaska OTP] checkout click intercepted", { targetUrl });
    return;
  }

  const isAnchorCheckoutTrigger = triggerEl?.tagName === "A" && Boolean(targetUrl);

  if (isAnchorCheckoutTrigger) {
    event.preventDefault();

    const customer = await getCurrentMegaskaCustomer();
    const prefilledUrl = await buildPrefilledCheckoutUrl(targetUrl, customer);

    console.log("[Megaska Checkout Prefill] checkout handoff start", {
      source: "interceptedCheckoutAnchor.href",
      detectedCheckoutUrl: prefilledUrl,
    });

    const handoff = await runBuyerIdentityHandoff(prefilledUrl, customer);

    if (isCheckoutContinuationBlocked(handoff)) {
      console.warn("[Megaska Checkout Gate] continuation stopped after handoff", {
        reason: handoff.reason || "blocked",
      });
      openModal("checkout-gate-blocked");
      return;
    }

    if (await tryAutoApplyWalletDiscount(handoff)) {
      return;
    }

    const finalTargetUrl = handoff?.checkoutUrl || prefilledUrl;

    window.__megaskaCheckoutDebug = {
      cartId: handoff?.cartId || null,
      buyerIdentityPayload: {
        email: String(handoff?.buyerIdentity?.email || "").trim() || null,
        phone: String(handoff?.buyerIdentity?.phone || "").trim() || null,
      },
      mutationResult: handoff || null,
      checkoutUrl: finalTargetUrl || null,
    };

    console.log("[Megaska Checkout Prefill] checkout continuation", {
      mode: "click",
      finalCheckoutUrl: finalTargetUrl,
      mutationWaited: true,
      debugSurface: "window.__megaskaCheckoutDebug",
    });

    window.location.assign(finalTargetUrl);
    return;
  }

  const checkoutForm =
    triggerEl && typeof triggerEl.closest === "function"
      ? triggerEl.closest("form")
      : null;

  if (checkoutForm) {
    event.preventDefault();

    const customer = await getCurrentMegaskaCustomer();
    await applyCheckoutPrefillToForm(checkoutForm, customer);

    const submittedAction = checkoutForm.getAttribute("action") || "/checkout";
    const prefilledUrl = await buildPrefilledCheckoutUrl("/checkout", customer);
    const handoff = await runBuyerIdentityHandoff(prefilledUrl, customer);

    if (isCheckoutContinuationBlocked(handoff)) {
      console.warn("[Megaska Checkout Gate] continuation stopped after handoff", {
        reason: handoff.reason || "blocked",
      });
      renderCheckoutGuardError({
        anchor: checkoutForm,
        message: "Please verify your mobile number before checkout.",
      });
      openModal("checkout-gate-blocked");
      return;
    }

    if (await tryAutoApplyWalletDiscount(handoff)) {
      return;
    }

    const finalTargetUrl = handoff?.checkoutUrl || prefilledUrl || submittedAction;

    console.log("[Megaska Checkout Prefill] checkout continuation", {
      mode: "click-form-redirect",
      formAction: submittedAction,
      finalCheckoutUrl: finalTargetUrl,
      prefillApplied: true,
    });

    window.location.assign(finalTargetUrl);
  }
	}

  function bindGlobalClickInterceptor() {
    if (globalClickBound) return;
    globalClickBound = true;

    document.addEventListener(
      "click",
      async (event) => {
        const logoutTrigger = findClosestMatchingElement(event, LOGOUT_TRIGGER_SELECTORS);
        if (logoutTrigger) {
          await handleLogoutClick(event);
          return;
        }

        const accountTrigger = isAccountDashboardRedirectEnabled() ? findAccountTrigger(event) : null;
        if (accountTrigger && isUsableAccountEntryTrigger(accountTrigger)) {
          await handleAccountTriggerClick(event, getAccountTriggerActionElement(accountTrigger));
          return;
        }

        if (isAddToCartIntent(event.target)) {
          return;
        }

        const checkoutTrigger = inferCheckoutTriggerFromEvent(event);
        if (checkoutTrigger && isCheckoutIntent(checkoutTrigger)) {
          await handleCheckoutTriggerClick(event, checkoutTrigger);
          return;
        }

        if (!isAccountMenuOpen()) return;
        const clickedInsideMenu =
          accountMenuContainer && typeof accountMenuContainer.contains === "function"
            ? accountMenuContainer.contains(event.target)
            : false;
        const clickedTrigger =
          accountMenuTrigger && typeof accountMenuTrigger.contains === "function"
            ? accountMenuTrigger.contains(event.target)
            : false;
        if (!clickedInsideMenu && !clickedTrigger) {
          closeAccountMenu();
        }
      },
      true
    );
  }

  function bindCheckoutSubmitInterceptor() {
  if (checkoutSubmitBound) return;
  checkoutSubmitBound = true;

  document.addEventListener(
    "submit",
    async (event) => {
      if (!checkoutInterceptionEnabled) return;

      const form = event.target;
      if (!form || !form.matches || !form.matches("form")) return;

      const action = form.getAttribute("action") || "";
      if (isCartAddPath(action) || isAddToCartIntent(form)) return;

      const submitter = event.submitter;
      const fallbackSubmitter =
        form.querySelector(
          "button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], [data-checkout-button], .shopify-payment-button__button, .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout"
        ) || submitter;

      const checkoutIntent =
        action.includes("/checkout") ||
        isCheckoutSubmitter(submitter) ||
        isCheckoutSubmitter(fallbackSubmitter);

      if (!checkoutIntent) return;

      const allowed = await ensureMegaskaAuthenticatedBeforeCheckout({
        event,
        pendingAction: {
          type: "navigate",
          url: "/checkout",
        },
        triggerEl:
          submitter ||
          form.querySelector(
            "button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], [data-checkout-button], .shopify-payment-button__button, .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout"
          ),
        form,
      });

      if (!allowed) {
        console.log("[Megaska OTP] checkout submit intercepted");
        return;
      }

      event.preventDefault();

      const customer = await getCurrentMegaskaCustomer();
      await applyCheckoutPrefillToForm(form, customer);

      const submittedAction = form.getAttribute("action") || "/checkout";
      const prefilledUrl = await buildPrefilledCheckoutUrl(submittedAction, customer);
      const handoff = await runBuyerIdentityHandoff(prefilledUrl, customer);

      if (isCheckoutContinuationBlocked(handoff)) {
        console.warn("[Megaska Checkout Gate] continuation stopped after handoff", {
          reason: handoff.reason || "blocked",
        });
        renderCheckoutGuardError({
          anchor: form,
          message: "Please verify your mobile number before checkout.",
        });
        openModal("checkout-gate-blocked");
        return;
      }

      if (await tryAutoApplyWalletDiscount(handoff)) {
        return;
      }

      const finalTargetUrl = handoff?.checkoutUrl || prefilledUrl || submittedAction;

      console.log("[Megaska Checkout Prefill] checkout continuation", {
        mode: "form-redirect",
        finalCheckoutUrl: finalTargetUrl,
        mutationWaited: true,
        debugSurface: "window.__megaskaCheckoutDebug",
      });

      window.location.assign(finalTargetUrl);
    },
    true
  );
}
  function bindSubmitDebugListener() {
    if (submitDebugBound) return;
    submitDebugBound = true;

    document.addEventListener("submit", (event) => {
      const form =
        event && event.target && typeof event.target.matches === "function" && event.target.matches("form")
          ? event.target
          : null;
      if (!form) return;

      console.log("[SUBMIT]", form, {
        action: form.getAttribute("action") || "",
        method: form.getAttribute("method") || "",
        id: form.id || "",
        className: form.className || "",
      });
    }, true);
  }

  function logPaymentButtonsPresence() {
    if (paymentButtonsLogged) return;
    paymentButtonsLogged = true;

    const selectors = [
      ".shopify-payment-button",
      ".shopify-payment-button__button",
      ".shopify-payment-button__more-options",
      "[data-shopify='payment-button']",
    ];
    const found = {};

    selectors.forEach((selector) => {
      found[selector] = Boolean(
        document && typeof document.querySelector === "function" && document.querySelector(selector)
      );
    });

    console.log("[PAYMENT BUTTONS FOUND]", found);
  }

  function isInMobileContext(element) {
    if (!element || typeof element.closest !== "function") return false;
    return Boolean(element.closest(MOBILE_CONTEXT_SELECTORS.join(",")));
  }

  function hasNativeAccountEntry(options) {
    const opts = options || {};
    const isMobile = Boolean(opts.mobile);
    const triggers = Array.from(
      document.querySelectorAll(
        ACCOUNT_TRIGGER_SELECTORS.map((selector) => `${selector}:not([data-megaska-fallback-account])`).join(",")
      )
    );

    return triggers.some((el) => isMobile ? isInMobileContext(el) : !isInMobileContext(el));
  }

  function isElementActuallyVisible(element) {
    if (!element) return false;
    let current = element;
    while (current && current.nodeType === 1) {
      if (("hidden" in current && current.hidden) || current.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
      current = current.parentElement;
    }
    return true;
  }

  function isInMobileMenuContainer(element) {
    if (!element || typeof element.closest !== "function") return false;
    return MOBILE_ACCOUNT_CONTAINER_SELECTORS.some((selector) => {
      try {
        return Boolean(element.closest(selector));
      } catch (_error) {
        return false;
      }
    });
  }

  function hasVisibleNativeMobileMenuAccountEntry() {
    const triggers = Array.from(
      document.querySelectorAll(
        ACCOUNT_TRIGGER_SELECTORS.map((selector) => `${selector}:not([data-megaska-fallback-account])`).join(",")
      )
    );

    return triggers.some(
      (el) =>
        isInMobileContext(el) &&
        isInMobileMenuContainer(el) &&
        isElementActuallyVisible(getAccountTriggerActionElement(el)) &&
        isUsableAccountEntryTrigger(el)
    );
  }

  function normalizeNativeAccountTriggers() {
    const candidates = document.querySelectorAll(
      NATIVE_DESKTOP_ACCOUNT_SELECTORS
        .map((selector) => `${selector}:not([data-megaska-fallback-account])`)
        .join(",")
    );

    candidates.forEach((el) => {
      if (!el || typeof el.setAttribute !== "function") return;
      el.setAttribute("data-megaska-open-login", "1");
      el.setAttribute("data-megaska-native-account", "1");
      if ("hidden" in el && el.hidden) {
        el.hidden = false;
      }
      const authWrapper =
        typeof el.closest === "function" ? el.closest("[data-megaska-auth-user]") : null;
      if (authWrapper && "hidden" in authWrapper && authWrapper.hidden) {
        authWrapper.hidden = false;
      }
    });
  }

  function hasNativeDesktopAccountEntry() {
    const desktopCandidates = Array.from(
      document.querySelectorAll(
        NATIVE_DESKTOP_ACCOUNT_SELECTORS
          .map((selector) => `${selector}:not([data-megaska-fallback-account])`)
          .join(",")
      )
    );

    return desktopCandidates.some((el) => !isInMobileContext(el));
  }

  function getStructuralAccountContainer() {
    for (const kind of ["cart", "search"]) {
      for (const selector of HEADER_ICON_REFERENCE_SELECTORS[kind]) {
        for (const candidate of document.querySelectorAll(selector)) {
          if (isInMobileContext(candidate)) continue;
          const action = getAccountTriggerActionElement(candidate);
          const parent = action?.parentElement;
          if (parent) return parent;
        }
      }
    }
    return null;
  }

  function getDesktopAccountContainer() {
    for (const selector of DESKTOP_ACCOUNT_CONTAINER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    return getStructuralAccountContainer();
  }

  function getMobileAccountContainer() {
    for (const selector of MOBILE_ACCOUNT_CONTAINER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    return null;
  }

  const UNSAFE_THEME_CLASS_PATTERN = /(^|[-_])(cart|bag|search|badge|count|bubble|drawer|modal|popup|active|open|loading|avatar|customer-avatar)([-_]|$)|(^|[-_])(js|no-js)([-_]|$)/i;
  const SAFE_THEME_CLASS_PATTERN = /(^|[-_])(header|site-header|icon|control|action|link|focus|visually-hidden)([-_]|$)/i;

  function safeThemeClasses(element, options) {
    const opts = options || {};
    const classes = Array.from(element?.classList || []).filter(
      (className) => SAFE_THEME_CLASS_PATTERN.test(className) && !UNSAFE_THEME_CLASS_PATTERN.test(className)
    );
    if (opts.account && classes.includes("header__icon") && !classes.includes("header__icon--account")) {
      classes.push("header__icon--account");
    }
    if (opts.svg && classes.includes("icon") && !classes.includes("icon-account")) {
      classes.push("icon-account");
    }
    return [...new Set(classes)];
  }

  function sanitizeThemeOwnedAccountClone(source, dashboardUrl) {
    const action = getAccountTriggerActionElement(source);
    if (!action?.matches?.("a")) return null;
    const clone = action.cloneNode(true);
    clone.querySelectorAll("script, style, template, form, a, button, input, select, textarea, [class*='avatar' i], [data-customer-avatar], img, [role='menu'], [role='menuitem']").forEach((node) => node.remove());
    [clone, ...clone.querySelectorAll("*")].forEach((node) => {
      node.removeAttribute("id");
      node.removeAttribute("aria-expanded");
      node.removeAttribute("aria-controls");
      node.removeAttribute("aria-haspopup");
      node.removeAttribute("hidden");
      node.removeAttribute("style");
      if (node === clone) node.removeAttribute("aria-hidden");
      Array.from(node.attributes || []).forEach((attribute) => {
        if (/^on/i.test(attribute.name) || attribute.name.startsWith("data-") || attribute.name === "href") {
          node.removeAttribute(attribute.name);
        }
      });
      const safeClasses = safeThemeClasses(node, {
        account: node === clone,
        svg: String(node.tagName || "").toLowerCase() === "svg",
      });
      if (safeClasses.length) node.setAttribute("class", safeClasses.join(" "));
      else node.removeAttribute("class");
    });
    clone.querySelectorAll("title").forEach((node) => node.remove());
    clone.querySelectorAll("svg").forEach((svg) => {
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.removeAttribute("aria-label");
      svg.removeAttribute("role");
    });
    if (!clone.querySelector("svg")) return null;
    clone.id = ACCOUNT_FALLBACK_DESKTOP_ID;
    clone.href = dashboardUrl;
    clone.setAttribute("data-megaska-open-login", "1");
    clone.setAttribute("data-megaska-fallback-account", "desktop");
    clone.setAttribute("data-loopdesk-account-control-source", "native-hidden-clone");
    clone.setAttribute("aria-label", "My account");
    return clone;
  }

  function findHiddenThemeAccountControl(container) {
    const header = container?.closest("header") || document.querySelector("header");
    if (!header) return null;
    const candidates = header.querySelectorAll(
      NATIVE_DESKTOP_ACCOUNT_SELECTORS.map((selector) => `${selector}:not([data-megaska-fallback-account])`).join(",")
    );
    for (const candidate of candidates) {
      const action = getAccountTriggerActionElement(candidate);
      if (!isInMobileContext(action) && !isElementActuallyVisible(action) && action?.matches?.("a") && action.querySelector("svg")) {
        return action;
      }
    }
    return null;
  }

  function findStructuralReference(container) {
    if (!container) return null;
    for (const kind of ["search", "cart"]) {
      for (const selector of HEADER_ICON_REFERENCE_SELECTORS[kind]) {
        for (const candidate of container.querySelectorAll(selector)) {
          const action = getAccountTriggerActionElement(candidate);
          if (!action?.matches?.("a,button") || action.closest("[data-megaska-fallback-account]")) continue;
          const classes = safeThemeClasses(action, { account: true });
          const svg = action.querySelector("svg");
          if (classes.length && svg) return { kind, action, svg, classes };
        }
      }
    }
    return null;
  }

  function createLoopDeskAccountSvg(referenceSvg) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    const svgClasses = safeThemeClasses(referenceSvg, { svg: true });
    if (svgClasses.length) svg.setAttribute("class", svgClasses.join(" "));
    else {
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
    }
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.innerHTML = '<circle cx="12" cy="7.5" r="3.25"></circle><path d="M5.5 20c.55-4.2 2.75-6.25 6.5-6.25S17.95 15.8 18.5 20"></path>';
    return svg;
  }

  // Merchant account-icon customization (admin: Account dashboard → Account icon
  // appearance). style "auto" keeps the theme-adaptive icon; a preset or a
  // sanitized custom SVG overrides the glyph; size (px) overrides the auto
  // sizing. Values are seeded onto window.LoopDeskConfig.account by the runtime
  // config, and re-applied when that config arrives after first injection.
  const MERCHANT_ICON_PRESETS = ["outline", "filled", "circle", "custom"];
  function getAccountIconConfig() {
    const account = (window.LoopDeskConfig && window.LoopDeskConfig.account) || {};
    const rawStyle = typeof account.iconStyle === "string" ? account.iconStyle.trim().toLowerCase() : "";
    const style = MERCHANT_ICON_PRESETS.includes(rawStyle) ? rawStyle : "auto";
    const rawSize = Number(account.iconSize);
    const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(40, Math.max(16, Math.round(rawSize))) : 0;
    const customSvg = typeof account.iconCustomSvg === "string" ? account.iconCustomSvg : "";
    return { style, size, customSvg };
  }

  function createPresetAccountSvg(style) {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (style === "filled") {
      svg.setAttribute("fill", "currentColor");
      svg.innerHTML = '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"></path>';
      return svg;
    }
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (style === "circle") {
      svg.innerHTML = '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="10" r="2.75"></circle><path d="M6.8 18.2c1-2.3 2.9-3.2 5.2-3.2s4.2.9 5.2 3.2"></path>';
    } else {
      svg.innerHTML = '<circle cx="12" cy="7.5" r="3.25"></circle><path d="M5.5 20c.55-4.2 2.75-6.25 6.5-6.25S17.95 15.8 18.5 20"></path>';
    }
    return svg;
  }

  // Strict allowlist sanitizer for a merchant-supplied SVG. This is the
  // authoritative gate at the injection point (the admin also blocklists on
  // save). Anything outside the geometry/presentation allowlist is dropped.
  const CUSTOM_SVG_ALLOWED_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
  const CUSTOM_SVG_ALLOWED_ATTRS = new Set([
    "viewbox", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2",
    "width", "height", "points", "fill", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "fill-rule", "clip-rule", "transform",
    "opacity", "fill-opacity", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "xmlns",
  ]);
  function sanitizeCustomAccountSvg(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 12000 || !/^<svg[\s>]/i.test(trimmed)) return null;
    if (typeof DOMParser !== "function") return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(trimmed, "image/svg+xml");
    } catch (_error) {
      return null;
    }
    if (!doc || (doc.getElementsByTagName && doc.getElementsByTagName("parsererror").length)) return null;
    const root = doc.documentElement;
    if (!root || String(root.nodeName).toLowerCase() !== "svg") return null;
    const scrub = (element) => {
      Array.from(element.attributes || []).forEach((attribute) => {
        const name = String(attribute.name).toLowerCase();
        const value = String(attribute.value || "");
        const unsafe =
          !CUSTOM_SVG_ALLOWED_ATTRS.has(name) ||
          name.startsWith("on") ||
          name.startsWith("xlink") ||
          /javascript:|url\s*\(|expression\s*\(|[<>]/i.test(value);
        if (unsafe) element.removeAttribute(attribute.name);
      });
      Array.from(element.children || []).forEach((child) => {
        if (!CUSTOM_SVG_ALLOWED_TAGS.has(String(child.nodeName).toLowerCase())) {
          child.remove();
          return;
        }
        scrub(child);
      });
    };
    scrub(root);
    if (!root.querySelector("path,circle,ellipse,rect,line,polyline,polygon")) return null;
    let imported;
    try {
      imported = document.importNode(root, true);
    } catch (_error) {
      return null;
    }
    imported.setAttribute("aria-hidden", "true");
    imported.setAttribute("focusable", "false");
    return imported;
  }

  function accountIconSignature(config) {
    return config.style + "|" + config.size + "|" + (config.style === "custom" ? String(config.customSvg).length : "0");
  }

  function applyMerchantAccountIcon(link) {
    if (!link || typeof link.querySelector !== "function") return;
    const config = getAccountIconConfig();
    const signature = accountIconSignature(config);
    if (link.getAttribute("data-loopdesk-icon-signature") === signature) return;
    link.setAttribute("data-loopdesk-icon-signature", signature);

    const existing = link.querySelector("svg");
    let iconSvg = existing;
    if (config.style !== "auto") {
      const built = config.style === "custom"
        ? sanitizeCustomAccountSvg(config.customSvg)
        : createPresetAccountSvg(config.style);
      if (built) {
        if (existing && existing.getAttribute("class")) {
          built.setAttribute("class", existing.getAttribute("class"));
        }
        built.setAttribute("aria-hidden", "true");
        built.setAttribute("focusable", "false");
        if (existing && existing.parentNode) {
          existing.parentNode.replaceChild(built, existing);
        } else {
          link.appendChild(built);
        }
        iconSvg = built;
        link.setAttribute(
          "data-loopdesk-account-icon-source",
          config.style === "custom" ? "merchant-custom" : "merchant-preset",
        );
      }
    }

    if (config.size > 0) {
      link.style.setProperty("--loopdesk-account-icon-size", config.size + "px");
      link.style.setProperty("--loopdesk-account-control-size", (config.size + 14) + "px");
      if (iconSvg && iconSvg.style) {
        iconSvg.style.width = config.size + "px";
        iconSvg.style.height = config.size + "px";
      }
    }
  }

  function createDesktopAccountFallback(container) {
    const dashboardUrl = resolveAccountDestinationUrl();
    const hiddenAccount = findHiddenThemeAccountControl(container);
    const hiddenClone = hiddenAccount && sanitizeThemeOwnedAccountClone(hiddenAccount, dashboardUrl);
    if (hiddenClone) return hiddenClone;

    const reference = findStructuralReference(container);
    const link = document.createElement("a");
    link.id = ACCOUNT_FALLBACK_DESKTOP_ID;
    link.href = dashboardUrl;
    link.setAttribute("data-megaska-open-login", "1");
    link.setAttribute("data-megaska-fallback-account", "desktop");
    link.setAttribute("aria-label", "My account");

    if (reference) {
      link.className = reference.classes.join(" ");
      link.setAttribute("data-loopdesk-account-control-source", `reference-${reference.kind}`);
      const accountSvg = createLoopDeskAccountSvg(reference.svg);
      const referenceWrapper = reference.svg.parentElement;
      const usesSafeSvgWrapper = referenceWrapper?.matches?.("span") &&
        referenceWrapper.classList.contains("svg-wrapper");
      if (usesSafeSvgWrapper) {
        const wrapper = document.createElement("span");
        wrapper.className = "svg-wrapper";
        wrapper.appendChild(accountSvg);
        link.appendChild(wrapper);
      } else {
        link.appendChild(accountSvg);
      }
      link.setAttribute("data-loopdesk-account-icon-source", "loopdesk-brand");
      return link;
    }

    link.className = "megaska-account-fallback megaska-account-fallback--desktop";
    link.setAttribute("data-loopdesk-account-control-source", "loopdesk-default");
    link.setAttribute("data-loopdesk-account-icon-source", "loopdesk-default");
    link.innerHTML =
      '<span class="megaska-account-fallback__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true"><circle cx="12" cy="8" r="3.25"></circle><path d="M5.75 19c.45-3.65 2.55-5.5 6.25-5.5s5.8 1.85 6.25 5.5"></path></svg></span><span class="megaska-visually-hidden">My account</span>';
    return link;
  }

  function createMobileAccountFallback() {
    const dashboardUrl = resolveAccountDestinationUrl();
    const item = document.createElement("li");
    item.id = ACCOUNT_FALLBACK_MOBILE_ID;
    item.className = "megaska-account-fallback-item";
    item.setAttribute("data-megaska-fallback-account", "mobile");
    item.innerHTML =
      `<a href="${dashboardUrl}" class="megaska-account-fallback megaska-account-fallback--mobile megaska-mobile-account-link" data-megaska-open-login="1" aria-label="My account"><span class="megaska-account-fallback__label">My Account</span></a>`;
    return item;
  }

  function insertMobileFallbackInMenu(container, fallback) {
    if (!container || !fallback) return;
    const firstVisibleItem = Array.from(container.children || []).find(
      (child) =>
        child &&
        child.nodeType === 1 &&
        !child.hasAttribute("hidden") &&
        !child.classList.contains("dn")
    );

    if (firstVisibleItem) {
      container.insertBefore(fallback, firstVisibleItem);
      return;
    }

    container.appendChild(fallback);
  }

function ensureAccountEntryFallbacks() {
  const nativeDesktopEntry = hasVisibleNativeDesktopAccountEntry();
  const existingDesktopFallback = document.getElementById(ACCOUNT_FALLBACK_DESKTOP_ID);
  if (nativeDesktopEntry) {
    existingDesktopFallback?.closest(".megaska-account-fallback-item")?.remove();
    if (existingDesktopFallback?.isConnected) existingDesktopFallback.remove();
  } else {
    ensureDesktopAccountFallback();
  }

  // Track whether a dedicated mobile account entry exists (a native menu link
  // or our injected menu item). Themes with a separate mobile menu get that
  // entry, and the desktop header icon is hidden on mobile to avoid a
  // duplicate. Themes whose header icon row is shared across breakpoints (no
  // matching mobile menu container, e.g. custom mk-header layouts) have no
  // separate entry, so the injected header icon must stay visible on mobile
  // instead of being suppressed by the small-viewport hide rule.
  let hasMobileAccountEntry = false;
  if (!hasVisibleNativeMobileMenuAccountEntry()) {
    const mobileContainer = getMobileAccountContainer();
    if (mobileContainer) {
      if (!document.getElementById(ACCOUNT_FALLBACK_MOBILE_ID)) {
        insertMobileFallbackInMenu(mobileContainer, createMobileAccountFallback());
        console.log("[Megaska OTP] mobile account fallback inserted");
      }
      hasMobileAccountEntry = true;
    }
  } else {
    const existingMobileFallback = document.getElementById(ACCOUNT_FALLBACK_MOBILE_ID);
    if (existingMobileFallback) {
      existingMobileFallback.remove();
    }
    hasMobileAccountEntry = true;
  }

  document.documentElement.classList.toggle(
    "loopdesk-has-mobile-account-entry",
    hasMobileAccountEntry,
  );
}

function ensureDesktopAccountFallback() {
  const desktopContainer = getDesktopAccountContainer();
  if (!desktopContainer) return;
  const existingFallback = document.getElementById(ACCOUNT_FALLBACK_DESKTOP_ID);
  if (existingFallback) {
    if (!desktopContainer.contains(existingFallback)) {
      existingFallback.closest(".megaska-account-fallback-item")?.remove();
      if (existingFallback.isConnected) existingFallback.remove();
      ensureDesktopAccountFallback();
      return;
    }
    // Re-apply in case the merchant icon config arrived after first injection
    // (runtime config is fetched asynchronously). The signature guard makes
    // this a no-op once the current config is already reflected.
    applyMerchantAccountIcon(existingFallback);
    return;
  }

  const fallback = createDesktopAccountFallback(desktopContainer);
  applyMerchantAccountIcon(fallback);
  const containerTag = String(desktopContainer.tagName || "").toUpperCase();

  const cartCandidate = desktopContainer.querySelector(
    "a[href='/cart'], a[href*='/cart'], .cart-icon, .icon-cart, .js_car_tt, [aria-label*='cart' i], [aria-label*='bag' i]"
  );

  if (containerTag === "UL" || containerTag === "OL") {
    const li = document.createElement("li");
    li.className = "megaska-account-fallback-item";
    li.appendChild(fallback);

    if (cartCandidate && cartCandidate.parentElement === desktopContainer) {
      desktopContainer.insertBefore(li, cartCandidate);
    } else if (cartCandidate && cartCandidate.closest("li")?.parentElement === desktopContainer) {
      desktopContainer.insertBefore(li, cartCandidate.closest("li"));
    } else {
      desktopContainer.appendChild(li);
    }
  } else {
    if (cartCandidate && cartCandidate.parentElement === desktopContainer) {
      desktopContainer.insertBefore(fallback, cartCandidate);
    } else {
      desktopContainer.appendChild(fallback);
    }
  }

  console.log("[Megaska OTP] desktop account fallback inserted");
}

function observeDesktopAccountContainer() {
  scheduleAccountFallbackReconciliation();
}

function bindAccountFallbackObserver() {
  if (accountFallbackObserverBound) return;
  accountFallbackObserverBound = true;
  if (typeof MutationObserver !== "function") return;

  accountFallbackObserver = new MutationObserver(() => {
    if (hasVisibleNativeDesktopAccountEntry()) {
      const fallback = document.getElementById(ACCOUNT_FALLBACK_DESKTOP_ID);
      fallback?.closest(".megaska-account-fallback-item")?.remove();
      if (fallback?.isConnected) fallback.remove();
    }
    scheduleAccountFallbackReconciliation();
  });
  accountFallbackObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"],
  });
}

function scheduleAccountFallbackReconciliation() {
  if (!accountFallbackDiscoveryStartedAt) accountFallbackDiscoveryStartedAt = Date.now();
  if (accountFallbackTimer) window.clearTimeout(accountFallbackTimer);

  const elapsed = Date.now() - accountFallbackDiscoveryStartedAt;
  const delay = Math.max(0, ACCOUNT_FALLBACK_DISCOVERY_DELAY_MS - elapsed);
  accountFallbackTimer = window.setTimeout(() => {
    accountFallbackTimer = null;
    ensureAccountEntryFallbacks();
  }, delay);
}

  function bindAuthStateSync() {
    document.addEventListener("megaska:auth-state-changed", () => {
      syncAccountUiState();
    });

    window.addEventListener("storage", (event) => {
      if (event.key === "megaska_session_token") {
        syncAccountUiState();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!isAccountMenuOpen()) return;
      closeAccountMenu();
    });
  }

  function bindCheckoutSubmitInterceptor() {
    if (checkoutSubmitBound) return;
    checkoutSubmitBound = true;

    document.addEventListener("submit", async (event) => {
      if (!checkoutInterceptionEnabled) return;
      const form = event.target;
      if (!form || !form.matches || !form.matches("form")) return;

      const action = form.getAttribute("action") || "";
      if (isCartAddPath(action) || isAddToCartIntent(form)) return;

      const submitter = event.submitter;
      const fallbackSubmitter =
        form.querySelector("button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], [data-checkout-button], .shopify-payment-button__button, .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout") ||
        submitter;
      const checkoutIntent =
        action.includes("/checkout") ||
        isCheckoutSubmitter(submitter) ||
        isCheckoutSubmitter(fallbackSubmitter);
      if (!checkoutIntent) return;

      const allowed = await ensureMegaskaAuthenticatedBeforeCheckout({
        event,
        pendingAction: {
          type: "navigate",
          url: "/checkout",
        },
        triggerEl:
          submitter ||
          form.querySelector(
            "button[name='checkout'], button[name='goto_pp'], input[name='checkout'], input[name='goto_pp'], [data-checkout-button], .shopify-payment-button__button, .checkout-button, .btn-checkout, .mini-cart__checkout, .cart__checkout"
          ),
        form,
      });

      if (!allowed) {
        console.log("[Megaska OTP] checkout submit intercepted");
        return;
      }

      event.preventDefault();
      const customer = await getCurrentMegaskaCustomer();
      await applyCheckoutPrefillToForm(form, customer);
      const submittedAction = form.getAttribute("action") || "/checkout";
      const prefilledUrl = await buildPrefilledCheckoutUrl(submittedAction, customer);
      const handoff = await runBuyerIdentityHandoff(prefilledUrl, customer);
      if (isCheckoutContinuationBlocked(handoff)) {
        console.warn("[Megaska Checkout Gate] continuation stopped after handoff", {
          reason: handoff.reason || "blocked",
        });
        renderCheckoutGuardError({
          anchor: form,
          message: "Please verify your mobile number before checkout.",
        });
        openModal("checkout-gate-blocked");
        return;
      }
      const finalTargetUrl = handoff?.checkoutUrl || prefilledUrl || submittedAction;
      console.log("[Megaska Checkout Prefill] checkout continuation", {
        mode: "form-redirect",
        finalCheckoutUrl: finalTargetUrl,
        mutationWaited: true,
        debugSurface: "window.__megaskaCheckoutDebug",
      });
      window.location.assign(finalTargetUrl);
    }, true);
  }
function hasVisibleNativeDesktopAccountEntry() {
  const desktopCandidates = Array.from(
    document.querySelectorAll(
      NATIVE_DESKTOP_ACCOUNT_SELECTORS
        .map((selector) => `${selector}:not([data-megaska-fallback-account])`)
        .join(",")
    )
  );

  return desktopCandidates.some((el) => {
    const action = getAccountTriggerActionElement(el);
    const visible =
      !isInMobileContext(el) &&
      isElementActuallyVisible(action) &&
      isUsableAccountEntryTrigger(el);
    if (visible) action.setAttribute("data-loopdesk-account-control-source", "native-visible");
    return visible;
  });
}
  function hasKnownMegaskaSession() {
    try {
      return Boolean(
        document?.documentElement?.classList?.contains("megaska-account-authenticated") &&
          window?.localStorage?.getItem("megaska_session_token")
      );
    } catch {
      return false;
    }
  }

  function hasBuyNowIntentText(value) {
    return /\bbuy[\s_-]*now\b|\bdynamic[\s_-]*checkout\b|\bcheckout[\s_-]*now\b/i.test(
      String(value || "")
    );
  }

  function isBuyNowElement(element) {
    if (!element || typeof element.matches !== "function") return false;

    if (
      element.matches(
        ".pbar-buy, #mpb-continue, .mpb-continue, .shopify-payment-button__button"
      )
    ) {
      return true;
    }

    const text = String(element.textContent || "").trim();
    const ariaLabel = String(element.getAttribute("aria-label") || "").trim();

    return /\bbuy[\s_-]*now\b/i.test(text) || /\bbuy[\s_-]*now\b/i.test(ariaLabel);
  }

  function getSubmitterForForm(event, form) {
    if (event?.submitter) return event.submitter;
    const active = document?.activeElement;
    if (!active || typeof active.closest !== "function") return null;
    if (active.closest("form") !== form) return null;
    if (!active.matches("button,input[type='submit'],input[type='image']")) return null;
    return active;
  }

  function isBuyNowCartAddSubmitIntent(event, form) {
    const submitter = getSubmitterForForm(event, form);
    const submitterText = String(submitter?.textContent || submitter?.value || "").trim();
    const submitterClassName = String(submitter?.className || "");
    const submitterName = String(submitter?.getAttribute?.("name") || "");
    const submitterId = String(submitter?.id || "");
    const submitterDataAction = String(submitter?.getAttribute?.("data-action") || "");
    const submitterDataAttrNames = submitter?.getAttributeNames?.() || [];
    const submitterFormAction = String(submitter?.getAttribute?.("formaction") || "");
    const formAction = String(form?.getAttribute?.("action") || "");
    const formClassName = String(form?.className || "");
    const formId = String(form?.id || "");
    const formDataAttrNames = form?.getAttributeNames?.() || [];

    if (
      submitter &&
      (String(submitterName).trim().toLowerCase() === "add" ||
        hasAddToCartIntentText(submitterText) ||
        hasAddToCartIntentText(submitterClassName) ||
        hasAddToCartIntentText(submitterId) ||
        hasAddToCartIntentText(submitterDataAction))
    ) {
      return { intent: false, submitter };
    }

    if (submitter && submitter.matches(".pbar-buy, .shopify-payment-button__button")) {
      return { intent: true, submitter };
    }

    if (
      hasBuyNowIntentText(submitterText) ||
      hasBuyNowIntentText(submitterClassName) ||
      hasBuyNowIntentText(submitterName) ||
      hasBuyNowIntentText(submitterId) ||
      hasBuyNowIntentText(submitterDataAction)
    ) {
      return { intent: true, submitter };
    }

    if (
      hasBuyNowIntentText(submitterFormAction) ||
      /\/checkout/i.test(submitterFormAction)
    ) {
      return { intent: true, submitter };
    }

    if (submitterDataAttrNames.some((name) => /buy|dynamic|checkout/i.test(String(name || "")))) {
      return { intent: true, submitter };
    }

    if (
      hasBuyNowIntentText(formClassName) ||
      hasBuyNowIntentText(formId) ||
      hasBuyNowIntentText(formAction)
    ) {
      return { intent: true, submitter };
    }

    if (formDataAttrNames.some((name) => /buy|dynamic|checkout/i.test(String(name || "")))) {
      return { intent: true, submitter };
    }

    return { intent: false, submitter };
  }

  function bindCartAddSubmitInterceptor() {
    if (cartAddSubmitBound) return;
    cartAddSubmitBound = true;

    document.addEventListener("submit", (event) => {
      const form = event?.target;
      if (!form || !form.matches || !form.matches("form")) return;
      if (resumingCartAddForms.has(form)) return;

      const action = String(form.getAttribute("action") || "");
      if (!isCartAddPath(action)) return;

      const buyNowIntent = isBuyNowCartAddSubmitIntent(event, form);
      if (!buyNowIntent.intent) return;
      if (hasKnownMegaskaSession()) return;

      hardBlockEvent(event);

      console.log("[Megaska OTP] buy-now submit intercepted", { form });
      setPendingAction({
        type: "buy-now-submit",
        form,
        submitter: buyNowIntent.submitter || null,
      });
      openModal("buy-now-intercept");
    }, true);
  }

  function interceptCheckoutClicks(options) {
    const opts = options || {};
    checkoutInterceptionEnabled = opts.enabled !== false;
    bindCheckoutSubmitInterceptor();
    return checkoutInterceptionEnabled;
  }

  function init() {
    bindGlobalClickInterceptor();
    bindSubmitDebugListener();
    interceptCheckoutClicks({ enabled: true });
    bindCartAddSubmitInterceptor();
    bindAuthStateSync();
    ensureModal();
    if (isAccountDashboardRedirectEnabled()) {
      observeDesktopAccountContainer();
      bindAccountFallbackObserver();
    }
    syncAccountUiState();
    if (document && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", logPaymentButtonsPresence, { once: true });
    } else {
      logPaymentButtonsPresence();
    }
  }

  window.MegaskaOtp = {
    init,
    openModal,
    closeModal,
    isModalOpen,
    resetModalState,
    interceptCheckoutClicks,
    ensureMegaskaAuthenticatedBeforeCheckout,
    clearCheckoutErrors,
    clearPendingAction,
    hideAccountMenu,
    handleLogoutClick,
  };

  window.addEventListener("loopdesk:runtime-config-ready", (event) => {
    const modal = document.querySelector("[data-megaska-otp-modal]");
    if (modal) applyOtpModalBranding(modal);
    const eventPolicy = event?.detail?.otpCountryPolicy;
    const rawPolicy = hasUsableOtpCountryPolicy(eventPolicy) ? eventPolicy : window.LoopDeskConfig?.otpCountryPolicy;
    if (hasUsableOtpCountryPolicy(rawPolicy)) refreshOtpCountryPolicy(rawPolicy);
    // The merchant account-icon config lands with the runtime config; reconcile
    // so the injected icon picks it up even if it was created earlier with the
    // theme-adaptive default. Guarded like the rest of the fallback lifecycle.
    if (isAccountDashboardRedirectEnabled()) scheduleAccountFallbackReconciliation();
  });

  document.addEventListener("DOMContentLoaded", init);
})();
