import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../megaska-otp-src/loopd2c-otp.js", import.meta.url), "utf8");

// The resume helpers, run on their own with a fake localStorage, the modal state and the
// pending action they read.
function loadResume({ pendingAction = null, now = 1_800_000_000_000 } = {}) {
  const start = source.indexOf("  const OTP_RESUME_KEY");
  const end = source.indexOf("  let checkoutInterceptionEnabled");
  assert.ok(start > 0 && end > start, "resume helpers must sit between pendingAction and checkoutInterceptionEnabled");
  const store = new Map();
  const context = {
    window: {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
      },
    },
    Date: { now: () => context.clock },
    clock: now,
    JSON,
    Number,
    Object,
    state: {
      phoneDigits: "9876543210",
      normalizedPhone: "+919876543210",
      otpRequestPhoneInput: "9876543210",
      otpRequestCountryCode: "IN",
      otpRequestPhoneE164: "+919876543210",
      otpChannel: "whatsapp",
      smsFallbackAvailable: true,
    },
    pendingAction,
  };
  vm.runInNewContext(`${source.slice(start, end)}; this.api = { saveOtpResume, clearOtpResume, readOtpResume };`, context);
  return { ...context.api, store, context };
}

test("a sent code is remembered with the pending checkout, never the code itself", () => {
  const { saveOtpResume, readOtpResume, store } = loadResume({ pendingAction: { type: "navigate", url: "/checkout" } });
  saveOtpResume();
  const saved = JSON.parse(store.get("megaska_otp_resume"));
  assert.equal(saved.checkoutUrl, "/checkout");
  assert.equal(saved.normalizedPhone, "+919876543210");
  assert.ok(!("otp" in saved) && !("code" in saved) && !("otpDigits" in saved));
  assert.equal(readOtpResume().checkoutUrl, "/checkout");
});

test("the note expires with the code (5 minutes) and is then removed", () => {
  const { saveOtpResume, readOtpResume, store, context } = loadResume();
  saveOtpResume();
  context.clock += 4 * 60 * 1000;
  assert.ok(readOtpResume());
  context.clock += 2 * 60 * 1000;
  assert.equal(readOtpResume(), null);
  assert.equal(store.has("megaska_otp_resume"), false);
});

test("only same-site checkout paths are resumed; other pending actions are not", () => {
  const offsite = loadResume({ pendingAction: { type: "navigate", url: "//evil.example/checkout" } });
  offsite.saveOtpResume();
  assert.equal(offsite.readOtpResume().checkoutUrl, "");

  const buyNow = loadResume({ pendingAction: { type: "buy-now-submit", form: {} } });
  buyNow.saveOtpResume();
  assert.equal(buyNow.readOtpResume().checkoutUrl, "");

  const tampered = loadResume();
  tampered.store.set("megaska_otp_resume", JSON.stringify({ savedAt: tampered.context.clock, normalizedPhone: "+91", otpRequestPhoneInput: "1", otpRequestCountryCode: "IN", checkoutUrl: "https://evil.example" }));
  assert.equal(tampered.readOtpResume().checkoutUrl, "");
});

test("a broken or incomplete note is ignored", () => {
  const { readOtpResume, store, context } = loadResume();
  store.set("megaska_otp_resume", "{not json");
  assert.equal(readOtpResume(), null);
  store.set("megaska_otp_resume", JSON.stringify({ savedAt: context.clock, normalizedPhone: "" }));
  assert.equal(readOtpResume(), null);
  assert.equal(store.has("megaska_otp_resume"), false);
});

test("the note is saved on every send and cleared on close, number edit and login", () => {
  const body = (name) => {
    const at = source.indexOf(`function ${name}(`);
    assert.ok(at > 0, `${name} must exist`);
    return source.slice(at, source.indexOf("\n  }\n", at));
  };
  assert.match(body("applyOtpDeliveryChannel"), /saveOtpResume\(\)/);
  assert.match(body("closeModal"), /clearOtpResume\(\)/);
  assert.match(body("handleEditPhone"), /clearOtpResume\(\)/);
  assert.match(source, /async function completeAuthenticatedLogin\(sessionCustomer, options\) \{[\s\S]*?clearOtpResume\(\);/);
  const init = body("init");
  assert.match(init, /resumeOtpAfterReload\(\)/);
  assert.match(init, /bindOtpReturnFocus\(\)/);
});

test("resuming restores the checkout and skips customers who are already signed in", () => {
  const at = source.indexOf("async function resumeOtpAfterReload(");
  const resume = source.slice(at, source.indexOf("\n  }\n", at));
  assert.match(resume, /if \(gate\.authenticated\) \{\s*clearOtpResume\(\);/);
  assert.match(resume, /setPendingAction\(\{ type: "navigate", url: saved\.checkoutUrl \}\)/);
  assert.match(resume, /state\.step = "otp";/);
});

test("Paste code fills the 4 digits and submits; anything else asks to copy the code first", () => {
  const at = source.indexOf("async function handlePasteCodeClick(");
  const paste = source.slice(at, source.indexOf("\n  }\n", at));
  assert.match(paste, /navigator\.clipboard\.readText\(\)/);
  assert.match(paste, /digits\.length !== OTP_LENGTH/);
  assert.match(paste, /submitOtpIfReady\(\)/);
  assert.match(source, /data-megaska-paste-code hidden>Paste code<\/button>/);
});
