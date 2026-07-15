import { normalizeIndianPhone as normalizeIndianPhoneE164 } from "../phone";

export type OtpProvider = "twilio" | "msg91" | "mock";

type Msg91SendResult = {
  status: string;
  message: string;
};

type Msg91VerifyResult = {
  status: string;
  valid: boolean;
  message: string;
};

type TwilioSendResult = {
  status: string;
  sid: string | null;
  message: string;
};

type TwilioVerifyResult = {
  status: string;
  valid: boolean;
  sid: string | null;
  message: string;
};

type OtpProviderConfigStatus = {
  twilio: { configured: boolean; hasAccountSid: boolean; hasAuthToken: boolean; hasVerifyServiceSid: boolean };
  msg91: { configured: boolean; hasAuthKey: boolean; hasTemplateId: boolean };
  mock: { configured: true };
};

const MSG91_OTP_API_BASE = "https://control.msg91.com/api/v5/otp";
const TWILIO_VERIFY_API_BASE = "https://verify.twilio.com/v2/Services";
const OTP_PROVIDER_DEFAULT_ORDER: OtpProvider[] = ["twilio", "msg91", "mock"];

function getMsg91Config() {
  const authKey = process.env.MSG91_AUTH_KEY?.trim() || "";
  const templateId = process.env.MSG91_TEMPLATE_ID?.trim() || "";
  const hasAuthKey = Boolean(authKey);
  const hasTemplateId = Boolean(templateId);
  const configured = Boolean(authKey && templateId);

  return {
    authKey,
    templateId,
    hasAuthKey,
    hasTemplateId,
    configured,
  };
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim() || "";
  const hasAccountSid = Boolean(accountSid);
  const hasAuthToken = Boolean(authToken);
  const hasVerifyServiceSid = Boolean(verifyServiceSid);
  const configured = Boolean(accountSid && authToken && verifyServiceSid);

  return {
    accountSid,
    authToken,
    verifyServiceSid,
    hasAccountSid,
    hasAuthToken,
    hasVerifyServiceSid,
    configured,
  };
}

function getProviderConfigStatus(): OtpProviderConfigStatus {
  const twilio = getTwilioConfig();
  const msg91 = getMsg91Config();

  return {
    twilio: {
      configured: twilio.configured,
      hasAccountSid: twilio.hasAccountSid,
      hasAuthToken: twilio.hasAuthToken,
      hasVerifyServiceSid: twilio.hasVerifyServiceSid,
    },
    msg91: {
      configured: msg91.configured,
      hasAuthKey: msg91.hasAuthKey,
      hasTemplateId: msg91.hasTemplateId,
    },
    mock: {
      configured: true,
    },
  };
}

function normalizeProviderEnv(input: string | undefined): OtpProvider | null {
  if (!input) return null;
  if (input === "twilio" || input === "msg91" || input === "mock") return input;
  return null;
}

function isProviderConfigured(provider: OtpProvider, configStatus: OtpProviderConfigStatus): boolean {
  return configStatus[provider].configured;
}

export function getOtpProviderFallbackOrder(): OtpProvider[] {
  const otpProviderEnv = process.env.OTP_PROVIDER?.trim();
  const explicitProvider = normalizeProviderEnv(otpProviderEnv);
  const configStatus = getProviderConfigStatus();

  console.info("[OTP PROVIDER] Config presence", {
    otpProviderEnv: otpProviderEnv || null,
    parsedExplicitProvider: explicitProvider,
    providers: configStatus,
  });

  if (otpProviderEnv && !explicitProvider) {
    console.warn("[OTP PROVIDER] OTP_PROVIDER has unsupported value, falling back to default order", {
      otpProviderEnv,
      fallbackOrder: OTP_PROVIDER_DEFAULT_ORDER,
    });
  }

  if (explicitProvider) {
    if (isProviderConfigured(explicitProvider, configStatus)) {
      console.info("[OTP PROVIDER] Explicit provider selected", {
        provider: explicitProvider,
      });
      return [explicitProvider];
    }

    const fallbackOrder = OTP_PROVIDER_DEFAULT_ORDER.filter((provider) => provider !== explicitProvider);
    console.warn("[OTP PROVIDER] Explicit provider not configured, using fallback order", {
      provider: explicitProvider,
      fallbackOrder,
    });

    return fallbackOrder;
  }

  console.info("[OTP PROVIDER] Using default provider fallback order", {
    fallbackOrder: OTP_PROVIDER_DEFAULT_ORDER,
  });

  return [...OTP_PROVIDER_DEFAULT_ORDER];
}

export function getOtpProvider(): OtpProvider {
  const configStatus = getProviderConfigStatus();

  for (const provider of getOtpProviderFallbackOrder()) {
    if (isProviderConfigured(provider, configStatus)) {
      return provider;
    }
  }

  return "mock";
}

function getMsg91Mobile(phoneE164: string) {
  return phoneE164.replace(/\D/g, "").replace(/^\+/, "");
}

