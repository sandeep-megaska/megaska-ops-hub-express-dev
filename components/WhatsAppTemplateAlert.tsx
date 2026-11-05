import { accountErrorCode, ACCOUNT_ERRORS } from "../services/whatsapp/template-health";

// Shown while the merchant's WhatsApp template messages are failing at Meta.
export default function WhatsAppTemplateAlert({ since, error, phone }: { since: string | Date | null | undefined; error: string | null | undefined; phone?: string | null }) {
  if (!since) return null;
  const code = accountErrorCode(error);
  const advice = code ? ACCOUNT_ERRORS[code] : null;
  const started = new Date(since).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mk-alert mk-alert-error" role="alert" style={{ marginBottom: 16 }}>
      <strong>WhatsApp messages from {phone || "your number"} are failing (since {started}{code ? `, Meta error ${code}` : ""}).</strong>{" "}
      OTP login codes, order updates and nudges aren&apos;t reaching customers; replies in open chats still work, and OTPs go by SMS when SMS is allowed.{" "}
      {advice ? `${advice.cause} ${advice.fix}` : "Check the WhatsApp account in Meta Business Suite (billing, account quality)."}{" "}
      This clears on its own once a template message is delivered again.
    </div>
  );
}
