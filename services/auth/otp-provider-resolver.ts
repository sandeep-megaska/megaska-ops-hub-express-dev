// Server-only shop-aware OTP provider resolver. Keep transport-specific sends in otp.ts.
import {
  getMerchantOtpSettings,
  getPlatformTwilioConfigurationStatus,
  type MerchantOtpSettingsDb,
  type OtpProviderStatus,
} from "../settings/merchant-otp.ts";

export type RuntimeOtpProvider = "PLATFORM_TWILIO" | "MERCHANT_TWILIO" | "MERCHANT_MSG91" | "MOCK";

export type OtpProviderUnavailableReason =
  | "OTP_DISABLED"
  | "PLATFORM_TWILIO_NOT_CONFIGURED"
  | "MERCHANT_PROVIDER_NOT_ACTIVE"
  | "FALLBACK_DISABLED"
  | "UNSUPPORTED_PROVIDER"
  | "SHOP_UNRESOLVED";

export type OtpProviderResolution =
  | {
      available: true;
      shopId: string;
      provider: "PLATFORM_TWILIO";
      transportProvider: "twilio";
      usedFallback: boolean;
      settingsSource: "DEFAULTS" | "MERCHANT_SETTINGS";
    }
  | {
      available: false;
      shopId: string;
      reason: OtpProviderUnavailableReason;
    };

type ResolverOptions = { db?: MerchantOtpSettingsDb; env?: NodeJS.ProcessEnv };

function log(operation: string, details: Record<string, unknown>) {
  console.info("[OTP PROVIDER RESOLUTION]", { operation, ...details });
}

function isActive(status: OtpProviderStatus) {
  return status === "VERIFIED" || status === "ACTIVE";
}

function unavailable(shopId: string, reason: OtpProviderUnavailableReason, details: Record<string, unknown>): OtpProviderResolution {
  log(reason.toLowerCase(), { shopId, reason, ...details });
  return { available: false, shopId, reason };
}

function platformTwilio(shopId: string, usedFallback: boolean, settingsSource: "DEFAULTS" | "MERCHANT_SETTINGS", details: Record<string, unknown>): OtpProviderResolution {
  log(usedFallback ? "fallback_used" : "resolved", {
    shopId,
    resolvedProvider: "PLATFORM_TWILIO",
    transportProvider: "twilio",
    usedFallback,
    settingsSource,
    ...details,
  });
  return { available: true, shopId, provider: "PLATFORM_TWILIO", transportProvider: "twilio", usedFallback, settingsSource };
}

function fallbackOrUnavailable(
  shopId: string,
  settingsSource: "DEFAULTS" | "MERCHANT_SETTINGS",
  allowPlatformFallback: boolean,
  platformConfigured: boolean,
  details: Record<string, unknown>
): OtpProviderResolution {
  if (!allowPlatformFallback) return unavailable(shopId, "FALLBACK_DISABLED", details);
  if (!platformConfigured) return unavailable(shopId, "PLATFORM_TWILIO_NOT_CONFIGURED", details);
  return platformTwilio(shopId, true, settingsSource, details);
}

export async function resolveOtpProviderForShop(shopId: string, options: ResolverOptions = {}): Promise<OtpProviderResolution> {
  if (!shopId?.trim()) return unavailable(shopId, "SHOP_UNRESOLVED", {});

  let settings: Awaited<ReturnType<typeof getMerchantOtpSettings>>;
  try {
    settings = await getMerchantOtpSettings(shopId, options.db);
  } catch (error) {
    return unavailable(shopId, "SHOP_UNRESOLVED", { message: error instanceof Error ? error.message : "Unable to resolve shop" });
  }

  const platform = getPlatformTwilioConfigurationStatus(options.env);
  const settingsSource = settings.hasSettingsRow ? "MERCHANT_SETTINGS" : "DEFAULTS";
  const details = {
    providerMode: settings.providerMode,
    hasSettingsRow: settings.hasSettingsRow,
    allowPlatformFallback: settings.allowPlatformFallback,
  };

  if (!settings.otpEnabled) return unavailable(shopId, "OTP_DISABLED", details);

  if (settings.providerMode === "PLATFORM_TWILIO") {
    return platform.configured
      ? platformTwilio(shopId, false, settingsSource, details)
      : unavailable(shopId, "PLATFORM_TWILIO_NOT_CONFIGURED", details);
  }

  if (settings.providerMode === "MERCHANT_TWILIO") {
    return fallbackOrUnavailable(
      shopId,
      settingsSource,
      settings.allowPlatformFallback,
      platform.configured,
      { ...details, merchantTwilioStatus: settings.merchantTwilioStatus, merchantProviderActive: isActive(settings.merchantTwilioStatus) }
    );
  }

  if (settings.providerMode === "MERCHANT_MSG91") {
    return fallbackOrUnavailable(
      shopId,
      settingsSource,
      settings.allowPlatformFallback,
      platform.configured,
      { ...details, merchantMsg91Status: settings.merchantMsg91Status, merchantProviderActive: isActive(settings.merchantMsg91Status) }
    );
  }

  if (settings.providerMode === "MOCK") {
    if (options.env?.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
      return fallbackOrUnavailable(shopId, settingsSource, settings.allowPlatformFallback, platform.configured, details);
    }
    return fallbackOrUnavailable(shopId, settingsSource, settings.allowPlatformFallback, platform.configured, details);
  }

  return unavailable(shopId, "UNSUPPORTED_PROVIDER", details);
}
