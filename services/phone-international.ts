import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import { normalizeIndianPhone } from "./phone.ts";

export const MAX_PHONE_INPUT_LENGTH = 64;

export type NormalizePhoneToE164Input = {
  input: unknown;
  countryCode: unknown;
};

export type NormalizedPhoneFailureReason =
  | "PHONE_REQUIRED"
  | "COUNTRY_REQUIRED"
  | "INVALID_COUNTRY"
  | "INVALID_PHONE"
  | "COUNTRY_MISMATCH";

export type NormalizedPhoneResult =
  | {
      ok: true;
      phoneE164: string;
      countryCode: string;
      nationalNumber: string;
      callingCode: string;
    }
  | {
      ok: false;
      reason: NormalizedPhoneFailureReason;
    };

function failure(reason: NormalizedPhoneFailureReason): NormalizedPhoneResult {
  return { ok: false, reason };
}

function normalizeCountryCode(countryCode: unknown): CountryCode | NormalizedPhoneResult {
  if (countryCode == null || (typeof countryCode === "string" && !countryCode.trim())) {
    return failure("COUNTRY_REQUIRED");
  }

  if (typeof countryCode !== "string") return failure("INVALID_COUNTRY");

  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized) || !isSupportedCountry(normalized as CountryCode)) {
    return failure("INVALID_COUNTRY");
  }

  return normalized as CountryCode;
}

function successfulResult(
  phoneE164: string,
  countryCode: CountryCode,
): NormalizedPhoneResult {
  const parsed = parsePhoneNumberFromString(phoneE164);
  if (!parsed) return failure("INVALID_PHONE");

  return {
    ok: true,
    phoneE164,
    countryCode,
    nationalNumber: parsed.nationalNumber,
    callingCode: parsed.countryCallingCode,
  };
}

export function normalizePhoneToE164({
  input,
  countryCode,
}: NormalizePhoneToE164Input): NormalizedPhoneResult {
  const selectedCountry = normalizeCountryCode(countryCode);
  if (typeof selectedCountry !== "string") return selectedCountry;

  if (input == null || (typeof input === "string" && !input.trim())) {
    return failure("PHONE_REQUIRED");
  }
  if (typeof input !== "string") return failure("INVALID_PHONE");

  const phoneInput = input.trim();
  if (phoneInput.length > MAX_PHONE_INPUT_LENGTH || !/\d/.test(phoneInput)) {
    return failure("INVALID_PHONE");
  }

  // Explicit international input is resolved without a default country. Requiring
  // the parser's exact ISO result also fails closed for shared calling codes.
  if (phoneInput.startsWith("+")) {
    const internationalPhone = parsePhoneNumberFromString(phoneInput);
    if (!internationalPhone) return failure("INVALID_PHONE");
    if (!internationalPhone.country || internationalPhone.country !== selectedCountry) {
      return failure("COUNTRY_MISMATCH");
    }
    if (selectedCountry !== "IN" && !internationalPhone.isValid()) {
      return failure("INVALID_PHONE");
    }
  }

  if (selectedCountry === "IN") {
    const phoneE164 = normalizeIndianPhone(input);
    return phoneE164 ? successfulResult(phoneE164, selectedCountry) : failure("INVALID_PHONE");
  }

  const parsed = parsePhoneNumberFromString(phoneInput, selectedCountry);
  if (!parsed || !parsed.isValid()) return failure("INVALID_PHONE");
  if (!parsed.country || parsed.country !== selectedCountry) {
    return failure(phoneInput.startsWith("+") ? "COUNTRY_MISMATCH" : "INVALID_PHONE");
  }

  return successfulResult(parsed.number, selectedCountry);
}

export function normalizePhoneToE164OrNull(
  input: NormalizePhoneToE164Input,
): string | null {
  const result = normalizePhoneToE164(input);
  return result.ok ? result.phoneE164 : null;
}
