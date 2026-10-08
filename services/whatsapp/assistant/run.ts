// Runs the WhatsApp AI assistant for one stored customer message. Called from
// the WhatsApp webhook after the response is sent (next/server `after`), so
// Meta never waits on OpenAI.
//
// Flow: wait a few seconds (customers often send several short messages) →
// gate (mode, pauses, handoffs, limits) → "typing…" → store facts from Shopify
// → OpenAI → send / draft / hand over to the team (email alert).

import { consentKeyword } from "../consent.ts";
import {
  assistantGate,
  buildSystemPrompt,
  buildUserPrompt,
  decideOutcome,
  normalizeAssistantMode,
  normalizeHandoffKind,
  parseAssistantResult,
  productSearchTerms,
  type AssistantMode,
  type AssistantResult,
  type HandoffKind,
  type ChatLine,
  type StoreContext,
} from "./policy.ts";

export const ASSISTANT_DEBOUNCE_MS = 4000;
const HOUR = 60 * 60 * 1000;

type Conversation = { id: string; shopId: string; businessPhoneNumberId: string; contactPhone: string; contactName: string | null; needsHuman: boolean; handoffKind?: string | null; aiPausedUntil: Date | null };
type Message = { id: string; direction: string; waMessageId: string | null; type: string; body: string | null; sentByAi?: boolean; createdAt: Date };

export type AssistantDb = {
  merchantWhatsAppAccount: { findUnique(args: unknown): Promise<{ shopId: string; enabled: boolean; aiMode?: string | null; aiKnowledge?: string | null } | null> };
  shop: { findUnique(args: unknown): Promise<{ id: string; shopDomain: string } | null> };
  whatsAppConversation: { findFirst(args: unknown): Promise<Conversation | null>; update(args: unknown): Promise<unknown> };
  whatsAppMessage: { findMany(args: unknown): Promise<Message[]>; count(args: unknown): Promise<number> };
};

export type AssistantDeps = {
  db?: AssistantDb;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  aiConfigured?: () => boolean;
  complete?: (input: { system: string; user: string }) => Promise<Record<string, unknown> | null>;
  loadContext?: (input: { shopDomain: string; contactPhone: string; searchTerms: string[]; merchantNotes: string | null }) => Promise<StoreContext>;
  sendText?: (input: { shopId: string; conversationId: string; text: string }) => Promise<unknown>;
  typing?: (input: { shopId: string; businessPhoneNumberId: string; waMessageId: string }) => Promise<unknown>;
  alert?: (input: { shopId: string; subject: string; text: string }) => Promise<unknown>;
};

export type AssistantRunResult = { status: string; outcome?: string; intent?: string };

async function defaultDb(): Promise<AssistantDb> {
  return (await import("../../db/prisma.ts")).prisma as unknown as AssistantDb;
}

