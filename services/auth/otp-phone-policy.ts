import { normalizePhoneToE164 } from "../phone-international.ts";
import {
  getMerchantOtpSettings,
  type ResolvedMerchantOtpSettings,
} from "../settings/merchant-otp.ts";
import { OTP_COUNTRY_CATALOG } from "../settings/otp-country-catalog.ts";

type CountryCode = string;
const SUPPORTED_COUNTRY_CODES = new Set(
  OTP_COUNTRY_CATALOG.map(({ iso2 }) => iso2),
);

export type ResolveOtpPhoneForShopInput = {
  shopId: string;
  phone: unknown;
  countryCode?: unknown;
};

export type ResolvedOtpPhone = {
  phoneE164: string;
  countryCode: string;
};

export type OtpPhonePolicyFailureCode =
  | "PHONE_REQUIRED"
  | "INVALID_PHONE"
  | "INVALID_COUNTRY"
  | "COUNTRY_NOT_ALLOWED";

export class OtpPhonePolicyError extends Error {
  readonly code: OtpPhonePolicyFailureCode;
  readonly status: 400 | 403;

  constructor(
    message: string,
    code: OtpPhonePolicyFailureCode,
    status: 400 | 403,
  ) {
    super(message);
    this.name = "OtpPhonePolicyError";
    this.code = code;
    this.status = status;
  }
}

type SettingsLoader = (shopId: string) => Promise<ResolvedMerchantOtpSettings>;

export type OtpPhonePolicyDependencies = {
  getSettings?: SettingsLoader;
};

function policyError(code: OtpPhonePolicyFailureCode): OtpPhonePolicyError {
  switch (code) {
    case "PHONE_REQUIRED":
      return new OtpPhonePolicyError("Phone required", code, 400);
    case "INVALID_COUNTRY":
      return new OtpPhonePolicyError("Invalid country", code, 400);
    case "COUNTRY_NOT_ALLOWED":
      return new OtpPhonePolicyError(
        "OTP login is not available for this country.",
        code,
        403,
      );
    default:
      return new OtpPhonePolicyError("Invalid phone format", "INVALID_PHONE", 400);
  }
}

function selectedCountryCode(input: unknown): CountryCode {
  const value = input === undefined ? "IN" : input;
  if (typeof value !== "string") throw policyError("INVALID_COUNTRY");

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized) || !SUPPORTED_COUNTRY_CODES.has(normalized)) {
    throw policyError("INVALID_COUNTRY");
  }
  return normalized;
}

function normalizeSelectedPhone(
  input: ResolveOtpPhoneForShopInput,
  countryCode: CountryCode,
): ResolvedOtpPhone {
  const normalized = normalizePhoneToE164({ input: input.phone, countryCode });
  if (!normalized.ok) {
    throw policyError(
      normalized.reason === "PHONE_REQUIRED" ? "PHONE_REQUIRED" : "INVALID_PHONE",
    );
  }
  return { phoneE164: normalized.phoneE164, countryCode: normalized.countryCode };
}

export async function resolveOtpPhoneForShop(
  input: ResolveOtpPhoneForShopInput,
  dependencies: OtpPhonePolicyDependencies = {},
): Promise<ResolvedOtpPhone> {
  const countryCode = selectedCountryCode(input.countryCode);
  const settings = await (dependencies.getSettings ?? getMerchantOtpSettings)(input.shopId);

  if (!settings.allowedCountryCodes.includes(countryCode)) {
    console.warn("[OTP PHONE POLICY]", {
      operation: "country_rejected",
      shopId: input.shopId,
      countryCode,
    });
    throw policyError("COUNTRY_NOT_ALLOWED");
  }

  const resolved = normalizeSelectedPhone(input, countryCode);
  console.info("[OTP PHONE POLICY]", {
    operation: "request_allowed",
    shopId: input.shopId,
    countryCode,
  });
  return resolved;
}

export async function normalizeOtpPhoneForVerification(
  input: ResolveOtpPhoneForShopInput,
): Promise<ResolvedOtpPhone> {
  const countryCode = selectedCountryCode(input.countryCode);
  return normalizeSelectedPhone(input, countryCode);
}
