(function(){
  "use strict";
  var PUBLIC_NAME="LoopDeskAccountLauncher";
  var GUARD="__LOOPDESK_ACCOUNT_LAUNCHER_INITIALIZED__";
  var SELECTOR="[data-loopdesk-account-launcher]";
  var EVENT_NAMES=["megaska:auth-state-changed","loopdesk:auth-state-changed","storage"];
  function parseJson(node){try{return JSON.parse((node&&node.textContent)||"{}");}catch{return{};}}
  function normalizePath(value,fallback){
    var raw=String(value||fallback||"/apps/megaska/account").trim();
    try{var url=new URL(raw,window.location.origin); if(url.origin!==window.location.origin)return fallback||"/apps/megaska/account"; return url.pathname+url.search+url.hash;}catch{return fallback||"/apps/megaska/account";}
  }
  function isSafeReturnPath(value){
    if(!value)return false;
    try{var url=new URL(String(value),window.location.origin); return url.origin===window.location.origin && /^\//.test(url.pathname) && !/^\/\//.test(String(value));}catch{return false;}
  }
  function configFor(el){
    var saved=window.LoopDeskCustomerDashboardConfig||{};
    var cfg=Object.assign({}, saved, parseJson(el.querySelector("[data-loopdesk-account-launcher-config]")));
    var branding=saved.branding||{}, copy=saved.copy||{};
    cfg.loggedOutLabel=String(cfg.loggedOutLabel||copy.loginRequiredTitle||"Login");
    cfg.loggedInLabel=String(cfg.loggedInLabel||branding.accountLabel||saved.accountLabel||"My Account");
    cfg.dashboardUrl=normalizePath(cfg.dashboardUrl||(saved.links&&saved.links.dashboardUrl),"/apps/megaska/account");
    cfg.returnUrl=isSafeReturnPath(cfg.returnUrl)?normalizePath(cfg.returnUrl,cfg.dashboardUrl):cfg.dashboardUrl;
    cfg.openInSameTab=cfg.openInSameTab!==false;
    cfg.loginBehavior=String(cfg.loginBehavior||"modal");
    cfg.loginUrl=normalizePath(cfg.loginUrl||"/apps/megaska/account",cfg.dashboardUrl);
    cfg.hideWhileLoading=cfg.hideWhileLoading===true;
    return cfg;
  }
  function getToken(){var auth=window.MegaskaAuth||{}; try{if(typeof auth.getSessionToken==="function")return auth.getSessionToken()||""; if(typeof auth.getToken==="function")return auth.getToken()||"";}catch{} return "";}
  async function resolveSession(){
    var auth=window.MegaskaAuth||{};
    try{if(typeof auth.getSession==="function")return await auth.getSession(); if(typeof auth.fetchSession==="function")return await auth.fetchSession();}catch{return{authenticated:false};}
    return {authenticated:!!getToken()};
  }
  function setState(el,state,cfg){
    var link=el.querySelector("[data-loopdesk-account-launcher-action]"); var label=el.querySelector("[data-loopdesk-account-launcher-label]"); var status=el.querySelector("[data-loopdesk-account-launcher-status]");
    if(!link||!label)return;
    var loading=state==="loading",authed=state==="authenticated";
    el.dataset.loopdeskAccountLauncherState=state;
    link.setAttribute("aria-busy",loading?"true":"false");
    link.setAttribute("aria-label",loading?"Checking account session":(authed?cfg.loggedInLabel:cfg.loggedOutLabel));
    label.textContent=loading?cfg.loggedOutLabel:(authed?cfg.loggedInLabel:cfg.loggedOutLabel);
    if(status)status.textContent=loading?"Checking account session":(authed?"LoopDesk session active":"Login required");
    if(cfg.hideWhileLoading)el.hidden=loading; else el.hidden=false;
  }
  async function refresh(el){var cfg=configFor(el); setState(el,"loading",cfg); var session=await resolveSession(); setState(el,session&&session.authenticated?"authenticated":"anonymous",cfg);}
  function openLogin(cfg){
    var auth=window.MegaskaAuth||{};
    var options={returnUrl:cfg.returnUrl,returnTo:cfg.returnUrl};
    if(typeof auth.openLogin==="function")return auth.openLogin(options);
    if(typeof auth.openOtpModal==="function")return auth.openOtpModal(options);
    if(typeof auth.openAuthModal==="function")return auth.openAuthModal(options);
    if(typeof auth.login==="function")return auth.login(options);
    var url=new URL(cfg.loginUrl,window.location.origin); url.searchParams.set("returnUrl",cfg.returnUrl); window.location.assign(url.pathname+url.search+url.hash);
  }
  function navigate(cfg){ if(cfg.openInSameTab)window.location.assign(cfg.dashboardUrl); else window.open(cfg.dashboardUrl,"_blank","noopener,noreferrer"); }
  function bind(el){
    if(el.dataset.loopdeskLauncherBound==="1")return; el.dataset.loopdeskLauncherBound="1";
    if((window.LoopDeskCustomerDashboardConfig||{}).enabled===false && el.dataset.loopdeskHideWhenDisabled==="true"){el.hidden=true;return;}
    var cfg=configFor(el); setState(el,"loading",cfg);
    el.addEventListener("click",async function(e){var action=e.target.closest&&e.target.closest("[data-loopdesk-account-launcher-action]"); if(!action)return; e.preventDefault(); var session=await resolveSession(); if(session&&session.authenticated)navigate(configFor(el)); else openLogin(configFor(el));});
    refresh(el);
  }
  function boot(){document.querySelectorAll(SELECTOR).forEach(bind);}
  function refreshAll(){document.querySelectorAll(SELECTOR).forEach(refresh);}
  window[PUBLIC_NAME]={boot:boot,refresh:refreshAll,isSafeReturnPath:isSafeReturnPath};
  if(!window[GUARD]){window[GUARD]=true; if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot(); EVENT_NAMES.forEach(function(name){window.addEventListener(name,refreshAll);document.addEventListener(name,refreshAll);});}
})();
