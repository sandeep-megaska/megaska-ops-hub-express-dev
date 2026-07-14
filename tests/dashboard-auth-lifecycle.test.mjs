import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");

function createHarness({ token = "", fetchImpl, configOverride = {} } = {}) {
  const listeners = new Map();
  const root = { id: "loopdesk-customer-dashboard-root", dataset: {}, attributes: {}, innerHTML: "", setAttribute(n, v) { this.attributes[n] = String(v); }, appendChild(node) { document._drawer = node; } };
  const config = { id: "loopdesk-customer-dashboard-config", textContent: JSON.stringify(Object.assign({ apiUrl: "/summary", shopDomain: "shop.test" }, configOverride)) };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const document = {
    readyState: "complete", documentElement: { getAttribute: () => "shop.test" }, body: { classList: { add() {}, remove() {} } }, activeElement: null,
    getElementById(id) { return id === root.id ? root : id === config.id ? config : null; },
    querySelector(selector) { if (selector === "[data-loopdesk-customer-dashboard]") return root; if (selector === ".ld-account-drawer-wrap") return this._drawer || null; if (selector === "[data-ld-login]") return root.innerHTML.includes("data-ld-login") ? { addEventListener: (_t, fn) => { this._login = fn; }, click: () => this._login?.() } : null; if (selector === "[data-megaska-open-login]") return { click: () => calls.push({ kind: "fallbackLogin" }) }; return null; },
    querySelectorAll(selector) { if (selector === "[data-ld-logout]" && root.innerHTML.includes("data-ld-logout")) return [{ addEventListener: (_t, fn) => { this._logout = fn; }, click: () => this._logout?.() }]; return []; },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    createElement() { return { className: "", innerHTML: "", remove() { document._drawer = null; }, querySelector: () => ({ focus() {} }) }; },
  };
  const calls = [];
  const context = { window: null, document, CustomEvent, localStorage: { getItem: () => token, removeItem: () => { token = ""; } }, console: { log() { throw new Error("unsafe log"); }, debug() { throw new Error("unsafe debug"); }, info(...args) { calls.push({ kind: "info", args }); }, warn() {}, error() {} }, fetch: (...args) => { calls.push({ kind: "fetch", args }); return fetchImpl ? fetchImpl(...args) : Promise.resolve({ ok: true, status: 200, json: async () => ({ customer: { name: "Test" }, orders: [] }) }); }, setTimeout, clearTimeout, AbortController, Date, URL, Intl };
  context.window = { location: { origin: "https://shop.test", assign: (url) => calls.push({ kind: "redirect", url }) }, Shopify: { shop: "shop.test" }, setTimeout, clearTimeout, MegaskaAuth: { getSessionToken: () => token, getToken: () => token, getSession: () => ({ token }), openLogin: () => calls.push({ kind: "openLogin" }), logout: () => { calls.push({ kind: "logout" }); token = ""; } } };
  vm.runInNewContext(source, context);
  return { root, document, calls, window: context.window, setToken: (value) => { token = value; }, Event: CustomEvent };
}
const dispatchAuth = (h, detail) => h.document.dispatchEvent(new h.Event("megaska:auth-state-changed", { detail }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchCount = (h) => h.calls.filter((c) => c.kind === "fetch").length;

{
  const h = createHarness();
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.match(h.root.innerHTML, /Sign in to view your account/);
  assert.equal(fetchCount(h), 0);
  dispatchAuth(h, { authenticated: false });
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.equal(fetchCount(h), 0);
}

{
  const h = createHarness();
  dispatchAuth(h, {});
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.doesNotMatch(h.root.innerHTML, /Loading your account/);
  assert.equal(fetchCount(h), 0);
}

{
  let resolveFetch;
  const h = createHarness({ token: "token-now", fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }) });
  assert.equal(fetchCount(h), 1);
  dispatchAuth(h, { authenticated: true });
  dispatchAuth(h, { loggedIn: true });
  assert.equal(fetchCount(h), 1, "duplicate authenticated events reuse active dashboard request");
  resolveFetch({ ok: true, status: 200, json: async () => ({ customer: { name: "Test" }, orders: [] }) });
  await sleep(0);
}

