(function () {
  const FALLBACK_DASHBOARD_URL = "/apps/loopd2c/account";
  const OBSOLETE_DASHBOARD_PATH = "/apps/loopd2c/dashboard";

  function resolveDashboardUrl(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return FALLBACK_DASHBOARD_URL;
    if (!value.startsWith("/") || value.startsWith("//")) return FALLBACK_DASHBOARD_URL;

    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin) return FALLBACK_DASHBOARD_URL;

      const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
      if (normalizedPath === OBSOLETE_DASHBOARD_PATH) return FALLBACK_DASHBOARD_URL;

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return FALLBACK_DASHBOARD_URL;
    }
  }

  function token() {
    const a = window.MegaskaAuth || {};
    if (typeof a.getSessionToken === "function") return a.getSessionToken();
    if (typeof a.getToken === "function") return a.getToken();
    try { return localStorage.getItem("megaska_session_token") || ""; } catch { return ""; }
  }
  function update(el) {
    const loggedIn = Boolean(token());
    el.classList.toggle("is-logged-in", loggedIn);
    el.querySelector("[data-ld-launcher-label]").textContent = loggedIn ? el.dataset.loggedInLabel : el.dataset.loggedOutLabel;
  }
  function openLogin() {
    if (window.MegaskaAuth && typeof window.MegaskaAuth.openLogin === "function") window.MegaskaAuth.openLogin();
    else document.querySelector("[data-megaska-open-login]")?.click();
  }
  function init() {
    document.querySelectorAll("[data-loopdesk-account-launcher]").forEach((el) => {
      if (el.dataset.bound === "1") return;
      el.dataset.bound = "1";
      update(el);
      el.addEventListener("click", function (event) {
        event.preventDefault();
        if (token()) {
          const dashboardUrl = resolveDashboardUrl(el.dataset.dashboardUrl);
          if (el.dataset.sameTab === "false") window.open(dashboardUrl, "_blank", "noopener");
          else window.location.href = dashboardUrl;
        } else openLogin();
      });
    });
  }
  window.LoopDeskAccountLauncher = Object.assign({}, window.LoopDeskAccountLauncher, { resolveDashboardUrl });
  document.addEventListener("megaska:auth-state-changed", init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
