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

// Loss-framed prepaid nudge: name what the shopper gives up by choosing COD and
// offer a one-tap switch back to online payment.

test("the COD-vs-prepaid extra is the online payable subtracted from the COD payable", () => {
  const body = bodyOf(modalSource, "function codVsPrepaidExtraPaise");
  assert.match(body, /payableAmount\("COD"\)\s*-\s*payableAmount\("PREPAID"\)/, "extra must be COD payable minus prepaid payable");
  assert.match(body, /Math\.max\(0/, "extra must never go negative");
});

test("the nudge only appears when paying online is actually cheaper", () => {
  const body = bodyOf(modalSource, "function prepaidNudgeMarkup");
  assert.match(body, /codVsPrepaidExtraPaise\(\)/, "nudge must be driven by the real savings");
  assert.match(body, /if \(extra <= 0\) return "";/, "nudge must be suppressed when there is nothing to save");
  assert.match(body, /data-express-action="switch-to-prepaid"/, "nudge must offer the one-tap switch to online payment");
});

test("the COD confirm step renders the nudge", () => {
  const body = bodyOf(modalSource, "function renderCodAdvanceFields");
  assert.match(body, /\$\{prepaidNudgeMarkup\(\)\}<strong>Confirm Cash on Delivery/, "the plain-COD confirm must lead with the nudge");
});

test("the COD row is loss-framed as costing more than online", () => {
  const body = bodyOf(modalSource, "function paymentMethodRows");
  assert.match(body, /codExtra = method\.backendMethod === "COD" \? codVsPrepaidExtraPaise\(\)/, "COD row must compute the extra cost");
  assert.match(body, /more than paying online/, "COD row subtitle must state it costs more than paying online");
});

test("the switch-to-prepaid action moves the shopper to online payment", () => {
  assert.match(modalSource, /action === "switch-to-prepaid"[\s\S]{0,180}setSelectedDisplayPaymentMethod\("UPI"\)/, "the nudge button must switch the selected method to an online (UPI) method");
});
