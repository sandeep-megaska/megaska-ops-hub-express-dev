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
// Emoji reactions and stickers are a nod, not a question: no reply, no handoff.
const SILENT_TYPES = new Set(["reaction", "sticker"]);

const ACKNOWLEDGEMENTS = new Set([
  "ok", "okay", "okk", "okkk", "k", "kk", "okie", "oki", "ok thanks", "ok thank you", "ok thanku", "okay thanks", "ok ji", "okay ji",
  "thanks", "thank you", "thank u", "thanku", "thankyou", "thx", "ty", "tq", "thanks a lot", "thank you so much", "many thanks",
  "done", "fine", "great", "good", "nice", "sure", "noted", "alright", "all right", "cool", "perfect", "got it", "received",
  "ji", "ji ok", "theek hai", "thik hai", "theek h", "thik h", "accha", "achha", "acha", "haan", "haa", "hmm", "hm", "shukriya", "dhanyavad",
]);

// "Ok", "Thanks", "👍", "Theek hai" … closes a thread; answering it is just noise.
export function isAcknowledgement(text: string | null | undefined) {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const withoutEmoji = raw.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]/gu, "").trim();
  if (!withoutEmoji) return true; // emoji only
  const normalized = withoutEmoji.toLowerCase().replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
  return ACKNOWLEDGEMENTS.has(normalized);
}

// How a chat is handed to the team:
//   HARD – complaints, refunds/returns/exchanges/cancellations, photos, damaged
//          items, AI failure loops: the assistant goes quiet until the team
//          replies or marks it resolved, so it never talks over them.
//   SOFT – "let me check" questions (availability, sizing it cannot answer,
//          unknown facts): the team is told, but the assistant keeps answering
//          the customer's other questions.
// Chats flagged before this distinction existed (no kind) count as HARD.
export type HandoffKind = "SOFT" | "HARD";

export function normalizeHandoffKind(value: unknown): HandoffKind {
  return String(value ?? "").toUpperCase() === "SOFT" ? "SOFT" : "HARD";
}

// Intents that always need a person, whatever the model says.
const HARD_INTENTS = new Set(["complaint", "return_exchange", "cancellation", "refund_request"]);

export type AssistantGateInput = {
  mode: AssistantMode;
  aiConfigured: boolean;
  message: { type: string; body: string };
  isConsentKeyword: boolean;
  conversation: { needsHuman: boolean; handoffKind?: string | null; aiPausedUntil: Date | null };
  newerInboundExists: boolean;
  // The store's last message asked something ("Shall I share options?"), so a
  // short "ok" / "haan" is an answer, not a sign-off.
  lastStoreMessageAskedQuestion?: boolean;
  aiRepliesLastHour: number;
  shopAiRepliesLastDay: number;
  now: Date;
};

export type AssistantGate =
  | { action: "respond" }
  | { action: "handoff"; reason: string; handoffKind: HandoffKind }
  | { action: "skip"; reason: string };

// Whether the assistant should look at this customer message at all.
export function assistantGate(input: AssistantGateInput): AssistantGate {
  if (input.mode === "OFF") return { action: "skip", reason: "assistant_off" };
  if (!input.aiConfigured) return { action: "skip", reason: "ai_not_configured" };
  if (input.isConsentKeyword) return { action: "skip", reason: "consent_keyword" };
  if (input.newerInboundExists) return { action: "skip", reason: "newer_message_pending" };
  // A HARD handoff silences the assistant; after a SOFT one it keeps answering.
  if (input.conversation.needsHuman && normalizeHandoffKind(input.conversation.handoffKind) === "HARD") return { action: "skip", reason: "already_with_team" };
  if (input.conversation.aiPausedUntil && new Date(input.conversation.aiPausedUntil).getTime() > input.now.getTime()) {
    return { action: "skip", reason: "team_replied_recently" };
  }
  if (input.aiRepliesLastHour >= MAX_AI_REPLIES_PER_CHAT_PER_HOUR) return { action: "handoff", reason: "Many messages in a short time", handoffKind: "HARD" };
  if (input.shopAiRepliesLastDay >= MAX_AI_REPLIES_PER_SHOP_PER_DAY) return { action: "skip", reason: "daily_limit" };
  if (SILENT_TYPES.has(input.message.type)) return { action: "skip", reason: "reaction_or_sticker" };
  if (ANSWERABLE_TYPES.has(input.message.type) && !input.lastStoreMessageAskedQuestion && isAcknowledgement(input.message.body)) return { action: "skip", reason: "acknowledgement" };
  // Photos, voice notes, documents: a person should look at them.
  if (!ANSWERABLE_TYPES.has(input.message.type)) return { action: "handoff", reason: `Customer sent a ${input.message.type}`, handoffKind: "HARD" };
  if (!input.message.body.trim()) return { action: "skip", reason: "empty_message" };
  return { action: "respond" };
}

