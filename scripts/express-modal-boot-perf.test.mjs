import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync("extensions/megaska-otp/assets/loopd2c-express-modal.js", "utf8");

function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, i);
  }
  throw new Error(`Could not parse ${signature}`);
}

// The express-modal boot was a strict waterfall: auth -> cart -> create-intent ->
// store-credit -> render. Cart and store-credit don't belong on that critical
// path; these tests keep them off it.

test("cart fetch is started before auth and threaded into createIntent (parallel with auth)", () => {
  const body = bodyOf(modalSource, "async function open");
  const startCart = body.indexOf("const cartPromise = readCart()");
  const auth = body.indexOf("ensureAuthenticated(");
  const create = body.indexOf("createIntent(cartPromise)");
  assert.ok(startCart !== -1, "open() must start the cart fetch eagerly");
  assert.ok(startCart < auth, "cart fetch must be kicked off before awaiting auth so they overlap");
  assert.ok(create > auth, "createIntent must run after auth and consume the pre-started cart promise");
});

test("createIntent consumes a passed cart promise instead of always fetching", () => {
  assert.match(modalSource, /async function createIntent\(cartPromise\)/, "createIntent must accept a cart promise");
  const body = bodyOf(modalSource, "async function createIntent");
  assert.match(body, /await \(cartPromise \|\| readCart\(\)\)/, "createIntent must await the pre-started cart, falling back to its own fetch");
});

test("store credit does not block the modal from hydrating", () => {
  const body = bodyOf(modalSource, "async function createIntent");
  assert.doesNotMatch(body, /await loadStoreCredit\(\)/, "store credit must not be awaited on the boot path");
  assert.match(body, /void loadStoreCredit\(\)\.then\(/, "store credit must load in the background and re-render when ready");
  // The background load must be kicked off only after hydration is marked ready.
  const ready = body.indexOf('state.hydration.payment = "ready"');
  const bg = body.indexOf("void loadStoreCredit()");
  assert.ok(ready !== -1 && bg > ready, "store credit must load after the payment section is marked ready");
});