{
  const h = createHarness();
  dispatchAuth(h, { authenticated: true });
  assert.equal(h.root.dataset.status, "AUTH_SETTLING");
  h.setToken("token-later");
  await sleep(130);
  assert.equal(fetchCount(h), 1);
}

{
  const h = createHarness();
  dispatchAuth(h, { authenticated: true });
  await sleep(1050);
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.equal(fetchCount(h), 0);
}

{
  const h = createHarness({ token: "bad", fetchImpl: () => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }) });
  await sleep(0);
  await sleep(0);
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.equal(fetchCount(h), 1);
}

{
  let resolveFirst;
  const h = createHarness({ token: "first", fetchImpl: () => new Promise((resolve) => { resolveFirst = resolve; }) });
  await sleep(0);
  h.setToken("");
  dispatchAuth(h, { authenticated: false });
  resolveFirst({ ok: false, status: 401, json: async () => ({}) });
  await sleep(0);
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.equal(fetchCount(h), 1);
}

{
  const h = createHarness();
  h.document.querySelector("[data-ld-login]").click();
  assert.equal(h.calls.filter((c) => c.kind === "openLogin").length, 1);
}


{
  const h = createHarness({ configOverride: { continueShoppingUrl: "/collections/sale", homeUrl: "/home" } });
  assert.match(h.root.innerHTML, /data-ld-login>Sign in/);
  assert.match(h.root.innerHTML, /href="https:\/\/shop\.test\/collections\/sale">Continue shopping/);
  assert.match(h.root.innerHTML, /href="https:\/\/shop\.test\/home">Back to home/);
  assert.doesNotMatch(h.root.innerHTML, /\/account\/login/);
}

{
  const h = createHarness();
  delete h.window.MegaskaAuth.openLogin;
  h.document.querySelector("[data-ld-login]").click();
  assert.equal(h.calls.filter((c) => c.kind === "fallbackLogin").length, 1);
}

{
  let signal;
  const h = createHarness({ token: "token-now", configOverride: { logoutRedirectUrl: "/signed-out" }, fetchImpl: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  h.root.innerHTML = `<header>Customer Name<button data-ld-logout>Logout</button></header><div class="ld-account-drawer-wrap">Order Drawer</div>`;
  h.document._drawer = { remove() { h.document._drawer = null; } };
  h.window.LoopDeskCustomerDashboard.logout();
  assert.equal(h.root.dataset.status, "AUTH_REQUIRED");
  assert.doesNotMatch(h.root.innerHTML, /Customer Name|Order Drawer/);
  assert.equal(signal.aborted, true);
  await sleep(0);
  assert.equal(h.calls.find((c) => c.kind === "redirect")?.url, "https://shop.test/signed-out");
}

{
  const h = createHarness({ token: "token-now", configOverride: { homeUrl: "/home" } });
  h.window.LoopDeskCustomerDashboard.logout();
  await sleep(0);
  assert.equal(h.calls.find((c) => c.kind === "redirect")?.url, "https://shop.test/home");
}

{
  const h = createHarness({ token: "token-now", configOverride: { logoutRedirectUrl: "https://evil.example/out", homeUrl: "/home" } });
  h.window.LoopDeskCustomerDashboard.logout();
  await sleep(0);
  assert.equal(h.calls.find((c) => c.kind === "redirect")?.url, "https://shop.test/home");
}

{
  const h = createHarness({ token: "token-now", configOverride: { logoutRedirectUrl: "https://evil.example/out", homeUrl: "https://evil.example/home" } });
  h.window.LoopDeskCustomerDashboard.logout();
  await sleep(0);
  assert.equal(h.calls.find((c) => c.kind === "redirect")?.url, "https://shop.test/");
}

{
  const h = createHarness({ token: "token-now" });
  h.window.LoopDeskCustomerDashboard.logout();
  await sleep(0);
  h.document.querySelector("[data-ld-login]").click();
  assert.equal(h.calls.filter((c) => c.kind === "openLogin").length, 1);
}

for (const call of createHarness().calls.filter((c) => c.kind === "info")) {
  assert.doesNotMatch(JSON.stringify(call.args), /token|customer|payload|phone|email|otp/i);
}
console.log("dashboard auth lifecycle tests passed");