export type AssistantResult = {
  reply: string;
  intent: string;
  needsHuman: boolean;
  handoffKind: HandoffKind;
  handoffReason: string | null;
  confidence: number;
  // The customer asked to be told when a sold-out product / size / colour is back.
  restockRequest?: { product: string; size: string | null; color: string | null } | null;
};

function restockRequestFrom(value: unknown): AssistantResult["restockRequest"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const product = typeof raw.product === "string" ? raw.product.trim().slice(0, 300) : "";
  if (!product) return null;
  const optional = (entry: unknown) => (typeof entry === "string" && entry.trim() && !/^(null|any|none)$/i.test(entry.trim()) ? entry.trim().slice(0, 60) : null);
  return { product, size: optional(raw.size), color: optional(raw.color) ?? optional(raw.colour) };
}

// Validates the model's JSON. Anything malformed becomes a handoff, never a send.
// WhatsApp shows markdown links and **bold** literally; rewrite them.
export function toWhatsAppText(text: string) {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => (label.trim() === url ? url : `${label.trim()}: ${url}`))
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

export function parseAssistantResult(raw: Record<string, unknown> | null): AssistantResult | null {
  if (!raw || typeof raw !== "object") return null;
  const reply = typeof raw.reply === "string" ? toWhatsAppText(raw.reply).slice(0, MAX_REPLY_CHARS) : "";
  const confidence = Number(raw.confidence);
  const intent = typeof raw.intent === "string" ? raw.intent.trim().slice(0, 40) || "other" : "other";
  const needsHuman = raw.needs_human === true || !reply || HARD_INTENTS.has(intent);
  // A request (not a question) about refunds, returns, complaints … is always HARD.
  const handoffKind: HandoffKind = !reply || HARD_INTENTS.has(intent) ? "HARD" : normalizeHandoffKind(raw.handoff_kind ?? "HARD");
  return {
    reply,
    intent,
    needsHuman,
    handoffKind,
    handoffReason: typeof raw.handoff_reason === "string" && raw.handoff_reason.trim() ? raw.handoff_reason.trim().slice(0, 200) : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    restockRequest: restockRequestFrom(raw.restock_request),
  };
}

export const DEFAULT_HOLDING_MESSAGE = "Thanks for your message! A member of our team will get back to you here shortly. 🙏";

