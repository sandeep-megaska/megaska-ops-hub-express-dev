(function () {
  var MARKER = "__LOOPDESK_BUY_NOW_BRIDGE_LOADED__";
  var API_NAME = "LoopDeskBuyNowBridge";
  var RESUME_KEY = "loopdesk_buy_now_resume_express_checkout";
  var PROCESSED = "loopdeskBuyNowProcessed";
  var ERROR_ID = "loopdesk-buy-now-status";
  var LOADING_LABEL = "Preparing checkout...";
  var CTA_LABEL = "Buy it now";

  if (window[MARKER] && window[API_NAME]) return;
  window[MARKER] = true;

  var selectors = [
    ".shopify-payment-button",
    ".shopify-payment-button__button",
    ".shopify-payment-button__button--unbranded",
    '[data-shopify="payment-button"]',
    "shopify-payment-button",
    "shopify-accelerated-checkout",
    "[data-buy-now]",
    "[data-buy-it-now]",
    "[data-dynamic-checkout]",
    'button[name="buy_now"]',
    'button[name="buy-now"]'
  ];
  var buyNowSelector = selectors.join(",");
  var formSelector = 'form[action*="/cart/add"]';
  var inflight = new WeakSet();
  var observer = null;
  var queuedRoots = [];
  var processTimer = null;
  var resumeTimer = null;
  var stats = { cartAdds: 0, opens: 0, otpOpens: 0, failures: 0, observerStarts: 0, ctaInjected: 0 };

  function matches(el, selector) { try { return Boolean(el && el.matches && el.matches(selector)); } catch { return false; } }
  function closest(el, selector) { try { return el && el.closest ? el.closest(selector) : null; } catch { return null; } }
  function byId(id) { return id ? document.getElementById(String(id).replace(/^#/, "")) : null; }
  function isDev() { return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(window.location.hostname) || window.Shopify && window.Shopify.designMode; }
  function devLog(msg) { if (isDev() && window.console) window.console.warn(msg); }
  function isThemeEditorControl(el) { return Boolean(closest(el, "#preview-bar-iframe, .shopify-section-editor, [data-shopify-editor], [data-shopify-inspector], [data-shopify-editor-block]")); }
  function isNativeCheckoutControl(el) { return Boolean(closest(el, 'a[href*="/checkout"], button[name="checkout"], input[name="checkout"], [data-loopdesk-express-checkout]')); }
  function cartAddForm(el) { return el && matches(el, formSelector) ? el : closest(el, formSelector); }
  function resolveForm(control) {
    var form = cartAddForm(control);
    if (form) return form;
    var formAttr = control.getAttribute && control.getAttribute("form");
    form = byId(formAttr);
    if (form && matches(form, formSelector)) return form;
    var ref = control.getAttribute && (control.getAttribute("data-product-form") || control.getAttribute("data-form-id") || control.getAttribute("data-form") || control.getAttribute("aria-controls"));
    form = byId(ref) || (ref && document.querySelector(ref));
    if (form && matches(form, formSelector)) return form;
    var productForm = closest(control, "product-form, [data-product-form], [data-product-form-container]");
    if (productForm) { form = productForm.querySelector(formSelector); if (form) return form; }
    var section = closest(control, '[id^="shopify-section-"], .shopify-section, [data-section-id], section');
    if (section) {
      var forms = Array.prototype.slice.call(section.querySelectorAll(formSelector)).filter(isUsableForm);
      if (forms.length === 1) return forms[0];
      form = section.querySelector(formSelector + '[data-active="true"], ' + formSelector + '.is-active');
      if (form) return form;
    }
    var all = Array.prototype.slice.call(document.querySelectorAll(formSelector)).filter(isUsableForm);
    return all.length === 1 ? all[0] : null;
  }
  function formDisabled(form) { return Boolean(form.querySelector('[disabled][name="id"], [name="id"][aria-disabled="true"], [data-sold-out="true"], [data-available="false"]')) || matches(form, '[data-sold-out="true"], [data-available="false"], .sold-out'); }
  function isUsableForm(form) { return Boolean(form && !matches(form, '[hidden], [aria-hidden="true"]')); }
  function validate(form, data) {
    var id = String(data.get("id") || "").trim();
    var qty = Number(data.get("quantity") || 1);
    if (!id) return "Please select a variant before checkout.";
    if (!Number.isFinite(qty) || qty <= 0) return "Please enter a valid quantity.";
    if (formDisabled(form)) return "This item is currently unavailable.";
    var selected = form.querySelector('[name="id"] option:checked');
    if (selected && selected.disabled) return "This variant is currently unavailable.";
    return "";
  }
  function statusNode() {
    var node = document.getElementById(ERROR_ID);
    if (!node) { node = document.createElement("div"); node.id = ERROR_ID; node.setAttribute("role", "status"); node.setAttribute("aria-live", "polite"); node.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;"; document.body.appendChild(node); }
    return node;
  }
  function announce(message) { statusNode().textContent = message || ""; }
  function setBusy(control) {
    var old = { disabled: control.disabled, ariaBusy: control.getAttribute("aria-busy"), label: control.innerHTML };
    control.setAttribute("aria-busy", "true");
    if ("disabled" in control) control.disabled = true;
    if (control.tagName !== "INPUT") control.textContent = LOADING_LABEL; else control.value = LOADING_LABEL;
    return old;
  }
  function restore(control, old) { if (!old) return; if (old.ariaBusy == null) control.removeAttribute("aria-busy"); else control.setAttribute("aria-busy", old.ariaBusy); if ("disabled" in control) control.disabled = old.disabled; if (control.tagName !== "INPUT") control.innerHTML = old.label; }
  function hasToken() { try { return Boolean(String(localStorage.getItem("megaska_session_token") || "").trim()); } catch { return false; } }
  function isExpressCheckoutReady() { var c = window.LoopDeskConfig && window.LoopDeskConfig.express_checkout; return Boolean(c && c.enabled === true && c.ready === true && c.provider === "razorpay"); }
  function setResume() { try { sessionStorage.setItem(RESUME_KEY, "1"); } catch {} }
  function clearResume() { try { sessionStorage.removeItem(RESUME_KEY); } catch {} }
  function hasResume() { try { return sessionStorage.getItem(RESUME_KEY) === "1"; } catch { return false; } }
  function openCheckout() { stats.opens += 1; if (window.LoopDeskCheckoutBridge && typeof window.LoopDeskCheckoutBridge.open === "function") window.LoopDeskCheckoutBridge.open(); else if (window.MegaskaExpressCheckout && typeof window.MegaskaExpressCheckout.open === "function") window.MegaskaExpressCheckout.open({ source: "loopdesk-buy-now" }); else window.dispatchEvent(new CustomEvent("loopdesk:express-checkout:open", { detail: { source: "loopdesk-buy-now" } })); }
  function openOtp() { stats.otpOpens += 1; var returnTo = window.location.pathname + window.location.search + window.location.hash; if (window.MegaskaAuth && typeof window.MegaskaAuth.openOtpModal === "function") return window.MegaskaAuth.openOtpModal({ returnTo: returnTo, source: "loopdesk-buy-now" }), true; if (window.MegaskaAuth && typeof window.MegaskaAuth.openAuthModal === "function") return window.MegaskaAuth.openAuthModal({ returnTo: returnTo, source: "loopdesk-buy-now" }), true; if (window.MegaskaOtp && typeof window.MegaskaOtp.openModal === "function") return window.MegaskaOtp.openModal("checkout"), true; return false; }
  async function addToCart(data) { stats.cartAdds += 1; var res = await fetch("/cart/add.js", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" }, body: data }); var json = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error(json.description || json.message || "We could not add this item to cart. Please try again."); try { if (window.LoopDeskAnalytics) window.LoopDeskAnalytics.track("CART_ADD", { source: "PRODUCT" }); } catch (e) {} return json; }
  function notifyCart() { document.dispatchEvent(new CustomEvent("loopdesk:cart:refresh", { detail: { source: "loopdesk-buy-now" } })); document.dispatchEvent(new CustomEvent("cart:refresh", { detail: { source: "loopdesk-buy-now" } })); }

  // Shopify renders its native Buy it now / Shop Pay / PayPal / Google Pay
  // button's actual clickable surface inside a cross-origin iframe, so a
  // parent-document click listener never receives that click at all. The
  // only reliable interception point is to hide the native control and
  // render our own same-document button in its place.
  async function runBuyNow(control, form) {
    var data = new FormData(form);
    var error = validate(form, data);
    if (error) { announce(error); devLog("[LoopDesk Buy Now] " + error); return; }
    if (inflight.has(control)) return;
    inflight.add(control);
    var old = setBusy(control);
    try {
      await addToCart(data);
      notifyCart();
      if (hasToken()) openCheckout(); else { setResume(); if (!openOtp()) openCheckout(); }
    } catch (err) {
      stats.failures += 1;
      announce(err && err.message || "We could not prepare checkout. Please try again.");
      restore(control, old);
      inflight.delete(control);
    }
  }

  function createLoopDeskBuyNowCta() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "loopdesk-buy-now-cta";
    button.setAttribute("data-loopdesk-buy-now-cta", "true");
    button.textContent = CTA_LABEL;
    button.addEventListener("click", function () {
      if (inflight.has(button)) return;
      var form = resolveForm(button);
      if (!form) { devLog("[LoopDesk Buy Now] unresolved product form"); return; }
      runBuyNow(button, form);
    });
    return button;
  }

  function replaceNativeButton(control) {
    if (!control || control.dataset[PROCESSED] === "true") return;
    control.dataset[PROCESSED] = "true";
    if (isThemeEditorControl(control) || isNativeCheckoutControl(control)) return;
    if (matches(control, '[name="add"], [data-add-to-cart], [data-wishlist], [aria-label*="wishlist" i], [class*="wishlist" i]')) return;
    if (!control.parentNode) return;
    var form = resolveForm(control);
    if (!form) { devLog("[LoopDesk Buy Now] unresolved product form for native button"); return; }

    control.setAttribute("data-loopdesk-hidden", "true");
    control.style.display = "none";
    control.style.visibility = "hidden";
    control.setAttribute("aria-hidden", "true");
    control.parentNode.insertBefore(createLoopDeskBuyNowCta(), control);
    stats.ctaInjected += 1;
  }

  function process(root) {
    if (!isExpressCheckoutReady()) return;
    root = root || document;
    var nodes = matches(root, buyNowSelector) ? [root] : Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll(buyNowSelector) : []);
    nodes.forEach(replaceNativeButton);
  }
  function queue(root) { queuedRoots.push(root || document); clearTimeout(processTimer); processTimer = setTimeout(function () { var roots = queuedRoots.splice(0, 25); roots.forEach(process); }, 50); }
  function startObserver() { if (observer) return; observer = new MutationObserver(function (muts) { muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes || [], function (n) { if (n.nodeType === 1) queue(n); }); }); }); observer.observe(document.documentElement, { childList: true, subtree: true }); stats.observerStarts += 1; }
  document.addEventListener("shopify:section:load", function (e) { queue(e.target); });
  document.addEventListener("shopify:block:select", function (e) { queue(e.target); });
  document.addEventListener("megaska:auth-state-changed", function () { if (!hasResume() || !hasToken()) return; clearResume(); clearTimeout(resumeTimer); resumeTimer = setTimeout(openCheckout, 150); });
  window.addEventListener("loopdesk:runtime-config-ready", function () { queue(document); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { process(document); startObserver(); }, { once: true }); else { process(document); startObserver(); }
  window[API_NAME] = {
    selectors: selectors.slice(),
    status: function () { return { loaded: true, observerStarts: stats.observerStarts, cartAdds: stats.cartAdds, opens: stats.opens, otpOpens: stats.otpOpens, failures: stats.failures, ctaInjected: stats.ctaInjected }; },
    _test: { resolveForm: resolveForm, validate: validate, process: process, replaceNativeButton: replaceNativeButton }
  };
})();
