import "server-only";

type EnvironmentSource = NodeJS.ProcessEnv;

const warnedAliases = new Set<string>();

function value(source: EnvironmentSource, name: string) {
  return String(source[name] ?? "").trim();
}

function deprecatedAlias(source: EnvironmentSource, canonical: string, legacy: string) {
  const canonicalValue = value(source, canonical);
  if (canonicalValue) return canonicalValue;
  const legacyValue = value(source, legacy);
  if (legacyValue && !warnedAliases.has(legacy)) {
    warnedAliases.add(legacy);
    console.warn(`[CONFIG] ${legacy} is deprecated; configure ${canonical} instead.`);
  }
  return legacyValue;
}

function enabled(source: EnvironmentSource, name: string) {
  return value(source, name).toLowerCase() === "true";
}

export function readPlatformEnvironment(source: EnvironmentSource = process.env) {
  const production = value(source, "VERCEL_ENV") === "production" || value(source, "NODE_ENV") === "production";
  const dangerousDevelopmentFlags = [
    "LOOPDESK_DEV_OR_E2E_ENABLED",
    "LOOPDESK_DEV_DELIVERY_ENABLED",
    "ALLOW_TEST_ENV_WALLET_DELIVERY",
    "BILLING_UAT_CONTROLS_ENABLED",
    "BILLING_UAT_SHOPIFY_TEST_MODE",
  ].filter((name) => enabled(source, name));

  if (production && dangerousDevelopmentFlags.length) {
    throw new Error("Development tooling cannot be enabled in production");
  }

  const twilioAccountSid = value(source, "TWILIO_ACCOUNT_SID");
  const twilioAuthToken = value(source, "TWILIO_AUTH_TOKEN");
  const twilioVerifyServiceSid = value(source, "TWILIO_VERIFY_SERVICE_SID");

  return Object.freeze({
    production,
    databaseUrl: value(source, "DATABASE_URL"),
    directDatabaseUrl: value(source, "DIRECT_URL"),
    databasePoolMax: value(source, "DATABASE_POOL_MAX"),
    appBaseUrl: value(source, "APP_BASE_URL") || value(source, "SHOPIFY_APP_URL") || value(source, "NEXT_PUBLIC_APP_URL"),
    sessionSecret: deprecatedAlias(source, "LOOPDESK_SESSION_SECRET", "MEGASKA_CUSTOM_SESSION_SECRET") || value(source, "SESSION_SECRET"),
    shopify: Object.freeze({
      apiKey: value(source, "SHOPIFY_API_KEY"),
      apiSecret: value(source, "SHOPIFY_API_SECRET"),
      scopes: value(source, "SHOPIFY_SCOPES"),
      tokenEncryptionKey: value(source, "SHOPIFY_TOKEN_ENCRYPTION_KEY"),
      webhookSecret: value(source, "SHOPIFY_WEBHOOK_SECRET"),
    }),
    platformOtpFallback: Object.freeze({
      configured: Boolean(twilioAccountSid && twilioAuthToken && twilioVerifyServiceSid),
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      verifyServiceSid: twilioVerifyServiceSid,
    }),
  });
}

export type PlatformEnvironment = ReturnType<typeof readPlatformEnvironment>;
export const platformEnvironment = readPlatformEnvironment();

export function validateProductionPlatformEnvironment(environment: PlatformEnvironment = platformEnvironment) {
  if (!environment.production) return;
  const missing = [
    ["DATABASE_URL", environment.databaseUrl],
    ["APP_BASE_URL", environment.appBaseUrl],
    ["SHOPIFY_API_KEY", environment.shopify.apiKey],
    ["SHOPIFY_API_SECRET", environment.shopify.apiSecret],
    ["SHOPIFY_TOKEN_ENCRYPTION_KEY", environment.shopify.tokenEncryptionKey],
  ].filter(([, configured]) => !configured).map(([name]) => name);
  if (missing.length) throw new Error(`Missing required platform configuration: ${missing.join(", ")}`);
}