export function assistantModel() {
  return String(process.env.OPENAI_WHATSAPP_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
}

const defaults = {
  aiConfigured: async () => (await import("../../ai/openai-client.ts")).isAiConfigured(),
  complete: async (input: { system: string; user: string }) =>
    (await import("../../ai/openai-client.ts")).openaiChatJson({ ...input, model: assistantModel(), maxTokens: 500, temperature: 0.3, timeoutMs: 25_000 }),
  loadContext: async (input: Parameters<NonNullable<AssistantDeps["loadContext"]>>[0]) => (await import("./store-context.ts")).loadStoreContext(input),
  sendText: async (input: { shopId: string; conversationId: string; text: string }) => (await import("../inbox.ts")).sendConversationText({ ...input, sentByAi: true }),
  typing: async (input: { shopId: string; businessPhoneNumberId: string; waMessageId: string }) => (await import("../inbox.ts")).showTypingIndicator(input),
  alert: async (input: { shopId: string; subject: string; text: string }) => {
    const { sendOpsAlert } = await import("../../notifications/email.ts");
    return sendOpsAlert({ shopId: input.shopId, eventType: "GENERAL", subject: input.subject, text: input.text });
  },
};

function inboxLink(shopDomain: string, conversationId: string) {
  const base = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
  return base ? `${base}/admin/whatsapp/${conversationId}?shop=${encodeURIComponent(shopDomain)}` : "LoopD2C → WhatsApp Inbox";
}

export function chatLines(messages: Message[]): ChatLine[] {
  return messages
    .filter((message) => (message.body || "").trim())
    .map((message) => ({ from: message.direction === "INBOUND" ? "customer" as const : "store" as const, text: String(message.body) }));
}

// Asks the model and returns the parsed answer (null when AI is unavailable or failed).
export async function askAssistant(
  input: { shopDomain: string; contactPhone: string; merchantNotes: string | null; chat: ChatLine[] },
  deps: Pick<AssistantDeps, "complete" | "loadContext"> = {},
): Promise<{ result: AssistantResult | null; context: StoreContext }> {
  const context = await (deps.loadContext ?? defaults.loadContext)({ shopDomain: input.shopDomain, contactPhone: input.contactPhone, searchTerms: productSearchTerms(input.chat), merchantNotes: input.merchantNotes });
  const raw = await (deps.complete ?? defaults.complete)({ system: buildSystemPrompt(context.storeName), user: buildUserPrompt(context, input.chat) });
  return { result: parseAssistantResult(raw), context };
}

export async function runWhatsAppAssistant(input: { shopId: string; conversationId: string; waMessageId: string }, deps: AssistantDeps = {}): Promise<AssistantRunResult> {
  const db = deps.db ?? (await defaultDb());
  const now = deps.now ?? (() => new Date());
  const account = await db.merchantWhatsAppAccount.findUnique({ where: { shopId: input.shopId } });
  const mode: AssistantMode = account?.enabled ? normalizeAssistantMode(account.aiMode) : "OFF";
  if (mode === "OFF") return { status: "skipped", outcome: "assistant_off" };

  await (deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(ASSISTANT_DEBOUNCE_MS);

  const conversation = await db.whatsAppConversation.findFirst({ where: { id: input.conversationId, shopId: input.shopId } });
  if (!conversation) return { status: "skipped", outcome: "conversation_missing" };
  const recent = (await db.whatsAppMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 20 })).reverse();
  const latestInbound = [...recent].reverse().find((message) => message.direction === "INBOUND");
  const trigger = recent.find((message) => message.waMessageId === input.waMessageId);
  if (!trigger) return { status: "skipped", outcome: "message_missing" };

  const at = now();
  const [aiRepliesLastHour, shopAiRepliesLastDay] = await Promise.all([
    db.whatsAppMessage.count({ where: { conversationId: conversation.id, sentByAi: true, createdAt: { gte: new Date(at.getTime() - HOUR) } } }),
    db.whatsAppMessage.count({ where: { sentByAi: true, createdAt: { gte: new Date(at.getTime() - 24 * HOUR) }, conversation: { shopId: input.shopId } } }),
  ]);
  const gate = assistantGate({
    mode,
    aiConfigured: await (deps.aiConfigured ?? defaults.aiConfigured)(),
    message: { type: trigger.type, body: trigger.body || "" },
    isConsentKeyword: Boolean(consentKeyword(trigger.body)),
    conversation: { needsHuman: conversation.needsHuman, handoffKind: conversation.handoffKind ?? null, aiPausedUntil: conversation.aiPausedUntil },
    newerInboundExists: Boolean(latestInbound && latestInbound.waMessageId !== input.waMessageId),
    lastStoreMessageAskedQuestion: /\?\s*\S{0,3}\s*$/.test(String([...recent].filter((message) => message.direction === "OUTBOUND" && message.createdAt <= trigger.createdAt).pop()?.body ?? "")),
    aiRepliesLastHour,
    shopAiRepliesLastDay,
    now: at,
  });
  if (gate.action === "skip") return { status: "skipped", outcome: gate.reason };

  const shop = await db.shop.findUnique({ where: { id: input.shopId }, select: { id: true, shopDomain: true } });
  if (!shop) return { status: "skipped", outcome: "shop_missing" };
  const sendText = deps.sendText ?? defaults.sendText;
  const alert = deps.alert ?? defaults.alert;
  const who = conversation.contactName || `+${conversation.contactPhone}`;

  // Flags the chat for the team. A chat already flagged is not re-announced
  // (no second holding message or email) unless this raises it from SOFT to HARD.
  const alreadyFlagged = conversation.needsHuman;
  const flaggedKind: HandoffKind | null = alreadyFlagged ? normalizeHandoffKind(conversation.handoffKind) : null;
  const handOver = async (reason: string, holdingText: string | null, kind: HandoffKind) => {
    const escalates = !alreadyFlagged || (flaggedKind === "SOFT" && kind === "HARD");
    if (!escalates) {
      if (mode === "AUTO" && holdingText && kind === "SOFT") {
        // The assistant's own "I'll check" reply is still worth sending in a SOFT chat.
        await sendText({ shopId: input.shopId, conversationId: conversation.id, text: holdingText }).catch(() => undefined);
      }
      return;
    }
    if (mode === "AUTO" && holdingText) {
      await sendText({ shopId: input.shopId, conversationId: conversation.id, text: holdingText }).catch((error) =>
        console.error("[WHATSAPP ASSISTANT] holding_send_failed", { conversationId: conversation.id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }));
    }
    await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { needsHuman: true, handoffKind: kind, handoffReason: reason.slice(0, 200) } });
    await alert({
      shopId: input.shopId,
      subject: `WhatsApp: ${who} needs a reply from the team`,
      text: [`${who} (+${conversation.contactPhone}) on WhatsApp:`, "", (trigger.body || "").slice(0, 500), "", `Why: ${reason}`, "", `Reply within 24 hours: ${inboxLink(shop.shopDomain, conversation.id)}`].join("\n"),
    }).catch(() => undefined);
  };

  if (gate.action === "handoff") {
    await handOver(gate.reason, mode === "AUTO" ? "Thanks! A member of our team will look at this and reply here shortly. 🙏" : null, gate.handoffKind);
    return { status: "handoff", outcome: gate.reason };
  }

  if (trigger.waMessageId) await (deps.typing ?? defaults.typing)({ shopId: input.shopId, businessPhoneNumberId: conversation.businessPhoneNumberId, waMessageId: trigger.waMessageId }).catch(() => undefined);

  let result: AssistantResult | null = null;
  try {
    ({ result } = await askAssistant({ shopDomain: shop.shopDomain, contactPhone: conversation.contactPhone, merchantNotes: account?.aiKnowledge ?? null, chat: chatLines(recent) }, deps));
  } catch (error) {
    console.error("[WHATSAPP ASSISTANT] ai_failed", { conversationId: conversation.id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
  }
  if (!result) {
    await handOver("The AI assistant was unavailable", mode === "AUTO" ? "Thanks for your message! A member of our team will reply here shortly. 🙏" : null, "SOFT");
    return { status: "handoff", outcome: "ai_unavailable" };
  }

  const outcome = decideOutcome(mode, result);
  console.info("[WHATSAPP ASSISTANT] outcome", { conversationId: conversation.id, mode, kind: outcome.kind, intent: result.intent, confidence: result.confidence, needsHuman: result.needsHuman, handoffKind: result.handoffKind });
  if (outcome.kind === "draft") {
    await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { aiDraft: outcome.text, aiDraftAt: at } });
    if (outcome.handoff) await handOver(outcome.reason || "Assistant suggests a team member replies", null, outcome.handoffKind);
    return { status: "drafted", outcome: outcome.handoff ? "draft_handoff" : "draft", intent: result.intent };
  }
  if (outcome.kind === "handoff_only") {
    await handOver(outcome.reason, null, outcome.handoffKind);
    return { status: "handoff", outcome: "no_reply", intent: result.intent };
  }
  if (outcome.handoff) {
    await handOver(outcome.reason, outcome.text, outcome.handoffKind);
    return { status: "handoff", outcome: "sent_holding", intent: result.intent };
  }
  try {
    await sendText({ shopId: input.shopId, conversationId: conversation.id, text: outcome.text });
  } catch (error) {
    console.error("[WHATSAPP ASSISTANT] reply_send_failed", { conversationId: conversation.id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    await handOver("The assistant's reply could not be sent", null, "SOFT");
    return { status: "handoff", outcome: "send_failed", intent: result.intent };
  }
  // Answered: nothing new for the team in this chat (unless an earlier SOFT handoff still waits for them).
  if (!conversation.needsHuman) await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } }).catch(() => undefined);
  return { status: "sent", outcome: "answered", intent: result.intent };
}
