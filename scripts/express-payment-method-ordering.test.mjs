import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modalSource = readFileSync("extensions/megaska-otp/assets/loopd2c-express-modal.js", "utf8");
const checkoutSource = readFileSync("assets/megaska-express-checkout.js", "utf8");

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, i);
  }
  throw new Error(`Could not parse ${name}`);
}

test("modal COD selection persists backend COD before loading COD policy", () => {
  const body = bodyOf(modalSource, "setSelectedDisplayPaymentMethod");
  const persist = body.indexOf("await ensureBackendPaymentMethod(backendMethod)");
  const verify = body.indexOf('state.intent?.selectedPaymentMethod !== backendMethod');
  const loadPolicy = body.indexOf('await loadCodPolicy("payment_method_select")');
  assert.ok(persist !== -1, "selection must await payment-method persistence");
  assert.ok(verify > persist, "selection must verify persisted intent after persistence");
  assert.ok(loadPolicy > verify, "COD policy must load only after persistence verification");
});

test("modal COD policy cannot load during unrelated persistence or while intent is still PREPAID", () => {
  const body = bodyOf(modalSource, "loadCodPolicy");
  assert.match(body, /state\.intent\?\.selectedPaymentMethod !== "COD"/, "policy load must require persisted COD intent");
  assert.match(body, /state\.paymentUpdating && !allowDuringPaymentUpdate/, "policy load must be blocked while unrelated payment method updates are in flight");
});

test("modal payment method remains locked until intended COD policy load finishes", () => {
  const body = bodyOf(modalSource, "setSelectedDisplayPaymentMethod");
  const loadPolicy = body.indexOf('await loadCodPolicy("payment_method_select")');
  const finallyIndex = body.indexOf("finally");
  const clearBeforeLoad = body.slice(0, loadPolicy).indexOf("state.paymentUpdating = false");
  const clearInFinally = body.indexOf("state.paymentUpdating = false", finallyIndex);
  assert.ok(loadPolicy !== -1, "COD policy must still load after COD persistence");
  assert.equal(clearBeforeLoad, -1, "paymentUpdating must not clear before the COD policy load");
  assert.ok(clearInFinally > finallyIndex, "paymentUpdating must clear in finally");
});

test("modal stale COD policy responses are discarded before mutating COD advance state", () => {
  const source = modalSource;
  const loadBody = bodyOf(source, "loadCodPolicy");
  const guardBody = bodyOf(source, "isCurrentCodPolicyRequest");
  const guardBeforeApply = loadBody.indexOf("if (!isCurrentCodPolicyRequest(requestId, requestIntentId)) return;");
  const apply = loadBody.indexOf("applyCodPolicyPayload(data)");
  assert.match(source, /codPolicyRequestId: 0/, "state must track COD policy request generation");
  assert.match(guardBody, /state\.codPolicyRequestId === requestId/, "guard must require latest COD policy request");
  assert.match(guardBody, /state\.intent\?\.id === requestIntentId/, "guard must require the same intent");
  assert.match(guardBody, /state\.intent\?\.selectedPaymentMethod === "COD"/, "guard must require persisted COD state");
  assert.match(guardBody, /selectedDisplayPaymentMethod\(\) === "COD"/, "guard must require visible COD state");
  assert.ok(guardBeforeApply !== -1 && guardBeforeApply < apply, "stale responses must be checked before applyCodPolicyPayload mutates COD advance state");
});

test("modal method switching rolls back and avoids COD policy on persistence failure", () => {
  const body = bodyOf(modalSource, "setSelectedDisplayPaymentMethod");
  const catchIndex = body.indexOf("catch (error)");
  const rollback = body.indexOf("state.selectedDisplayPaymentMethod = previousDisplayMethod", catchIndex);
  const reset = body.indexOf("resetCodAdvanceState()", catchIndex);
  const loadAfterCatch = body.indexOf("loadCodPolicy", catchIndex);
  assert.ok(rollback > catchIndex, "failure must restore previous visual method");
  assert.ok(reset > catchIndex, "failure must reset stale COD advance state");
  assert.equal(loadAfterCatch, -1, "failure path must not request COD policy");
});

test("modal duplicate method changes are blocked while paymentUpdating is true", () => {
  const body = bodyOf(modalSource, "setSelectedDisplayPaymentMethod");
  assert.match(body, /if \(state\.paymentUpdating\) return;/, "method switch must be ignored while already updating");
});

test("standalone checkout copy awaits payment-method response and blocks duplicate switches", () => {
  const setBody = bodyOf(checkoutSource, "setPaymentMethod");
  const ensureBody = bodyOf(checkoutSource, "ensurePaymentMethod");
  assert.match(setBody, /if \(state\.paymentUpdating\) return;/, "standalone checkout must block duplicate changes");
  assert.match(ensureBody, /const data = await apiFetch\([^\n]+\/payment-method/, "standalone checkout must await payment-method POST");
  assert.match(ensureBody, /if \(data\?\.intent\) state\.intent = data\.intent;/, "standalone checkout must use returned persisted intent");
});
