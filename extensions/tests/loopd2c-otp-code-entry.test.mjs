import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp-src/loopd2c-otp.js", import.meta.url), "utf8");

// handleOtpInput on its own, with the modal state and the calls it makes recorded.
function loadCodeEntry(initialDigits = ["", "", "", ""]) {
  const start = source.indexOf("function handleOtpInput(");
  const end = source.indexOf("function handleOtpKeyDown(", start);
  assert.ok(start > 0 && end > start, "handleOtpInput must exist");
  const calls = { submitted: 0, focused: [] };
  const context = {
    OTP_LENGTH: 4,
    state: { otpDigits: [...initialDigits], errorMessage: "" },
    isModalOpen: () => true,
    renderStep() {},
    collectOtpDigits: () => context.state.otpDigits.join(""),
    submitOtpIfReady: () => { calls.submitted += 1; },
    focusOtpInput: (index) => calls.focused.push(index),
  };
  vm.runInNewContext(`${source.slice(start, end)}; this.handleOtpInput = handleOtpInput;`, context);
  const type = (index, value) => {
    const input = { dataset: { index: String(index) }, value };
    context.handleOtpInput({ target: input });
    return input;
  };
  return { type, state: context.state, calls };
}

test("the digit boxes have no one-character limit and the first offers the one-time code", () => {
  const markup = source.slice(source.indexOf("data-megaska-otp-inputs"), source.indexOf("data-megaska-paste-code"));
  assert.doesNotMatch(markup, /maxlength="1"/, "maxlength=1 cuts an inserted code down to its first digit");
  assert.match(markup, /autocomplete="\$\{index === 0 \? "one-time-code" : "off"\}"/);
});

test("a whole code inserted into the first box fills all four and submits (iPhone code suggestion)", () => {
  const { type, state, calls } = loadCodeEntry();
  type(0, "4821");
  assert.deepEqual(Array.from(state.otpDigits), ["4", "8", "2", "1"]);
  assert.equal(calls.submitted, 1);
});

test("a code with spaces or text around it still fills the boxes", () => {
  const { type, state, calls } = loadCodeEntry();
  type(0, "Code: 48 21");
  assert.deepEqual(Array.from(state.otpDigits), ["4", "8", "2", "1"]);
  assert.equal(calls.submitted, 1);
});

test("digits typed one by one move to the next box and submit on the fourth", () => {
  const { type, state, calls } = loadCodeEntry();
  type(0, "4");
  type(1, "8");
  type(2, "2");
  assert.equal(calls.submitted, 0);
  assert.deepEqual(calls.focused, [1, 2, 3]);
  type(3, "1");
  assert.deepEqual(Array.from(state.otpDigits), ["4", "8", "2", "1"]);
  assert.equal(calls.submitted, 1);
});

test("a digit typed before the cursor moved on goes into the next box", () => {
  const { type, state, calls } = loadCodeEntry(["4", "8", "", ""]);
  type(2, "21");
  assert.deepEqual(Array.from(state.otpDigits), ["4", "8", "2", "1"]);
  assert.equal(calls.submitted, 1);
});

test("a partial insert fills from that box and moves to the next empty one", () => {
  const { type, state, calls } = loadCodeEntry();
  type(0, "48");
  assert.deepEqual(Array.from(state.otpDigits), ["4", "8", "", ""]);
  assert.equal(calls.submitted, 0);
  assert.deepEqual(calls.focused, [2]);
});

test("letters are ignored", () => {
  const { type, state } = loadCodeEntry();
  type(0, "a");
  assert.deepEqual(Array.from(state.otpDigits), ["", "", "", ""]);
});
