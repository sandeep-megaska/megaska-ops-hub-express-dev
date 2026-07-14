(function () {
  "use strict";

  if (window.__LOOPDESK_DASHBOARD_AUTH_BRIDGE__) return;
  window.__LOOPDESK_DASHBOARD_AUTH_BRIDGE__ = true;

  var nativeFetch = window.fetch.bind(window);

  function isDashboardRequest(input) {
    try {
      var raw = input instanceof Request ? input.url : String(input || "");
      var url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin &&
        url.pathname.indexOf("/apps/megaska/api/customer-dashboard/v1") === 0;
    } catch (_error) {
      return false;
    }
  }

  async function getSessionToken() {
    var auth = window.MegaskaAuth || {};
    try {
      if (typeof auth.getSessionToken === "function") {
        return String((await auth.getSessionToken()) || "").trim();
      }
      if (typeof auth.getToken === "function") {
        return String((await auth.getToken()) || "").trim();
      }
    } catch (_error) {}
    return "";
  }

  window.fetch = async function (input, init) {
    if (!isDashboardRequest(input)) {
      return nativeFetch(input, init);
    }

    var token = await getSessionToken();
    if (!token) {
      return nativeFetch(input, init);
    }

    var options = Object.assign({}, init || {});
    var headers = new Headers(
      options.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }
    options.headers = headers;

    return nativeFetch(input, options);
  };
})();
