import { getMerchantOtpSettings } from "../settings/merchant-otp.ts";
import {
  buildPublicOtpCountryPolicy,
  INDIA_ONLY_PUBLIC_OTP_POLICY,
  type PublicOtpCountryPolicy,
} from "../settings/otp-country-policy-public.ts";

type OtpCountrySettings = {
  defaultCountryCode: string;
  allowedCountryCodes: readonly string[];
};

export async function getPublicOtpCountryPolicy(
  shopId: string,
  loadSettings: (shopId: string) => Promise<OtpCountrySettings> = getMerchantOtpSettings,
): Promise<PublicOtpCountryPolicy> {
  try {
    const settings = await loadSettings(shopId);
    return buildPublicOtpCountryPolicy({
      defaultCountryCode: settings.defaultCountryCode,
      allowedCountryCodes: settings.allowedCountryCodes,
      onUnknownCountryCode: (countryCode) => console.warn("[LoopDesk Runtime Config] unknown OTP country omitted", { shopId, countryCode, operation: "build_public_otp_country_policy" }),
    });
  } catch (error) {
    console.error("[LoopDesk Runtime Config] OTP country policy unavailable", { shopId, operation: "build_public_otp_country_policy", error });
    return { ...INDIA_ONLY_PUBLIC_OTP_POLICY, allowedCountries: INDIA_ONLY_PUBLIC_OTP_POLICY.allowedCountries.map((country) => ({ ...country })) };
  }
}
