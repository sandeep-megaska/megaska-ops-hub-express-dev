// Server-only: settings and preview for the WhatsApp AI assistant
// (LoopD2C → WhatsApp Inbox → AI assistant).
import { prisma } from "../db/prisma.ts";
import { isAiConfigured } from "../ai/openai-client.ts";
import { askAssistant, assistantModel } from "../whatsapp/assistant/run.ts";
import { MAX_KNOWLEDGE_CHARS, normalizeAssistantMode, type AssistantMode, type AssistantResult } from "../whatsapp/assistant/policy.ts";

export class WhatsAppAssistantSettingsError extends Error {
  constructor(message: string) { super(message); this.name = "WhatsAppAssistantSettingsError"; }
}

type AccountDb = {
  merchantWhatsAppAccount: {
    findUnique(args: unknown): Promise<{ enabled: boolean; aiMode: string | null; aiKnowledge: string | null } | null>;
    update(args: unknown): Promise<unknown>;
  };
};

function db() { return prisma as unknown as AccountDb; }

export type WhatsAppAssistantAdmin = {
  numberConnected: boolean;
  numberEnabled: boolean;
  mode: AssistantMode;
  knowledge: string;
  aiConfigured: boolean;
  model: string;
};

export async function getWhatsAppAssistantAdmin(shopId: string): Promise<WhatsAppAssistantAdmin> {
  const account = await db().merchantWhatsAppAccount.findUnique({ where: { shopId }, select: { enabled: true, aiMode: true, aiKnowledge: true } }).catch(() => null);
  return {
    numberConnected: Boolean(account),
    numberEnabled: Boolean(account?.enabled),
    mode: normalizeAssistantMode(account?.aiMode),
    knowledge: account?.aiKnowledge ?? "",
    aiConfigured: isAiConfigured(),
    model: assistantModel(),
  };
}

export async function saveWhatsAppAssistant(shopId: string, input: { mode: unknown; knowledge: unknown }) {
  const account = await db().merchantWhatsAppAccount.findUnique({ where: { shopId }, select: { enabled: true, aiMode: true, aiKnowledge: true } });
  if (!account) throw new WhatsAppAssistantSettingsError("Connect your WhatsApp number first (Merchant Settings → WhatsApp).");
  const mode = normalizeAssistantMode(input.mode);
  const knowledge = String(input.knowledge ?? "").replace(/\r\n/g, "\n").trim();
  if (knowledge.length > MAX_KNOWLEDGE_CHARS) throw new WhatsAppAssistantSettingsError(`Store notes can be at most ${MAX_KNOWLEDGE_CHARS} characters (now ${knowledge.length}).`);
  if (mode !== "OFF" && !isAiConfigured()) throw new WhatsAppAssistantSettingsError("AI is not configured on the server (OPENAI_API_KEY), so the assistant can only stay off.");
  await db().merchantWhatsAppAccount.update({ where: { shopId }, data: { aiMode: mode, aiKnowledge: knowledge || null } });
  console.info("[WHATSAPP ASSISTANT SETTINGS]", { operation: "saved", shopId, mode, knowledgeChars: knowledge.length });
  return mode;
}

// Answers a sample question with the current notes and live store data, as
// the assistant would. Sends nothing to anyone.
export async function previewWhatsAppAssistant(input: { shopDomain: string; knowledge: string | null; question: string; testPhone?: string | null }): Promise<AssistantResult | null> {
  const question = String(input.question || "").trim().slice(0, 500);
  if (!question) throw new WhatsAppAssistantSettingsError("Type a question to try.");
  if (!isAiConfigured()) throw new WhatsAppAssistantSettingsError("AI is not configured on the server (OPENAI_API_KEY).");
  const phone = String(input.testPhone || "").replace(/\D/g, "");
  const { result } = await askAssistant({
    shopDomain: input.shopDomain,
    contactPhone: phone.length === 10 ? `91${phone}` : phone || "0",
    merchantNotes: input.knowledge,
    chat: [{ from: "customer", text: question }],
  });
  return result;
}
