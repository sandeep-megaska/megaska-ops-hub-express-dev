import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp/assets/loopd2c-auth.js", import.meta.url), "utf8");

// Loads the auth script with `responses` as the storefront's answers to
// /otp/request, in order: [status, body, contentType].
function loadAuth(responses) {
  const calls = [];
  const queue = [...responses];
  const response = ([status, body, contentType]) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const window = {
    location: { origin: "https://megaska.com", pathname: "/", search: "", href: "https://megaska.com/" },
    Shopify: { shop: "megaska.myshopify.com" },
    localStorage: storage,
    sessionStorage: storage,
    addEventListener() {},
    dispatchEvent() {},
  };
  window.window = window;
  const context = {
    window,
    document: { readyState: "complete", addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], cookie: "", documentElement: {}, body: {} },
    localStorage: storage,
    sessionStorage: storage,
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: async (url) => { calls.push(String(url)); return response(queue.shift() || [500, "", "text/plain"]); },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    URL,
    URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
  };
  vm.runInNewContext(source, context);
  return { auth: window.MegaskaAuth, calls };
}

const html = [504, "<html><body>Gateway timeout</body></html>", "text/html"];
const json = (status, body) => [status, JSON.stringify(body), "application/json"];

test("an HTML gateway page is retried once and a normal send then succeeds", async () => {
  const { auth, calls } = loadAuth([html, json(200, { ok: true, sent: true })]);
  const result = await auth.requestOtp("9876543210", "IN");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test("a retry refused as too soon means the first code went out", async () => {
  const { auth } = loadAuth([html, json(429, { error: "Please wait 28s before requesting another code.", code: "OTP_RATE_LIMITED" })]);
  const result = await auth.requestOtp("9876543210", "IN");
  assert.equal(result.sent, true);
  assert.equal(result.recoveredFromGatewayError, true);
});

test("two gateway failures give a clear message; API errors are not retried", async () => {
  const twice = loadAuth([html, html]);
  await assert.rejects(twice.auth.requestOtp("9876543210", "IN"), /could not reach the login service/);

  const apiError = loadAuth([json(400, { error: "Enter a valid mobile number", code: "INVALID_PHONE" })]);
  await assert.rejects(apiError.auth.requestOtp("98", "IN"), /valid mobile number/);
  assert.equal(apiError.calls.length, 1);
});
