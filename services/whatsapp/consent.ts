import { prisma } from "../db/prisma.ts";

// WhatsApp marketing/recovery consent, keyed by phone number. Stored as
// AuditEvents so opt-outs and opt-ins keep a full history; the latest event
// wins. Opt-outs arrive from the WhatsApp webhook (a customer replying STOP or
// tapping Meta's "Stop promotions" button).

export const WHATSAPP_OPT_OUT_EVENT = "whatsapp.opt_out" as const;
export const WHATSAPP_OPT_IN_EVENT = "whatsapp.opt_in" as const;
const ENTITY_TYPE = "WhatsAppContact";

type ConsentDb = {
  auditEvent: {
    findFirst(args: Record<string, unknown>): Promise<{ eventType: string } | null>;
    create(args: Record<string, unknown>): Promise<unknown>;
  };
};

// Digits only, with India's country code added to a bare 10-digit number, so
// "+91 96393 90404", "919639390404" and "9639390404" are the same contact.
export function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

const OPT_OUT_KEYWORDS = new Set(["stop", "stop all", "stop promotions", "unsubscribe", "opt out", "optout", "cancel"]);
const OPT_IN_KEYWORDS = new Set(["start", "subscribe", "resume promotions", "opt in", "optin"]);

export function consentKeyword(text: string | null | undefined): "opt_out" | "opt_in" | null {
  const normalized = String(text || "").trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (OPT_OUT_KEYWORDS.has(normalized)) return "opt_out";
  if (OPT_IN_KEYWORDS.has(normalized)) return "opt_in";
  return null;
}

export async function recordWhatsAppConsent(phone: string, action: "opt_out" | "opt_in", payload: Record<string, unknown>, db: ConsentDb = prisma as unknown as ConsentDb) {
  const contact = normalizeWhatsAppPhone(phone);
  if (!contact) return false;
  await db.auditEvent.create({
    data: { actorType: "customer", eventType: action === "opt_out" ? WHATSAPP_OPT_OUT_EVENT : WHATSAPP_OPT_IN_EVENT, entityType: ENTITY_TYPE, entityId: contact, payload: payload as never },
  });
  return true;
}

export async function isWhatsAppOptedOut(phone: string | null | undefined, db: ConsentDb = prisma as unknown as ConsentDb) {
  const contact = normalizeWhatsAppPhone(phone);
  if (!contact) return false;
  const latest = await db.auditEvent.findFirst({
    where: { entityType: ENTITY_TYPE, entityId: contact, eventType: { in: [WHATSAPP_OPT_OUT_EVENT, WHATSAPP_OPT_IN_EVENT] } },
    orderBy: { createdAt: "desc" },
    select: { eventType: true },
  });
  return latest?.eventType === WHATSAPP_OPT_OUT_EVENT;
}
