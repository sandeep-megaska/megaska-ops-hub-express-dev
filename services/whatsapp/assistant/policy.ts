// WhatsApp AI assistant: the pure decisions (when to answer, what to send) and
// the prompt. No I/O here, so every rule is unit-tested.
//
// Modes (per shop, Merchant WhatsApp → AI assistant):
//   OFF   – nothing happens.
//   DRAFT – the assistant writes a suggested reply into the inbox; a team
//           member edits/sends it. Nothing reaches the customer on its own.
//   AUTO  – the assistant answers questions it can answer from store facts and
//           hands everything else (complaints, refunds, unknowns) to the team
//           with one short holding message.

export type AssistantMode = "OFF" | "DRAFT" | "AUTO";

export const ASSISTANT_MODES: AssistantMode[] = ["OFF", "DRAFT", "AUTO"];
export const MAX_AI_REPLIES_PER_CHAT_PER_HOUR = 6;
export const MAX_AI_REPLIES_PER_SHOP_PER_DAY = 300;
// After a team member replies, the assistant stays out of that chat this long.
export const HUMAN_TAKEOVER_PAUSE_MS = 12 * 60 * 60 * 1000;
// Below this, an AUTO reply is not sent; the chat is handed to the team instead.
export const MIN_AUTO_CONFIDENCE = 0.6;
export const MAX_REPLY_CHARS = 900;
export const MAX_KNOWLEDGE_CHARS = 8000;

export function normalizeAssistantMode(value: unknown): AssistantMode {
  const mode = String(value ?? "").trim().toUpperCase();
  return (ASSISTANT_MODES as string[]).includes(mode) ? (mode as AssistantMode) : "OFF";
}

const ANSWERABLE_TYPES = new Set(["text", "button", "interactive"]);

export type AssistantGateInput = {
  mode: AssistantMode;
  aiConfigured: boolean;
  message: { type: string; body: string };
  isConsentKeyword: boolean;
  conversation: { needsHuman: boolean; aiPausedUntil: Date | null };
  newerInboundExists: boolean;
  aiRepliesLastHour: number;
  shopAiRepliesLastDay: number;
  now: Date;
};

export type AssistantGate =
  | { action: "respond" }
  | { action: "handoff"; reason: string }
  | { action: "skip"; reason: string };

// Whether the assistant should look at this customer message at all.
export function assistantGate(input: AssistantGateInput): AssistantGate {
  if (input.mode === "OFF") return { action: "skip", reason: "assistant_off" };
  if (!input.aiConfigured) return { action: "skip", reason: "ai_not_configured" };
  if (input.isConsentKeyword) return { action: "skip", reason: "consent_keyword" };
  if (input.newerInboundExists) return { action: "skip", reason: "newer_message_pending" };
  if (input.conversation.needsHuman) return { action: "skip", reason: "already_with_team" };
  if (input.conversation.aiPausedUntil && new Date(input.conversation.aiPausedUntil).getTime() > input.now.getTime()) {
    return { action: "skip", reason: "team_replied_recently" };
  }
  if (input.aiRepliesLastHour >= MAX_AI_REPLIES_PER_CHAT_PER_HOUR) return { action: "handoff", reason: "Many messages in a short time" };
  if (input.shopAiRepliesLastDay >= MAX_AI_REPLIES_PER_SHOP_PER_DAY) return { action: "skip", reason: "daily_limit" };
  // Photos, voice notes, documents: a person should look at them.
  if (!ANSWERABLE_TYPES.has(input.message.type)) return { action: "handoff", reason: `Customer sent a ${input.message.type}` };
  if (!input.message.body.trim()) return { action: "skip", reason: "empty_message" };
  return { action: "respond" };
}

export type AssistantResult = {
  reply: string;
  intent: string;
  needsHuman: boolean;
  handoffReason: string | null;
  confidence: number;
};

