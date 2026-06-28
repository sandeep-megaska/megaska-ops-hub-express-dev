(function () {
  const OTP_LENGTH = 4;
  const RESEND_SECONDS = 30;
  const SUCCESS_CLOSE_DELAY_MS = 1400;
  const COUNTRY_REGION = "India";
  const INDIAN_STATES_AND_UTS = [
    "Andaman and Nicobar Islands",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Puducherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
  ];
	

  const state = {
  isOpen: false,
  step: "phone",
  phoneDigits: "",
  normalizedPhone: "",
  otpDigits: ["", "", "", ""],
  requesting: false,
  verifying: false,
  savingProfile: false,
  resendSeconds: 0,
  resendTimerId: null,
  errorMessage: "",
  statusMessage: "",
  successMessage: "Welcome back to Megaska",
  profileFirstName: "",
  profileLastName: "",
  profileEmail: "",
  profileAddressLine1: "",
  profileAddressLine2: "",
  profileCity: "",
  profileStateProvince: "",
  profilePostalCode: "",
  profileCountryRegion: COUNTRY_REGION,
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
  let desktopAccountContainerObserver = null;
  let observedDesktopAccountContainer = null;
  const resumingCartAddForms = new WeakSet();
  const ACCOUNT_FALLBACK_DESKTOP_ID = "megaska-account-fallback-desktop";
  const ACCOUNT_FALLBACK_MOBILE_ID = "megaska-account-fallback-mobile";
  const DEFAULT_MEGASKA_DASHBOARD_URL = "/apps/megaska/dashboard";

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
    "[aria-label*='account' i]",
    "[title*='account' i]",
  ];
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

  function maskPhone(phoneDigits) {
    if (!phoneDigits) return "+91 ••••• •••••";
    const first = phoneDigits.slice(0, 5);
    const second = phoneDigits.slice(5, 10);
    return `+91 ${first} ${second}`;
  }

  function isBusy() {
    return state.requesting || state.verifying || state.savingProfile;
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

    clearResendTimer();
    state.step = preservePhone && savedPhone ? "otp" : "phone";
    state.phoneDigits = savedPhone;
    state.normalizedPhone = savedNormalizedPhone;
    state.otpDigits = ["", "", "", ""];
    state.requesting = false;
    state.verifying = false;
    state.savingProfile = false;
    state.resendSeconds = 0;
    state.errorMessage = "";
    statusMessage: "";
    state.successMessage = "🌊 Welcome back. Your beach look awaits";
    state.profileFirstName = "";
    state.profileLastName = "";
    state.profileEmail = "";
    state.profileAddressLine1 = "";
    state.profileAddressLine2 = "";
    state.profileCity = "";
    state.profileStateProvince = "";
    state.profilePostalCode = "";
    state.profileCountryRegion = COUNTRY_REGION;
  }

  function resolveExtensionAssetUrl(filename) {
    const currentScript =
      document.currentScript ||
      Array.from(document.scripts || []).find((script) =>
        String(script?.src || "").includes("megaska-otp.js")
      );

    try {
      if (currentScript?.src) {
        return new URL(filename, currentScript.src).toString();
      }
    } catch (error) {
      console.warn("[Megaska OTP] asset URL fallback used", error);
    }

    return `/assets/${filename}`;
  }

  function ensureModal() {
    let modal = document.querySelector("[data-megaska-otp-modal]");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.setAttribute("data-megaska-otp-modal", "1");
    modal.setAttribute("aria-hidden", "true");
    modal.className = "megaska-otp-modal";
    modal.hidden = true;

    const logoUrl = resolveExtensionAssetUrl("megaska_logo.png");

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

            <div class="megaska-otp-logo-wrap">
              <img
                src="${logoUrl}"
                alt="Megaska"
                class="megaska-otp-logo"
                onerror="this.style.display='none';"
              />
            </div>

            <div class="megaska-otp-offer">
              <span class="megaska-otp-offer-badge">15% OFF</span>
              <span>Use Code: <strong>MEGA15</strong></span>
            </div>

            <h2 id="megaska-otp-title" class="megaska-otp-title">Login or Signup</h2>
            <p class="megaska-otp-subtitle">Unlock 15% OFF and continue to secure checkout</p>

            <div class="megaska-otp-trust-strip">
              <span class="megaska-otp-chip">Secure login</span>
              <span class="megaska-otp-chip">Faster checkout</span>
              <span class="megaska-otp-chip">Free shipping</span>
            </div>
          </div>

          <div data-megaska-step-phone class="megaska-otp-step-phone">
            <label class="megaska-otp-label" for="megaska-phone-input">Mobile number</label>
            <div class="megaska-otp-phone-wrap" role="group" aria-label="Indian mobile number">
              <span class="megaska-otp-country" aria-hidden="true">
                <span class="megaska-otp-flag">🇮🇳</span>
                <span class="megaska-otp-dial-code">+91</span>
              </span>
              <input
                id="megaska-phone-input"
                data-megaska-phone-input
                class="megaska-otp-phone-input"
                type="tel"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel-national"
                placeholder="98765 43210"
                aria-label="Enter 10 digit mobile number"
              />
            </div>
            <p class="megaska-otp-hint" data-megaska-phone-hint>We'll auto-send a 4-digit OTP when 10 digits are entered.</p>
            <p class="megaska-otp-trouble">We never share your number</p>
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
            <p class="megaska-otp-step-subtitle">Just a few details for smoother checkout next time</p>
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

              <div class="megaska-otp-form-field megaska-otp-col-span-2">
                <label class="megaska-otp-label" for="megaska-address1-input">Address line 1</label>
                <input
                  id="megaska-address1-input"
                  data-megaska-profile-address1
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="address-line1"
                  placeholder="House number, street, locality"
                  aria-label="Enter address line 1"
                />
              </div>

              <div class="megaska-otp-form-field megaska-otp-col-span-2">
                <label class="megaska-otp-label" for="megaska-address2-input">Address line 2 (optional)</label>
                <input
                  id="megaska-address2-input"
                  data-megaska-profile-address2
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="address-line2"
                  placeholder="Apartment, suite, landmark"
                  aria-label="Enter address line 2"
                />
              </div>

              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-city-input">City</label>
                <input
                  id="megaska-city-input"
                  data-megaska-profile-city
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="address-level2"
                  placeholder="Enter city"
                  aria-label="Enter city"
                />
              </div>

              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-state-input">State</label>
                <select
                  id="megaska-state-input"
                  data-megaska-profile-state
                  class="megaska-otp-text-input megaska-otp-select-input"
                  autocomplete="address-level1"
                  aria-label="Select state"
                >
                  <option value="">Select state</option>
                  ${INDIAN_STATES_AND_UTS.map((region) => `<option value="${region}">${region}</option>`).join("")}
                </select>
              </div>

              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-postal-input">PIN Code</label>
                <input
                  id="megaska-postal-input"
                  data-megaska-profile-postal
                  class="megaska-otp-text-input"
                  type="text"
                  autocomplete="postal-code"
                  placeholder="Enter PIN code"
                  aria-label="Enter PIN code"
                />
              </div>

              <div class="megaska-otp-form-field">
                <label class="megaska-otp-label" for="megaska-country-input">Country</label>
                <input
                  id="megaska-country-input"
                  class="megaska-otp-text-input"
                  type="text"
                  value="${COUNTRY_REGION}"
                  aria-label="Country"
                  readonly
                  tabindex="-1"
                />
              </div>
            </div>

            <button type="button" class="megaska-otp-primary-btn" data-megaska-profile-submit>
              Save and Continue
            </button>
          </div>

          <div data-megaska-step-success hidden class="megaska-otp-success">
            <div class="megaska-otp-success-icon" aria-hidden="true">✓</div>
            <h2>You’re in</h2>
            <p data-megaska-success-message>Welcome back to Megaska</p>
          </div>

          <p class="megaska-otp-error" data-megaska-otp-error role="alert" aria-live="polite"></p>
        </section>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("[data-megaska-otp-close]").addEventListener("click", () => {
      closeModal("close-button");
    });

    modal.querySelector("[data-megaska-otp-backdrop]").addEventListener("click", () => {
      closeModal("backdrop");
    });

    const phoneInput = modal.querySelector("[data-megaska-phone-input]");
    phoneInput.addEventListener("input", handlePhoneInput);

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
      .querySelector("[data-megaska-profile-address1]")
      .addEventListener("input", (event) => {
        state.profileAddressLine1 = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-address2]")
      .addEventListener("input", (event) => {
        state.profileAddressLine2 = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-city]")
      .addEventListener("input", (event) => {
        state.profileCity = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-state]")
      .addEventListener("change", (event) => {
        state.profileStateProvince = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    modal
      .querySelector("[data-megaska-profile-postal]")
      .addEventListener("input", (event) => {
        state.profilePostalCode = String(event.target.value || "");
        if (state.errorMessage) {
          state.errorMessage = "";
          renderStep();
        }
      });

    document.addEventListener("keydown", handleEscClose);

    return modal;
  }

  function getModalParts() {
  const modal = ensureModal();
  return {
    modal,
    stepPhone: modal.querySelector("[data-megaska-step-phone]"),
    stepOtp: modal.querySelector("[data-megaska-step-otp]"),
    stepProfile: modal.querySelector("[data-megaska-step-profile]"),
    stepSuccess: modal.querySelector("[data-megaska-step-success]"),
    phoneInput: modal.querySelector("[data-megaska-phone-input]"),
    phoneHint: modal.querySelector("[data-megaska-phone-hint]"),
    phoneDisplay: modal.querySelector("[data-megaska-phone-display]"),
    otpInputs: Array.from(modal.querySelectorAll("[data-megaska-otp-digit]")),
    resendText: modal.querySelector("[data-megaska-resend-text]"),
    resendBtn: modal.querySelector("[data-megaska-resend]"),
    profileFirstNameInput: modal.querySelector("[data-megaska-profile-firstname]"),
    profileLastNameInput: modal.querySelector("[data-megaska-profile-lastname]"),
    profileEmailInput: modal.querySelector("[data-megaska-profile-email]"),
    profileAddress1Input: modal.querySelector("[data-megaska-profile-address1]"),
    profileAddress2Input: modal.querySelector("[data-megaska-profile-address2]"),
    profileCityInput: modal.querySelector("[data-megaska-profile-city]"),
    profileStateInput: modal.querySelector("[data-megaska-profile-state]"),
    profilePostalInput: modal.querySelector("[data-megaska-profile-postal]"),
    profileSubmitBtn: modal.querySelector("[data-megaska-profile-submit]"),
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
    stepSuccess,
    phoneInput,
    phoneHint,
    phoneDisplay,
    otpInputs,
    resendText,
    resendBtn,
    profileFirstNameInput,
    profileLastNameInput,
    profileEmailInput,
    profileAddress1Input,
    profileAddress2Input,
    profileCityInput,
    profileStateInput,
    profilePostalInput,
    profileSubmitBtn,
    errorEl,
    statusEl,
    successMessage,
  } = getModalParts();

  stepPhone.hidden = state.step !== "phone";
  stepOtp.hidden = state.step !== "otp";
  stepProfile.hidden = state.step !== "profile";
  stepSuccess.hidden = state.step !== "success";

  phoneInput.value = state.phoneDigits;
  phoneDisplay.textContent = maskPhone(state.phoneDigits);
  successMessage.textContent = state.successMessage;

  profileFirstNameInput.value = state.profileFirstName;
  profileLastNameInput.value = state.profileLastName;
  profileEmailInput.value = state.profileEmail;
  profileAddress1Input.value = state.profileAddressLine1;
  profileAddress2Input.value = state.profileAddressLine2;
  profileCityInput.value = state.profileCity;
  profileStateInput.value = state.profileStateProvince;
  profilePostalInput.value = state.profilePostalCode;

  profileFirstNameInput.disabled = state.savingProfile;
  profileLastNameInput.disabled = state.savingProfile;
  profileEmailInput.disabled = state.savingProfile;
  profileAddress1Input.disabled = state.savingProfile;
  profileAddress2Input.disabled = state.savingProfile;
  profileCityInput.disabled = state.savingProfile;
  profileStateInput.disabled = state.savingProfile;
  profilePostalInput.disabled = state.savingProfile;
  profileSubmitBtn.disabled = state.savingProfile;
  profileSubmitBtn.textContent = state.savingProfile ? "Saving..." : "Save and Continue";

  otpInputs.forEach((input, index) => {
    input.value = state.otpDigits[index] || "";
    input.disabled = state.verifying;
  });

  if (state.step === "phone") {
    if (state.requesting) {
      phoneHint.textContent = "Sending OTP...";
    } else if (state.phoneDigits.length < 10) {
      phoneHint.textContent = "We'll auto-send a 4-digit OTP when 10 digits are entered.";
    } else {
      phoneHint.textContent = "Valid number detected. Sending OTP...";
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

  function openModal(triggerSource) {
    closeAccountMenu();
    closeCartDrawerBeforeModal();
    const { modal } = getModalParts();
    state.isOpen = true;
    resetModalState();
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
    const opts = options || {};
    const force = Boolean(opts.force);

    if (!force && isBusy()) return false;

    const { modal } = getModalParts();
    state.isOpen = false;
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
  renderStep();
  focusPhoneInput();
}

function renderOtpStep() {
  state.step = "otp";
  state.errorMessage = "";
  state.statusMessage = state.requesting ? "Sending OTP..." : "";
  state.otpDigits = ["", "", "", ""];
  renderStep();
 // focusOtpInput(0);
}

function renderSuccessStep(message) {
  state.step = "success";
  state.statusMessage = "";
  state.errorMessage = "";
  state.successMessage = message || "Welcome back to Megaska";
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

 /* function needsProfileCompletion(customer) {
    const firstName = normalizeText(customer?.firstName || "");
    const lastName = normalizeText(customer?.lastName || "");
    const email = normalizeEmail(customer?.email || "");
    const addressLine1 = normalizeText(customer?.addressLine1 || "");
    const city = normalizeText(customer?.city || "");
    const stateProvince = normalizeText(customer?.stateProvince || "");
    const postalCode = normalizeText(customer?.postalCode || "");
    const countryRegion = normalizeText(customer?.countryRegion || "");
    return !(
      firstName &&
      lastName &&
      email &&
      addressLine1 &&
      city &&
      stateProvince &&
      postalCode &&
      countryRegion
    );
  }*/
function needsProfileCompletion() {
  return false;
}
  function renderProfileStep(customer) {
    state.step = "profile";
    state.errorMessage = "";
    state.profileFirstName = normalizeText(customer?.firstName || "");
    state.profileLastName = normalizeText(customer?.lastName || "");
    state.profileEmail = normalizeEmail(customer?.email || "");
    state.profileAddressLine1 = normalizeText(customer?.addressLine1 || "");
    state.profileAddressLine2 = normalizeText(customer?.addressLine2 || "");
    state.profileCity = normalizeText(customer?.city || "");
    state.profileStateProvince = normalizeText(customer?.stateProvince || "");
    state.profilePostalCode = normalizeText(customer?.postalCode || "");
    state.profileCountryRegion = COUNTRY_REGION;
    renderStep();
    focusProfileInput();
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

    if (payload.success === true || payload.otpSent === true || payload.sent === true) {
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

  async function submitPhoneIfReady() {
  if (!isModalOpen()) return;
  if (state.requesting || state.verifying) return;
  if (state.phoneDigits.length !== 10) return;

  const normalizedPhone = normalizeIndianPhone(state.phoneDigits);
  if (!normalizedPhone) {
    state.errorMessage = "Please enter a valid 10-digit mobile number.";
    state.statusMessage = "";
    renderStep();
    return;
  }

  state.requesting = true;
  state.errorMessage = "";
 state.statusMessage = "📲 Sending your beach passcode...";
  state.normalizedPhone = normalizedPhone;

  renderOtpStep();
  startResendTimer();

  try {
    const otpRequestResponse = await window.MegaskaAuth.requestOtp(normalizedPhone);
    if (!isModalOpen()) return;

    if (!didOtpRequestSucceed(otpRequestResponse)) {
      throw new Error(getOtpRequestErrorMessage(otpRequestResponse));
    }

    state.requesting = false;
    state.statusMessage = "";
    renderStep();
  } catch (error) {
    state.requesting = false;
    state.step = "phone";
    state.statusMessage = "";
    state.errorMessage = error.message || "Unable to send OTP. Please try again.";
    renderStep();
    focusPhoneInput();
  }
}
  function handlePhoneInput(event) {
    if (!isModalOpen()) return;

    state.phoneDigits = sanitizeDigits(event.target.value, 10);
    event.target.value = state.phoneDigits;
    state.errorMessage = "";
    renderStep();

    if (state.phoneDigits.length === 10) {
      submitPhoneIfReady();
    }
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
    await window.MegaskaAuth.verifyOtp(state.normalizedPhone, otp);
    const refreshedSession = await window.MegaskaAuth.refreshAuthState();
    state.verifying = false;
    state.statusMessage = "";

    const sessionCustomer = refreshedSession?.customer || null;

    if (needsProfileCompletion(sessionCustomer)) {
      renderProfileStep(sessionCustomer);
      return;
    }

    hideAccountMenu();
    await syncAccountUiState();

    const accountRedirectTarget = consumePendingAccountRedirect();
    if (accountRedirectTarget) {
      console.log("[Megaska OTP] account redirect after OTP", { accountRedirectTarget });
      window.location.assign(accountRedirectTarget);
      return;
    }

   const hasCheckoutPending =
  pendingAction &&
  ["navigate", "buy-now-submit"].includes(pendingAction.type);

if (hasCheckoutPending) {
  renderSuccessStep("🌊 Preparing your beach-ready checkout...");
} else {
  renderSuccessStep("✨ You're in! Let’s dive into Megaska");
}

await resumePendingAction(sessionCustomer);

if (!hasCheckoutPending) {
  setTimeout(() => closeModal("success", { force: true }), SUCCESS_CLOSE_DELAY_MS);
}
  } catch (error) {
    state.verifying = false;
    state.statusMessage = "";
    state.errorMessage = error.message || "Invalid or expired OTP. Please try again.";
    state.otpDigits = ["", "", "", ""];
    renderStep();
    //focusOtpInput(0);
  }
}
  async function handleProfileSubmit() {
    if (!isModalOpen()) return;
    if (state.step !== "profile") return;
    if (state.savingProfile) return;

    const firstName = normalizeText(state.profileFirstName);
    const lastName = normalizeText(state.profileLastName);
    const email = normalizeEmail(state.profileEmail);
    const addressLine1 = normalizeText(state.profileAddressLine1);
    const addressLine2 = normalizeText(state.profileAddressLine2);
    const city = normalizeText(state.profileCity);
    const stateProvince = normalizeText(state.profileStateProvince);
    const postalCode = normalizeText(state.profilePostalCode);
    const countryRegion = COUNTRY_REGION;

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

    if (!addressLine1) {
      state.errorMessage = "Please enter your address line 1.";
      renderStep();
      const { profileAddress1Input } = getModalParts();
      setTimeout(() => profileAddress1Input.focus(), 0);
      return;
    }

    if (!city) {
      state.errorMessage = "Please enter your city.";
      renderStep();
      const { profileCityInput } = getModalParts();
      setTimeout(() => profileCityInput.focus(), 0);
      return;
    }

    if (!stateProvince) {
      state.errorMessage = "Please select your state.";
      renderStep();
      const { profileStateInput } = getModalParts();
      setTimeout(() => profileStateInput.focus(), 0);
      return;
    }

    if (!postalCode) {
      state.errorMessage = "Please enter your postal or PIN code.";
      renderStep();
      const { profilePostalInput } = getModalParts();
      setTimeout(() => profilePostalInput.focus(), 0);
      return;
    }

    state.savingProfile = true;
    state.errorMessage = "";
    renderStep();

    try {
      await window.MegaskaAuth.completeProfile({
        firstName,
        lastName,
        email,
        addressLine1,
        addressLine2,
        city,
        stateProvince,
        postalCode,
        countryRegion,
      });
      const refreshedSession = await window.MegaskaAuth.refreshAuthState();
      const sessionCustomer = refreshedSession?.customer || null;
      state.savingProfile = false;
hideAccountMenu();
await syncAccountUiState();

const accountRedirectTarget = consumePendingAccountRedirect();
if (accountRedirectTarget) {
  console.log("[Megaska OTP] account redirect after profile save", { accountRedirectTarget });
  window.location.assign(accountRedirectTarget);
  return;
}

await resumePendingAction(sessionCustomer);
renderSuccessStep("✨ Saved! Your next checkout will be even faster");
setTimeout(() => closeModal("success", { force: true }), SUCCESS_CLOSE_DELAY_MS);
    } catch (error) {
      state.savingProfile = false;
      state.errorMessage = error.message || "Unable to save your profile right now.";
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
      const otpRequestResponse = await window.MegaskaAuth.requestOtp(state.normalizedPhone);
      if (!didOtpRequestSucceed(otpRequestResponse)) {
        throw new Error(getOtpRequestErrorMessage(otpRequestResponse));
      }
      state.requesting = false;
      state.otpDigits = ["", "", "", ""];
      renderStep();
      focusOtpInput(0);
      startResendTimer();
    } catch (error) {
      state.requesting = false;
      state.errorMessage = error.message || "Unable to resend OTP right now.";
      renderStep();
    }
  }

  function handleEditPhone() {
    if (!isModalOpen()) return;
    if (isBusy()) return;
    renderPhoneStep();
  }

  function handleEscClose(event) {
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
      await window.MegaskaAuth.requestOtp(normalizedPhone);
      const otp = prompt("Enter the 4-digit OTP:");
      if (!otp) return;

      await window.MegaskaAuth.verifyOtp(normalizedPhone, sanitizeDigits(otp, OTP_LENGTH));
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
    if (!destination) return fallbackDestination;

    let parsedUrl = null;
    try {
      parsedUrl = new URL(destination, window.location.origin);
    } catch {
      return fallbackDestination;
    }

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
      return isShopifyNativeAccountPath(url.pathname);
    } catch {
      return false;
    }
  }

  function resolveAccountDestinationUrl(source) {
    const preferredDestination =
      typeof source === "string"
        ? source
        : source?.getAttribute?.("data-megaska-account-destination") ||
          source?.getAttribute?.("data-account-destination") ||
          "";

    const windowDestination = String(window?.MEGASKA_ACCOUNT_DASHBOARD_URL || "").trim();
    const htmlDestination = String(
      document?.documentElement?.getAttribute?.("data-megaska-account-destination") || ""
    ).trim();
    const bodyDestination = String(
      document?.body?.getAttribute?.("data-megaska-account-destination") || ""
    ).trim();

    return (
      normalizeAccountDestination(preferredDestination) ||
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

        const accountTrigger = findClosestMatchingElement(event, ACCOUNT_TRIGGER_SELECTORS);
        if (accountTrigger) {
          await handleAccountTriggerClick(event, accountTrigger);
          return;
        }

        const checkoutTrigger = inferCheckoutTriggerFromEvent(event);
        if (checkoutTrigger && isCheckoutTarget(checkoutTrigger)) {
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
    if ("hidden" in element && element.hidden) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;

    const style = window.getComputedStyle(element);
    if (!style) return true;
    return style.display !== "none" && style.visibility !== "hidden";
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
      (el) => isInMobileContext(el) && isInMobileMenuContainer(el) && isElementActuallyVisible(el)
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

  function getDesktopAccountContainer() {
    for (const selector of DESKTOP_ACCOUNT_CONTAINER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    return null;
  }

  function getMobileAccountContainer() {
    for (const selector of MOBILE_ACCOUNT_CONTAINER_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) return container;
    }
    return null;
  }

 function createDesktopAccountFallback() {
  const dashboardUrl = resolveAccountDestinationUrl();
  const link = document.createElement("a");
  link.id = ACCOUNT_FALLBACK_DESKTOP_ID;
  link.href = dashboardUrl;
  link.className = "megaska-account-fallback megaska-account-fallback--desktop";
  link.setAttribute("data-megaska-open-login", "1");
  link.setAttribute("data-megaska-fallback-account", "desktop");
  link.setAttribute("aria-label", "Account");
  link.innerHTML =
    '<span class="megaska-account-fallback__icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 12.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2.5c-4.3 0-8.5 2.2-8.5 5v1.5c0 .6.4 1 1 1h15c.6 0 1-.4 1-1V20c0-2.8-4.2-5-8.5-5Z"/></svg></span><span class="megaska-visually-hidden">Account</span>';
  return link;
}

  function createMobileAccountFallback() {
    const dashboardUrl = resolveAccountDestinationUrl();
    const item = document.createElement("li");
    item.id = ACCOUNT_FALLBACK_MOBILE_ID;
    item.className = "megaska-account-fallback-item";
    item.setAttribute("data-megaska-fallback-account", "mobile");
    item.innerHTML =
      `<a href="${dashboardUrl}" class="megaska-account-fallback megaska-account-fallback--mobile megaska-mobile-account-link" data-megaska-open-login="1"><span class="megaska-account-fallback__label">Login</span></a>`;
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
  ensureDesktopAccountFallback();

  if (!hasVisibleNativeMobileMenuAccountEntry()) {
    const mobileContainer = getMobileAccountContainer();
    if (mobileContainer && !document.getElementById(ACCOUNT_FALLBACK_MOBILE_ID)) {
      insertMobileFallbackInMenu(mobileContainer, createMobileAccountFallback());
      console.log("[Megaska OTP] mobile account fallback inserted");
    }
  } else {
    const existingMobileFallback = document.getElementById(ACCOUNT_FALLBACK_MOBILE_ID);
    if (existingMobileFallback) {
      existingMobileFallback.remove();
    }
  }
}

function ensureDesktopAccountFallback() {
  const desktopContainer = getDesktopAccountContainer();
  if (!desktopContainer) return;
  if (document.getElementById(ACCOUNT_FALLBACK_DESKTOP_ID)) return;

  const fallback = createDesktopAccountFallback();
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
  return;
}

function bindAccountFallbackObserver() {
  if (accountFallbackObserverBound) return;
  accountFallbackObserverBound = true;
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

  return desktopCandidates.some(
    (el) => !isInMobileContext(el) && isElementActuallyVisible(el)
  );
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
      if (!action.includes("/cart/add")) return;

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
    ensureAccountEntryFallbacks();
    ensureDesktopAccountFallback();
    observeDesktopAccountContainer();
    bindAccountFallbackObserver();
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
    clearPendingAction,
    hideAccountMenu,
    handleLogoutClick,
  };

  document.addEventListener("DOMContentLoaded", init);
})();
