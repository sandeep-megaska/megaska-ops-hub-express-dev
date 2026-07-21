import test from "node:test";
import assert from "node:assert/strict";
import { OTP_COUNTRY_CATALOG } from "./otp-country-catalog.ts";

test("OTP country catalog contains required launch countries", () => {
  assert.ok(OTP_COUNTRY_CATALOG.length > 0);
  assert.deepEqual(
    OTP_COUNTRY_CATALOG.find(({ iso2 }) => iso2 === "IN"),
    { iso2: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" },
  );
  assert.equal(OTP_COUNTRY_CATALOG.find(({ iso2 }) => iso2 === "AE")?.dialCode, "+971");
  assert.equal(OTP_COUNTRY_CATALOG.find(({ iso2 }) => iso2 === "KW")?.dialCode, "+965");
});

test("OTP country catalog entries are public-safe and well formed", () => {
  for (const country of OTP_COUNTRY_CATALOG) {
    assert.match(country.iso2, /^[A-Z]{2}$/);
    assert.ok(country.name.trim());
    assert.match(country.dialCode, /^\+\d+$/);
    assert.ok(country.flag.trim());
  }
  const codes = OTP_COUNTRY_CATALOG.map(({ iso2 }) => iso2);
  assert.equal(new Set(codes).size, codes.length);
});

test("OTP country catalog has deterministic alphabetical ordering", () => {
  const names = OTP_COUNTRY_CATALOG.map(({ name }) => name);
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, "en")));
});