// Validates the model's JSON. Anything malformed becomes a handoff, never a send.
export function parseAssistantResult(raw: Record<string, unknown> | null): AssistantResult | null {
  if (!raw || typeof raw !== "object") return null;
  const reply = typeof raw.reply === "string" ? raw.reply.trim().slice(0, MAX_REPLY_CHARS) : "";
  const confidence = Number(raw.confidence);
  return {
    reply,
    intent: typeof raw.intent === "string" ? raw.intent.trim().slice(0, 40) || "other" : "other",
    needsHuman: raw.needs_human === true || !reply,
    handoffReason: typeof raw.handoff_reason === "string" && raw.handoff_reason.trim() ? raw.handoff_reason.trim().slice(0, 200) : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

export const DEFAULT_HOLDING_MESSAGE = "Thanks for your message! A member of our team will get back to you here shortly. 🙏";

export type AssistantOutcome =
  | { kind: "send"; text: string; handoff: false }
  | { kind: "send"; text: string; handoff: true; reason: string }
  | { kind: "draft"; text: string; handoff: boolean; reason: string | null }
  | { kind: "handoff_only"; reason: string };

// What to do with the model's answer in each mode.
export function decideOutcome(mode: AssistantMode, result: AssistantResult): AssistantOutcome {
  const reason = result.handoffReason || (result.needsHuman ? "Assistant could not answer" : "Assistant was not sure");
  if (mode === "DRAFT") {
    if (!result.reply) return { kind: "handoff_only", reason };
    return { kind: "draft", text: result.reply, handoff: result.needsHuman, reason: result.needsHuman ? reason : null };
  }
  if (result.needsHuman) {
    // The model was asked to write only an acknowledgement in this case.
    return { kind: "send", text: result.reply || DEFAULT_HOLDING_MESSAGE, handoff: true, reason };
  }
  if (result.confidence < MIN_AUTO_CONFIDENCE) {
    // Not sure enough to send its own words: hold and hand over.
    return { kind: "send", text: DEFAULT_HOLDING_MESSAGE, handoff: true, reason };
  }
  return { kind: "send", text: result.reply, handoff: false };
}

// Store facts handed to the model. Everything is plain text and truncated.
export type StoreContext = {
  storeName: string;
  storeUrl: string | null;
  policies: Array<{ title: string; body: string }>;
  merchantNotes: string | null;
  products: Array<{ title: string; url: string | null; price: string; sizes: string; inStock: boolean; description: string }>;
  orders: Array<{ name: string; placedOn: string; status: string; payment: string; items: string; tracking: string | null; total: string }>;
};

export type ChatLine = { from: "customer" | "store"; text: string };

export function buildSystemPrompt(storeName: string) {
  return [
    `You are the WhatsApp assistant of ${storeName}, an Indian online store. You reply to customers on WhatsApp for the store team.`,
    "",
    "Hard rules:",
    "- Use ONLY the facts given below (STORE, POLICIES, MERCHANT NOTES, PRODUCTS, ORDERS). If the answer is not in them, do not guess: say a team member will reply shortly and set needs_human to true.",
    "- Never invent or change prices, discounts, offers, coupon codes, stock, sizes, delivery dates, policies or order details. Quote prices exactly as given.",
    "- Never create urgency or scarcity (no 'only few left', 'hurry', 'offer ends soon') unless MERCHANT NOTES state it as a fact.",
    "- Never ask for or accept OTPs, passwords, card numbers, CVV or UPI PINs.",
    "- Complaints, damaged/wrong/missing items, refunds, return or exchange requests, cancellations, payment taken but no order, address changes, delivery problems, or an upset customer: reply with one or two short, warm lines saying the team will help shortly (you may quote the relevant policy fact), and set needs_human to true.",
    "- Orders: only discuss orders listed under ORDERS; they belong to this WhatsApp number. Give status and the tracking link if present. If ORDERS is empty and they ask about an order, ask for the order number and set needs_human to true.",
    "- Products: recommend at most 3, only from PRODUCTS, with their link and price. If a size is out of stock say so plainly.",
    "- Sizing: use size information in the facts; if it is not there, ask their usual size or hand over to the team.",
    "",
    "Style: reply in the customer's language and script (English, Hindi, Hinglish, Malayalam, Tamil, …). Warm, plain and short: at most 5 short lines. WhatsApp formatting only (*bold* sparingly), at most one emoji. No greeting block or signature on follow-up messages.",
    "If the message is only a greeting, greet back and say you can help with products, sizes and orders.",
    "",
    'Return JSON only: {"reply": string, "intent": "greeting"|"product"|"size"|"order_status"|"policy"|"complaint"|"return_exchange"|"other", "needs_human": boolean, "handoff_reason": string|null, "confidence": number between 0 and 1 = how fully the facts support your reply}.',
  ].join("\n");
}

function clip(value: string, max: number) {
  const text = value.replace(/\s+\n/g, "\n").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildUserPrompt(context: StoreContext, chat: ChatLine[]) {
  const sections: string[] = [];
  sections.push(`STORE: ${context.storeName}${context.storeUrl ? ` (${context.storeUrl})` : ""}`);
  if (context.policies.length) {
    sections.push(`POLICIES:\n${context.policies.map((policy) => `## ${policy.title}\n${clip(policy.body, 1500)}`).join("\n")}`);
  }
  if (context.merchantNotes?.trim()) sections.push(`MERCHANT NOTES:\n${clip(context.merchantNotes, MAX_KNOWLEDGE_CHARS)}`);
  sections.push(
    context.products.length
      ? `PRODUCTS (matching the conversation):\n${context.products.map((product) => `- ${product.title} | ${product.price} | ${product.inStock ? "in stock" : "out of stock"}${product.sizes ? ` | sizes available: ${product.sizes}` : ""}${product.url ? ` | ${product.url}` : ""}${product.description ? `\n  ${clip(product.description, 300)}` : ""}`).join("\n")}`
      : "PRODUCTS: none matched the conversation.",
  );
  sections.push(
    context.orders.length
      ? `ORDERS (this customer's recent orders):\n${context.orders.map((order) => `- ${order.name} placed ${order.placedOn} | ${order.status} | payment: ${order.payment} | ${order.total} | items: ${order.items}${order.tracking ? ` | tracking: ${order.tracking}` : ""}`).join("\n")}`
      : "ORDERS: none found for this WhatsApp number.",
  );
  const transcript = chat.slice(-12).map((line) => `${line.from === "customer" ? "Customer" : "Store"}: ${clip(line.text, 600)}`).join("\n");
  sections.push(`CONVERSATION (latest last; reply to the customer's latest message):\n${transcript}`);
  return sections.join("\n\n");
}

const STOPWORDS = new Set("the and for you your have has with this that what when where which from are was were can could would will please pls plz want need any some about there here hai hain kya aur kaise kitna kitne mujhe chahiye price cost size sizes available stock order delivery hello thanks thank okay yes".split(" "));

// Words from the customer's recent messages used to search the catalog.
export function productSearchTerms(chat: ChatLine[], max = 4): string[] {
  const text = chat.filter((line) => line.from === "customer").slice(-3).map((line) => line.text).join(" ").toLowerCase();
  const words = text.match(/[a-z][a-z-]{2,}/g) ?? [];
  const terms: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length >= max) break;
  }
  return terms;
}
