import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_PHONE_INPUT_LENGTH,
  normalizePhoneToE164,
  normalizePhoneToE164OrNull,
} from "./phone-international.ts";
import { normalizeIndianPhone } from "./phone.ts";

test("India normalization preserves the legacy compatibility corridor", () => {
  const acceptedLegacyInputs = ["9876543210", "919876543210", "+91 98765 43210"];

  for (const input of acceptedLegacyInputs) {
    assert.equal(
      normalizePhoneToE164OrNull({ input, countryCode: "IN" }),
      normalizeIndianPhone(input),
    );
  }

  assert.deepEqual(normalizePhoneToE164({ input: "9876543210", countryCode: "IN" }), {
    ok: true,
    phoneE164: "+919876543210",
    countryCode: "IN",
    nationalNumber: "9876543210",
    callingCode: "91",
  });
  assert.deepEqual(normalizePhoneToE164({ input: "09876543210", countryCode: "IN" }), {
    ok: false,
    reason: "INVALID_PHONE",
  });
  assert.equal(normalizePhoneToE164OrNull({ input: "123", countryCode: "IN" }), null);

  const legacySource = readFileSync(new URL("./phone.ts", import.meta.url), "utf8");
  assert.match(legacySource, /export function normalizeIndianPhone/);
});

test("normalizes valid local and international examples", () => {
  assert.deepEqual(normalizePhoneToE164({ input: "050 123 4567", countryCode: "ae" }), {
    ok: true,
    phoneE164: "+971501234567",
    countryCode: "AE",
    nationalNumber: "501234567",
    callingCode: "971",
  });
  assert.equal(
    normalizePhoneToE164OrNull({ input: "+971 50-123-4567", countryCode: "AE" }),
    "+971501234567",
  );
  assert.equal(
    normalizePhoneToE164OrNull({ input: "5000 0000", countryCode: " kw " }),
    "+96550000000",
  );
  assert.equal(
    normalizePhoneToE164OrNull({ input: "(415) 555-2671", countryCode: "US" }),
    "+14155552671",
  );
});

test("rejects explicit international numbers that do not match the selected country", () => {
  assert.deepEqual(normalizePhoneToE164({ input: "+971501234567", countryCode: "IN" }), {
    ok: false,
    reason: "COUNTRY_MISMATCH",
  });
  assert.deepEqual(normalizePhoneToE164({ input: "+14155552671", countryCode: "AE" }), {
    ok: false,
    reason: "COUNTRY_MISMATCH",
  });
});

test("rejects missing, malformed, and unsupported countries", () => {
  for (const countryCode of ["IND", "91", "+91", "ZZ", "I1", {}, true]) {
    assert.deepEqual(normalizePhoneToE164({ input: "50000000", countryCode }), {
      ok: false,
      reason: "INVALID_COUNTRY",
    });
  }
  for (const countryCode of ["", "   ", null, undefined]) {
    assert.deepEqual(normalizePhoneToE164({ input: "50000000", countryCode }), {
      ok: false,
      reason: "COUNTRY_REQUIRED",
    });
  }
});

test("accepts strings only and applies defensive input limits", () => {
  for (const input of [{}, [], true, 1234567890]) {
    assert.deepEqual(normalizePhoneToE164({ input, countryCode: "US" }), {
      ok: false,
      reason: "INVALID_PHONE",
    });
  }
  for (const input of ["", "   ", null, undefined]) {
    assert.deepEqual(normalizePhoneToE164({ input, countryCode: "US" }), {
      ok: false,
      reason: "PHONE_REQUIRED",
    });
  }
  assert.deepEqual(
    normalizePhoneToE164({ input: "1".repeat(MAX_PHONE_INPUT_LENGTH + 1), countryCode: "US" }),
    { ok: false, reason: "INVALID_PHONE" },
  );
  assert.deepEqual(normalizePhoneToE164({ input: "phone", countryCode: "US" }), {
    ok: false,
    reason: "INVALID_PHONE",
  });
});

test("rejects impossible and invalid supported-country numbers", () => {
  for (const input of ["1", "12345678901234567890", "0000000000", "211234567"]) {
    assert.deepEqual(normalizePhoneToE164({ input, countryCode: "AE" }), {
      ok: false,
      reason: "INVALID_PHONE",
    });
  }
});

test("successful output is canonical, minimal, and deterministic", () => {
  const request = { input: "(415) 555-2671", countryCode: "us" } as const;
  const first = normalizePhoneToE164(request);
  const second = normalizePhoneToE164(request);

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  assert.match(first.phoneE164, /^\+\d+$/);
  assert.match(first.nationalNumber, /^\d+$/);
  assert.match(first.callingCode, /^\d+$/);
  assert.deepEqual(Object.keys(first).sort(), [
    "callingCode",
    "countryCode",
    "nationalNumber",
    "ok",
    "phoneE164",
  ]);
});
