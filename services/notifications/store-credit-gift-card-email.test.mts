import assert from "node:assert/strict";
import test from "node:test";

const { buildGiftCardCodeText } = await import("./gift-card-email-copy.ts");

test("gift-card code email includes the code, greeting, and formatted balance", () => {
  const text = buildGiftCardCodeText({ customerName: "Aarav Mehta", code: "CWS3-22XE-PK6Q-VRA5", balanceMinor: 20850, currency: "INR" });
  assert.match(text, /^Hi Aarav,/);
  assert.ok(text.includes("CWS3-22XE-PK6Q-VRA5"), "must contain the full code");
  assert.ok(text.includes("INR 208.50"), "must show the balance in major units");
  assert.match(text, /Gift card/i);
});

test("falls back to a neutral greeting when no name is provided", () => {
  const text = buildGiftCardCodeText({ customerName: null, code: "AAAA-BBBB-CCCC-DDDD", balanceMinor: 10000, currency: "INR" });
  assert.match(text, /^Hi there,/);
  assert.ok(text.includes("INR 100.00"));
});
