(function () {
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
          if (el.dataset.sameTab === "false") window.open(el.dataset.dashboardUrl || "/apps/megaska/account", "_blank", "noopener");
          else window.location.href = el.dataset.dashboardUrl || "/apps/megaska/account";
        } else openLogin();
      });
    });
  }
  document.addEventListener("megaska:auth-state-changed", init);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
