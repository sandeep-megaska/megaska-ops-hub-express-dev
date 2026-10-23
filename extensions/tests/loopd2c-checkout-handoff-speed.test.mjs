import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp-src/loopd2c-auth.js", import.meta.url), "utf8");

// Loads the auth script with a signed-in session. `routes` answers each request by path;
// a route may return a promise to hold the response back. Every request is logged in `log`.
function loadAuth(routes) {
  const log = [];
  const storage = { getItem: () => "session-token", setItem() {}, removeItem() {} };
  const window = {
    location: { origin: "https://megaska.com", pathname: "/", search: "", href: "https://megaska.com/" },
    Shopify: { shop: "megaska.myshopify.com" },
    localStorage: storage,
    sessionStorage: storage,
    addEventListener() {},
    dispatchEvent() {},
  };
  window.window = window;
  const respond = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const context = {
    window,
    document: { readyState: "complete", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], cookie: "", documentElement: {}, body: {} },
    localStorage: storage,
    sessionStorage: storage,
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: async (url) => {
      const path = new URL(String(url), "https://megaska.com").pathname;
      log.push({ path, at: "start" });
      const route = Object.entries(routes).find(([key]) => path.endsWith(key));
      if (!route) throw new Error(`unexpected request ${path}`);
      const body = await route[1]();
      log.push({ path, at: "end" });
      return respond(body);
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    URL,
    URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
  };
  vm.runInNewContext(source, context);
  return { auth: window.MegaskaAuth, log };
}

const customer = { id: "cp_1", phoneE164: "+919876543210", email: "asha@example.com", shopifyCustomerId: "7", phoneVerifiedAt: "2026-10-23T10:00:00.000Z" };
const cart = { token: "c1-abc", checkout_url: "/checkouts/cn/c1-abc", item_count: 1 };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("the bag read when the OTP is sent is reused at checkout", async () => {
  let cartReads = 0;
  const { auth } = loadAuth({
    "/cart.js": () => { cartReads += 1; return cart; },
    "/cart/update.js": () => cart,
    "/checkout/prefill": () => ({ ok: true, checkoutUrl: "/checkouts/cn/c1-abc" }),
  });
  await auth.prefetchActiveCartContext();
  const result = await auth.applyBuyerIdentityToActiveCart(customer, { checkoutUrl: "/checkout" });
  assert.equal(result.ok, true);
  assert.equal(cartReads, 1);

  // The prefetched copy is used once; the next checkout reads the bag again.
  await auth.applyBuyerIdentityToActiveCart(customer, { checkoutUrl: "/checkout" });
  assert.equal(cartReads, 2);
});

test("the verified-phone write and the server prefill run at the same time", async () => {
  const attributes = deferred();
  const { auth, log } = loadAuth({
    "/cart.js": () => cart,
    "/cart/update.js": () => attributes.promise,
    "/checkout/prefill": () => ({ ok: true }),
  });
  const handoff = auth.applyBuyerIdentityToActiveCart(customer, { checkoutUrl: "/checkout" });
  await new Promise((done) => setTimeout(done, 5));
  // Prefill started (and finished) while the attribute write is still open.
  assert.ok(log.some((entry) => entry.path.endsWith("/checkout/prefill") && entry.at === "end"));
  assert.ok(!log.some((entry) => entry.path === "/cart/update.js" && entry.at === "end"));

  let settled = false;
  handoff.then(() => { settled = true; });
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(settled, false, "checkout must wait for the verified-phone write");

  attributes.resolve(cart);
  const result = await handoff;
  assert.equal(result.ok, true);
});

test("checkout still waits for the verified-phone write when the prefill request fails", async () => {
  const attributes = deferred();
  const { auth } = loadAuth({
    "/cart.js": () => cart,
    "/cart/update.js": () => attributes.promise,
    "/checkout/prefill": () => { throw new Error("network down"); },
  });
  let outcome = null;
  const handoff = auth.applyBuyerIdentityToActiveCart(customer, { checkoutUrl: "/checkout" }).then(
    () => { outcome = "resolved"; },
    (error) => { outcome = error.message; }
  );
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(outcome, null);
  attributes.resolve(cart);
  await handoff;
  assert.equal(outcome, "network down");
});