// A smiley under "sorry about your delivery" reads as mocking: hard handoffs
// (complaints, refunds, cancellations) go out without emoji.
export function stripEmoji(text: string) {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]/gu, "")
    .replace(/[ \t]+([.!?,])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export type AssistantOutcome =
  | { kind: "send"; text: string; handoff: false }
  | { kind: "send"; text: string; handoff: true; reason: string; handoffKind: HandoffKind }
  | { kind: "draft"; text: string; handoff: boolean; reason: string | null; handoffKind: HandoffKind }
  | { kind: "handoff_only"; reason: string; handoffKind: HandoffKind };

// What to do with the model's answer in each mode.
export function decideOutcome(mode: AssistantMode, result: AssistantResult): AssistantOutcome {
  const reason = result.handoffReason || (result.needsHuman ? "Assistant could not answer" : "Assistant was not sure");
  if (mode === "DRAFT") {
    if (!result.reply) return { kind: "handoff_only", reason, handoffKind: "HARD" };
    return { kind: "draft", text: result.reply, handoff: result.needsHuman, reason: result.needsHuman ? reason : null, handoffKind: result.handoffKind };
  }
  if (result.needsHuman) {
    // The model was asked to write only an acknowledgement in this case.
    const text = result.reply || DEFAULT_HOLDING_MESSAGE;
    return { kind: "send", text: result.handoffKind === "HARD" ? stripEmoji(text) || stripEmoji(DEFAULT_HOLDING_MESSAGE) : text, handoff: true, reason, handoffKind: result.handoffKind };
  }
  if (result.confidence < MIN_AUTO_CONFIDENCE) {
    // Not sure enough to send its own words: hold and let the team check.
    return { kind: "send", text: DEFAULT_HOLDING_MESSAGE, handoff: true, reason, handoffKind: "SOFT" };
  }
  return { kind: "send", text: result.reply, handoff: false };
}

// Store facts handed to the model. Everything is plain text and truncated.
export type StoreContext = {
  storeName: string;
  storeUrl: string | null;
  policies: Array<{ title: string; body: string }>;
  merchantNotes: string | null;
  products: Array<{
    id?: string;
    title: string;
    url: string | null;
    price: string;
    sizes: string;
    colors?: string;
    // Sizes (or colours) that exist but cannot be bought right now.
    soldOut?: string;
    inStock: boolean;
    description: string;
    // Variant ids and options, used to save back-in-stock requests (not shown to the model).
    variants?: Array<{ id: string; size: string; color: string; available: boolean }>;
  }>;
  // Every product type in the catalog with its count, so "do you have X?" is
  // never answered "no" just because the search missed it.
  catalogOverview?: string[];
  // Store data that could not be read (shown in the admin preview, never to customers).
  readErrors?: string[];
  orders: Array<{ name: string; placedOn: string; status: string; payment: string; items: string; tracking: string | null; total: string }>;
};

export type ChatLine = { from: "customer" | "store"; text: string };

export function buildSystemPrompt(storeName: string, options: { backInStock?: boolean } = {}) {
  return [
    `You are the WhatsApp assistant of ${storeName}, an Indian online store. You reply to customers on WhatsApp for the store team.`,
    "",
    "Hard rules:",
    "- Use ONLY the facts given below (STORE, POLICIES, MERCHANT NOTES, PRODUCTS, ORDERS). If the answer is not in them, do not guess: say a team member will reply shortly and set needs_human to true.",
    "- Never invent or change prices, discounts, offers, coupon codes, stock, sizes, delivery dates, policies or order details. Quote prices exactly as given.",
    "- Never create urgency or scarcity (no 'only few left', 'hurry', 'offer ends soon') unless MERCHANT NOTES state it as a fact.",
    "- Never ask for or accept OTPs, passwords, card numbers, CVV or UPI PINs.",
    "- Requests that need a person: a complaint, damaged/wrong/missing item, asking for a refund, return, exchange or cancellation of their order, payment taken but no order, address change, a delivery problem, or an upset customer. Reply with one or two short, warm lines saying the team will help (you may quote the relevant policy fact). If MERCHANT NOTES say the customer can do it themselves (for example cancel, exchange or report an issue from their account), give those steps too. Set needs_human to true and handoff_kind to \"hard\".",
    "- Upset customer, complaint or apology: no emoji at all; acknowledge the specific problem in plain words.",
    "- Reply times: if MERCHANT NOTES give support hours and NOW is outside them, say the team will reply when they are back (quote the hours) instead of \"shortly\".",
    "- A general question ABOUT a policy (\"what is your refund policy?\", \"do you allow exchange?\") is not a request: answer it from the facts (intent policy) without needs_human.",
    "- When you cannot answer from the facts (availability you cannot see, unknown details): say you will check with the team, set needs_human to true and handoff_kind to \"soft\". Keep answering the customer's other questions normally in later messages.",
    "- Orders: only discuss orders listed under ORDERS; they belong to this WhatsApp number. Give status and the tracking link if present. If ORDERS is empty and they ask about an order, ask for the order number and set needs_human to true.",
    "- Products: recommend at most 3, only from PRODUCTS, with their link and price. If a size or colour is out of stock say so plainly.",
    "- Never say the store does not have or sell something unless CATALOG OVERVIEW clearly has no such kind of product. If PRODUCTS has no good match, say you will check and set needs_human to true.",
    "- Links: write the plain URL on its own (WhatsApp does not support [text](url) markdown).",
    "- Sizing: only map body measurements (bust, waist, hip, height) to a size when a size chart with measurements is in the facts. Otherwise do not guess: point them to the size chart on the product page, ask their usual size, or hand over with handoff_kind \"soft\".",
    ...(options.backInStock ? [
      "- Sold out: when a product, size or colour the customer wants is sold out, say so plainly and offer to WhatsApp them as soon as it is back in stock. When they ask to be told or agree (\"yes\", \"notify me\", \"haan\"), set restock_request to {\"product\": the exact product title from PRODUCTS, \"size\": the size or null, \"color\": the colour or null} and confirm you will message them here when it is back. Never promise or guess a restock date.",
    ] : []),
    "- Yes/no questions: answer with the correct word first (\"No, …\" / \"Nahi, …\" when the answer is no). Never start with yes (\"Haan\") and then say the opposite.",
    "",
    "Style: reply in the customer's language and script (English, Hindi, Hinglish, Malayalam, Tamil, …). Warm, plain and short: at most 5 short lines. WhatsApp formatting only (*bold* sparingly), at most one emoji. No greeting block or signature on follow-up messages.",
    "If the message is only a greeting, greet back and say you can help with products, sizes and orders.",
    "",
    `Return JSON only: {"reply": string, "intent": "greeting"|"product"|"size"|"order_status"|"policy"|"complaint"|"return_exchange"|"other", "needs_human": boolean, "handoff_kind": "soft"|"hard"|null, "handoff_reason": string|null, "confidence": number between 0 and 1 = how fully the facts support your reply${options.backInStock ? ', "restock_request": {"product": string, "size": string|null, "color": string|null}|null' : ""}}.`,
  ].join("\n");
}

function clip(value: string, max: number) {
  const text = value.replace(/\s+\n/g, "\n").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatIndiaNow(now: Date) {
  return now.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

export function buildUserPrompt(context: StoreContext, chat: ChatLine[], now: Date = new Date()) {
  const sections: string[] = [];
  sections.push(`STORE: ${context.storeName}${context.storeUrl ? ` (${context.storeUrl})` : ""}`);
  sections.push(`NOW: ${formatIndiaNow(now)} (India time)`);
  if (context.policies.length) {
    sections.push(`POLICIES:\n${context.policies.map((policy) => `## ${policy.title}\n${clip(policy.body, 1500)}`).join("\n")}`);
  }
  if (context.merchantNotes?.trim()) sections.push(`MERCHANT NOTES:\n${clip(context.merchantNotes, MAX_KNOWLEDGE_CHARS)}`);
  sections.push(
    context.products.length
      ? `PRODUCTS (best matches for the conversation):\n${context.products.map((product) => `- ${product.title} | ${product.price} | ${product.inStock ? "in stock" : "out of stock"}${product.colors ? ` | colours available: ${product.colors}` : ""}${product.sizes ? ` | sizes available: ${product.sizes}` : ""}${product.soldOut ? ` | sold out: ${product.soldOut}` : ""}${product.url ? ` | ${product.url}` : ""}${product.description ? `\n  ${clip(product.description, 300)}` : ""}`).join("\n")}`
      : "PRODUCTS: no product matched the customer's words.",
  );
  if (context.catalogOverview?.length) sections.push(`CATALOG OVERVIEW (product types in the store):\n${context.catalogOverview.join(", ")}`);
  sections.push(
    context.orders.length
      ? `ORDERS (this customer's recent orders):\n${context.orders.map((order) => `- ${order.name} placed ${order.placedOn} | ${order.status} | payment: ${order.payment} | ${order.total} | items: ${order.items}${order.tracking ? ` | tracking: ${order.tracking}` : ""}`).join("\n")}`
      : "ORDERS: none found for this WhatsApp number.",
  );
  const transcript = chat.slice(-12).map((line) => `${line.from === "customer" ? "Customer" : "Store"}: ${clip(line.text, 600)}`).join("\n");
  sections.push(`CONVERSATION (latest last; reply to the customer's latest message):\n${transcript}`);
  return sections.join("\n\n");
}

const STOPWORDS = new Set("the and for you your have has with this that what when where which from are was were can could would will please pls plz want need any some about there here hai hain kya aur kaise kitna kitne mujhe chahiye price cost size sizes available stock order delivery hello thanks thank okay yes options option show tell more other something looking also only get got does did dont don".split(" "));

// "swimsuits" → "swimsuit", "dresses" → "dress", "bikinis" → "bikini".
export function stemWord(word: string) {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// Shopper words → words stores use in titles and tags (apparel-wide, not store-specific).
const SYNONYMS: Record<string, string[]> = {
  cover: ["coverage", "modest", "burkini", "full"],
  covered: ["coverage", "modest", "burkini"],
  coverage: ["modest", "burkini"],
  modest: ["coverage", "burkini"],
  burkini: ["modest", "coverage"],
  burqini: ["burkini", "modest"],
  swimsuit: ["swimwear", "swimming", "swim"],
  swimwear: ["swimsuit", "swim"],
  costume: ["swimming", "swimsuit"],
  swimming: ["swimsuit", "swimwear"],
  dress: ["swimdress", "frock"],
  swimdress: ["dress", "frock"],
  frock: ["dress", "swimdress"],
  legging: ["leggings", "pants"],
  pant: ["pants", "leggings"],
  bra: ["bra"],
  bikini: ["bikini"],
  kid: ["kids", "girls"],
  girl: ["girls", "kids"],
  navy: ["navy", "blue"],
  maroon: ["wine"],
  wine: ["maroon"],
};

// Words from the customer's recent messages used to search the catalog.
export function productSearchTerms(chat: ChatLine[], max = 8): string[] {
  const text = chat.filter((line) => line.from === "customer").slice(-3).map((line) => line.text).join(" ").toLowerCase();
  const words = text.match(/[a-z][a-z-]{2,}/g) ?? [];
  const terms: string[] = [];
  for (const raw of words) {
    if (STOPWORDS.has(raw)) continue;
    const word = stemWord(raw);
    if (STOPWORDS.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length >= max) break;
  }
  return terms;
}

export type CatalogItem = { id: string; title: string; productType: string; tags: string[]; colors: string[] };

function words(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stemWord);
}

// Ranks catalog products by how many of the customer's words (and their
// synonyms) appear in the title, type, tags and colour options. Title and
// colour hits count double. Returns ids, best first.
export function rankCatalog(items: CatalogItem[], terms: string[], max = 6): string[] {
  if (!terms.length) return [];
  const scored = items.map((item) => {
    const title = new Set(words(item.title));
    const colors = new Set(item.colors.flatMap(words));
    const rest = new Set([...words(item.productType), ...item.tags.flatMap(words)]);
    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      const variants = [term, ...(SYNONYMS[term] ?? []).map(stemWord)];
      let best = 0;
      for (const variant of variants) {
        const weight = variant === term ? 1 : 0.6;
        if (title.has(variant) || colors.has(variant)) best = Math.max(best, 2 * weight);
        else if (rest.has(variant)) best = Math.max(best, 1 * weight);
      }
      if (best > 0) matchedTerms += 1;
      score += best;
    }
    return { id: item.id, score: score + matchedTerms };
  });
  return scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, max).map((entry) => entry.id);
}

export function catalogOverview(items: Array<Pick<CatalogItem, "productType">>): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const type = item.productType.trim() || "Other";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} (${count})`);
}

// What the assistant looked at for a preview answer, for the admin to check.
export type AssistantPreviewSeen = { searchTerms: string; products: string; catalog: string; orders: string; problems: string };

export function describeSeen(context: StoreContext, searchTerms: string[]): AssistantPreviewSeen {
  const total = (context.catalogOverview ?? []).reduce((sum, entry) => sum + Number(entry.match(/\((\d+)\)$/)?.[1] ?? 0), 0);
  return {
    searchTerms: searchTerms.join(", ") || "—",
    products: context.products.map((product) => `${product.title}${product.colors ? ` [${product.colors}]` : ""}${product.sizes ? ` (${product.sizes})` : ""}`).join(" · ") || "none matched",
    catalog: total ? `${total} products: ${(context.catalogOverview ?? []).join(", ")}` : "no products read",
    orders: context.orders.length ? context.orders.map((order) => `${order.name} ${order.status}`).join(" · ") : "none",
    problems: (context.readErrors ?? [])
      .map((error) => (error.startsWith("policies:") ? "shop policies (LoopD2C has no permission to read them; put the key facts in store notes)" : error))
      .join(" | "),
  };
}