async function parseMsg91Response(response: Response) {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const payloadRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const message = [
    typeof payloadRecord?.message === "string" ? payloadRecord.message : "",
    typeof payloadRecord?.detail === "string" ? payloadRecord.detail : "",
    typeof payloadRecord?.error === "string" ? payloadRecord.error : "",
  ].find(Boolean) || `MSG91 OTP request failed (${response.status})`;

  const code = typeof payloadRecord?.code === "number" ? payloadRecord.code : response.status;

  return { message, code, payload: payloadRecord };
}

async function parseTwilioResponse(response: Response) {
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const payloadRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const message =
    (typeof payloadRecord?.message === "string" && payloadRecord.message) ||
    (typeof payloadRecord?.detail === "string" && payloadRecord.detail) ||
    `Twilio Verify request failed (${response.status})`;

  return { message, payload: payloadRecord };
}

function getTwilioAuthHeader(accountSid: string, authToken: string) {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  return `Basic ${auth}`;
}

export async function sendOtpWithTwilio(phoneE164: string): Promise<TwilioSendResult> {
  const twilioConfig = getTwilioConfig();

  if (!twilioConfig.configured) {
    throw new Error("Twilio OTP provider is not configured");
  }

  const response = await fetch(
    `${TWILIO_VERIFY_API_BASE}/${twilioConfig.verifyServiceSid}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthHeader(twilioConfig.accountSid, twilioConfig.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: phoneE164,
        Channel: "sms",
      }),
      cache: "no-store",
    }
  );

  const twilioResponse = await parseTwilioResponse(response);

  console.info("[OTP TWILIO SEND RESPONSE]", {
    statusCode: response.status,
    ok: response.ok,
    providerStatus: String((twilioResponse.payload as Record<string, unknown> | null)?.status ?? "unknown"),
    hasSid: typeof (twilioResponse.payload as Record<string, unknown> | null)?.sid === "string",
  });

  if (!response.ok) {
    throw new Error(twilioResponse.message);
  }

  return {
    status: String((twilioResponse.payload as Record<string, unknown> | null)?.status ?? "pending"),
    sid: typeof (twilioResponse.payload as Record<string, unknown> | null)?.sid === "string"
      ? ((twilioResponse.payload as Record<string, unknown>).sid as string)
      : null,
    message: twilioResponse.message,
  };
}

export async function verifyOtpWithTwilio(phoneE164: string, otpCode: string): Promise<TwilioVerifyResult> {
  const twilioConfig = getTwilioConfig();

  if (!twilioConfig.configured) {
    throw new Error("Twilio OTP provider is not configured");
  }

  const response = await fetch(
    `${TWILIO_VERIFY_API_BASE}/${twilioConfig.verifyServiceSid}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: getTwilioAuthHeader(twilioConfig.accountSid, twilioConfig.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: phoneE164,
        Code: otpCode,
      }),
      cache: "no-store",
    }
  );

  const twilioResponse = await parseTwilioResponse(response);
  const status = String((twilioResponse.payload as Record<string, unknown> | null)?.status ?? "failed");
  const valid = response.ok && status === "approved";

  console.info("[OTP TWILIO VERIFY RESPONSE]", {
    statusCode: response.status,
    ok: response.ok,
    verifyStatus: status,
    valid,
    hasSid: typeof (twilioResponse.payload as Record<string, unknown> | null)?.sid === "string",
  });

  return {
    status,
    valid,
    sid: typeof (twilioResponse.payload as Record<string, unknown> | null)?.sid === "string"
      ? ((twilioResponse.payload as Record<string, unknown>).sid as string)
      : null,
    message: twilioResponse.message,
  };
}

export async function sendOtpWithMsg91(phoneE164: string): Promise<Msg91SendResult> {
  const { authKey, templateId, configured } = getMsg91Config();

  if (!configured) {
    throw new Error("MSG91 OTP provider is not configured");
  }

  const mobile = getMsg91Mobile(phoneE164);
  const params = new URLSearchParams({
    authkey: authKey,
    mobile,
    template_id: templateId,
  });

  const response = await fetch(`${MSG91_OTP_API_BASE}?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });

  const msg91Response = await parseMsg91Response(response);

  console.info("[OTP MSG91 SEND RESPONSE]", {
    statusCode: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    throw new Error(msg91Response.message);
  }

  return {
    status: "pending",
    message: msg91Response.message,
  };
}

export async function verifyOtpWithMsg91(phoneE164: string, otpCode: string): Promise<Msg91VerifyResult> {
  const { authKey, configured } = getMsg91Config();

  if (!configured) {
    throw new Error("MSG91 OTP provider is not configured");
  }

  const mobile = getMsg91Mobile(phoneE164);
  const params = new URLSearchParams({
    mobile,
    otp: otpCode,
  });

  const response = await fetch(`${MSG91_OTP_API_BASE}/verify?${params.toString()}`, {
    method: "GET",
    headers: {
      authkey: authKey,
    },
    cache: "no-store",
  });

  const msg91Response = await parseMsg91Response(response);

  console.info("[OTP MSG91 VERIFY RESPONSE]", {
    statusCode: response.status,
    ok: response.ok,
  });

  return {
    status: response.ok ? "approved" : "failed",
    valid: response.ok,
    message: msg91Response.message,
  };
}

export function normalizeIndianPhone(input: string) {
  return normalizeIndianPhoneE164(input);
}
