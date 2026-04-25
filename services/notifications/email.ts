import { sendAdminAlert } from "./resend";

type SendResult = {
  skipped: boolean;
  success?: boolean;
  messageId?: string | null;
};

function parseRecipients(value: string | null | undefined) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function getCustomerMailConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.CUSTOMER_NOTIFICATION_FROM_EMAIL || process.env.OPS_NOTIFICATION_FROM_EMAIL || "").trim();
  return {
    apiKey,
    from,
    enabled: Boolean(apiKey && from),
  };
}

export async function sendOpsAlert(subject: string, text: string): Promise<SendResult> {
  return sendAdminAlert(subject, text);
}

export async function sendCustomerEmail(
  to: string | null | undefined,
  subject: string,
  text: string
): Promise<SendResult> {
  const recipient = parseRecipients(to).slice(0, 1);
  const config = getCustomerMailConfig();

  if (!recipient.length || !config.enabled) {
    console.warn("[NOTIFY] Customer email config missing, skipping", {
      hasApiKey: Boolean(config.apiKey),
      hasFrom: Boolean(config.from),
      hasRecipient: recipient.length > 0,
      subject,
    });
    return { skipped: true };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: recipient,
        subject,
        text,
      }),
    });

    const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;

    if (!response.ok) {
      throw new Error(data?.message || `Resend HTTP ${response.status}`);
    }

    return { skipped: false, success: true, messageId: data?.id || null };
  } catch (error) {
    console.error("[NOTIFY] Customer email send failed", {
      subject,
      to: recipient,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return { skipped: false, success: false };
  }
}
