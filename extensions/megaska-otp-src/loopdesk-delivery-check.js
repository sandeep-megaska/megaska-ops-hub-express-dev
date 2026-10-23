(function () {
  "use strict";

  // LoopD2C delivery check (product page app block). Looks up a PIN code through the
  // app proxy and shows serviceability, Cash on Delivery and expected delivery dates.
  // The result is cached under RESULT_KEY so the LoopD2C bag can show
  // "Delivering to <city> · Expected by <date>" without a second lookup.

  var RESULT_KEY = "loopd2c_delivery_pin_result";

  // Orders placed at or after the cutoff hour, or on a non-dispatch Sunday, ship on
  // the next dispatch day. The bag uses the same rule via the cached options.
  function shipDate(now, options) {
    var cutoff = options && options.cutoffHour != null ? Number(options.cutoffHour) : 12;
    var skipSunday = !options || options.skipSunday !== false;
    var ship = new Date(now.getTime());
    var closed = function (d) { return skipSunday && d.getDay() === 0; };
    if (closed(ship)) {
      while (closed(ship)) ship.setDate(ship.getDate() + 1);
    } else if (ship.getHours() >= cutoff) {
      ship.setDate(ship.getDate() + 1);
      while (closed(ship)) ship.setDate(ship.getDate() + 1);
    }
    return ship;
  }

  function deliveryRange(tatDays, now, options) {
    var tat = Number(tatDays);
    if (!(tat > 0)) return null;
    var ship = shipDate(now, options);
    var from = new Date(ship.getTime()); from.setDate(from.getDate() + tat);
    var to = new Date(ship.getTime()); to.setDate(to.getDate() + tat + 1);
    return { from: from, to: to };
  }

  function formatDay(date) {
    return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  function placeLine(data) {
    var city = String(data.city || data.district || data.inc || "").trim();
    var state = String(data.stateCode || "").trim();
    return city ? city + (state ? " (" + state + ")" : "") : "";
  }

  function readOptions(root) {
    var hour = parseInt(root.getAttribute("data-cutoff-hour"), 10);
    return {
      cutoffHour: isNaN(hour) ? 12 : hour,
      skipSunday: root.getAttribute("data-skip-sunday") !== "false",
      showCod: root.getAttribute("data-show-cod") !== "false",
      designMode: Boolean(window.Shopify && window.Shopify.designMode),
    };
  }

  function readCached() {
    try {
      var data = JSON.parse(window.localStorage.getItem(RESULT_KEY) || "null");
      return data && /^\d{6}$/.test(String(data.pin || "")) ? data : null;
    } catch (_error) { return null; }
  }

  function cache(pin, data, options) {
    try {
      window.localStorage.setItem(RESULT_KEY, JSON.stringify({
        pin: pin,
        city: data.city || data.district || "",
        stateCode: data.stateCode || "",
        inc: data.inc || "",
        tatDays: Number(data.tatDays) > 0 ? Number(data.tatDays) : null,
        isCod: data.isCod === true,
        cutoffHour: options.cutoffHour,
        skipSunday: options.skipSunday,
        checkedAt: new Date().toISOString(),
      }));
    } catch (_error) {}
  }

  // Builds the message lines for a lookup response. Returns { tone, lines }.
  function describe(data, now, options) {
    if (data && data.error === "DELHIVERY_NOT_CONFIGURED" && options.designMode) {
      return { tone: "error", lines: ["Connect Delhivery in LoopD2C settings to turn on delivery checks. Shoppers see a retry message until then."] };
    }
    if (!data || data.ok !== true) {
      return { tone: "error", lines: ["We couldn't check this PIN code right now. Please try again."] };
    }
    if (!data.isServiceable) {
      return { tone: "error", lines: ["Sorry, we don't deliver to this PIN code yet."] };
    }
    var place = placeLine(data);
    var lines = [place ? "Delivery available to " + place : "Delivery available"];
    var range = deliveryRange(data.tatDays, now, options);
    if (range) lines.push("Expected by " + formatDay(range.from) + " \u2013 " + formatDay(range.to));
    if (options.showCod) lines.push(data.isCod ? "Cash on Delivery available" : "Cash on Delivery not available for this PIN code");
    return { tone: "ok", lines: lines };
  }

  function render(result, message) {
    result.textContent = "";
    result.setAttribute("data-tone", message.tone);
    message.lines.forEach(function (line, index) {
      var node = document.createElement(index === 0 ? "strong" : "span");
      node.textContent = line;
      result.appendChild(node);
    });
  }

  function init(root) {
    if (root.getAttribute("data-loopdesk-delivery-ready") === "true") return;
    root.setAttribute("data-loopdesk-delivery-ready", "true");
    var form = root.querySelector("form");
    var input = root.querySelector("input");
    var button = root.querySelector("button");
    var result = root.querySelector(".loopdesk-delivery-check__result");
    if (!form || !input || !button || !result) return;
    var base = root.getAttribute("data-app-proxy-base") || "/apps/loopd2c";
    var options = readOptions(root);
    var label = button.textContent;

    var cached = readCached();
    if (cached && !input.value) input.value = cached.pin;

    input.addEventListener("input", function () {
      var digits = input.value.replace(/\D/g, "").slice(0, 6);
      if (digits !== input.value) input.value = digits;
      input.removeAttribute("aria-invalid");
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var pin = input.value.replace(/\D/g, "");
      if (!/^\d{6}$/.test(pin)) {
        input.setAttribute("aria-invalid", "true");
        render(result, { tone: "error", lines: ["Enter a valid 6-digit PIN code."] });
        return;
      }
      button.disabled = true;
      button.textContent = "Checking\u2026";
      render(result, { tone: "pending", lines: ["Checking delivery\u2026"] });
      fetch(base + "/api/delhivery/pincode?pin=" + encodeURIComponent(pin), { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (response) {
          // Module switched off for this shop: hide the block rather than show an error.
          if (response.status === 403 || response.status === 404) { root.hidden = true; return null; }
          return response.json().catch(function () { return null; });
        })
        .then(function (data) {
          if (root.hidden) return;
          var message = describe(data, new Date(), options);
          render(result, message);
          if (message.tone === "ok") {
            cache(pin, data, options);
            try { document.dispatchEvent(new CustomEvent("loopd2c:delivery-checked", { detail: { pin: pin } })); } catch (_error) {}
          }
        })
        .catch(function () {
          render(result, describe(null, new Date(), options));
        })
        .then(function () {
          button.disabled = false;
          button.textContent = label;
        });
    });
  }

  function initAll() {
    var roots = document.querySelectorAll("[data-loopdesk-delivery-check]");
    for (var i = 0; i < roots.length; i += 1) init(roots[i]);
  }

  window.LoopD2CDeliveryCheck = { RESULT_KEY: RESULT_KEY, shipDate: shipDate, deliveryRange: deliveryRange, describe: describe, init: initAll };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll);
  else initAll();
  // Theme editor: re-run when the block is added or re-rendered.
  document.addEventListener("shopify:section:load", initAll);
})();
