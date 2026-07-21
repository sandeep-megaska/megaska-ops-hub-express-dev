import { OTP_COUNTRY_CATALOG } from "./otp-country-catalog.ts";

export type PublicOtpCountry = {
  iso2: string;
  name: string;
  dialCode: string;
  flag: string;
};

export type PublicOtpCountryPolicy = {
  defaultCountryCode: string;
  allowedCountries: PublicOtpCountry[];
};

const COUNTRY_BY_CODE = new Map(
  OTP_COUNTRY_CATALOG.map((country) => [country.iso2, country]),
);

const INDIA_DEFINITION = COUNTRY_BY_CODE.get("IN");
if (!INDIA_DEFINITION) throw new Error("OTP country catalog must contain India.");

export const INDIA_ONLY_PUBLIC_OTP_POLICY: PublicOtpCountryPolicy = {
  defaultCountryCode: "IN",
  allowedCountries: [{ ...INDIA_DEFINITION }],
};

type PublicPolicyInput = {
  defaultCountryCode: string;
  allowedCountryCodes: readonly string[];
  onUnknownCountryCode?: (countryCode: string) => void;
};

export function resolveOtpCountriesForPublicPolicy(
  allowedCountryCodes: readonly string[],
  onUnknownCountryCode?: (countryCode: string) => void,
): PublicOtpCountry[] {
  const seen = new Set<string>();
  const countries: PublicOtpCountry[] = [];
  for (const countryCode of allowedCountryCodes) {
    if (seen.has(countryCode)) continue;
    seen.add(countryCode);
    const country = COUNTRY_BY_CODE.get(countryCode);
    if (!country) {
      onUnknownCountryCode?.(countryCode);
      continue;
    }
    countries.push({ ...country });
  }
  return countries;
}

export function buildPublicOtpCountryPolicy({
  defaultCountryCode,
  allowedCountryCodes,
  onUnknownCountryCode,
}: PublicPolicyInput): PublicOtpCountryPolicy {
  const allowedCountries = resolveOtpCountriesForPublicPolicy(
    allowedCountryCodes,
    onUnknownCountryCode,
  );
  if (allowedCountries.length === 0) {
    return {
      ...INDIA_ONLY_PUBLIC_OTP_POLICY,
      allowedCountries: INDIA_ONLY_PUBLIC_OTP_POLICY.allowedCountries.map((country) => ({ ...country })),
    };
  }
  return {
    defaultCountryCode: allowedCountries.some(({ iso2 }) => iso2 === defaultCountryCode)
      ? defaultCountryCode
      : allowedCountries[0].iso2,
    allowedCountries,
  };
}
