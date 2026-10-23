import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp-src/loopd2c-auth.js", import.meta.url), "utf8");

// Loads the auth script with a stored session token. `answers` are the responses to
// /auth/session in order: [status, body, contentType], or an Error to make fetch reject.
function loadAuth(answers) {
  const store = new Map([["megaska_session_token", "tok-1"]]);
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const queue = [...answers];
  let calls = 0;
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
    fetch: async () => {
      calls += 1;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      const [status, body, contentType] = next || [500, "", "text/plain"];
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
        text: async () => body,
      };
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    URL,
    URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Event: class { constructor(type) { this.type = type; } },
  };
  vm.runInNewContext(source, context);
  const tokenKept = () => Array.from(store.values()).includes("tok-1");
  return { auth: window.MegaskaAuth, tokenKept, calls: () => calls };
}

const json = (status, body) => [status, JSON.stringify(body), "application/json"];
const signedIn = json(200, { authenticated: true, customer: { id: "cp1", phoneE164: "+919876543210" } });

test("a valid session stays signed in", async () => {
  const { auth, tokenKept } = loadAuth([signedIn]);
  const session = await auth.fetchSession();
  assert.equal(session.authenticated, true);
  assert.equal(tokenKept(), true);
});

test("the server saying the session is invalid (401) signs the customer out", async () => {
  const { auth, tokenKept, calls } = loadAuth([json(401, { authenticated: false, error: "Invalid or expired session" })]);
  const session = await auth.fetchSession();
  assert.equal(session.authenticated, false);
  assert.equal(tokenKept(), false);
  assert.equal(calls(), 1, "an invalid session is not retried");
});

test("a JSON answer with authenticated: false signs the customer out", async () => {
  const { auth, tokenKept } = loadAuth([json(200, { authenticated: false })]);
  assert.equal((await auth.fetchSession()).authenticated, false);
  assert.equal(tokenKept(), false);
});

test("a request cut off by leaving the page keeps the session", async () => {
  const aborted = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
  const { auth, tokenKept } = loadAuth([aborted, new TypeError("Load failed")]);
  const session = await auth.fetchSession();
  assert.equal(session.authenticated, false);
  assert.equal(session.unavailable, true);
  assert.equal(tokenKept(), true);
});

test("a server error or an app-proxy gateway page keeps the session", async () => {
  const serverError = loadAuth([json(500, { authenticated: false, error: "Internal error" }), json(500, { authenticated: false })]);
  assert.equal((await serverError.auth.fetchSession()).unavailable, true);
  assert.equal(serverError.tokenKept(), true);

  const gateway = loadAuth([[504, "<html>Gateway timeout</html>", "text/html"], [502, "<html>Bad gateway</html>", "text/html"]]);
  assert.equal((await gateway.auth.fetchSession()).unavailable, true);
  assert.equal(gateway.tokenKept(), true);
});

test("a check that fails once and then answers keeps the customer signed in", async () => {
  const { auth, tokenKept, calls } = loadAuth([[504, "<html>Gateway timeout</html>", "text/html"], signedIn]);
  const session = await auth.fetchSession();
  assert.equal(session.authenticated, true);
  assert.equal(tokenKept(), true);
  assert.equal(calls(), 2);
});
