import assert from "node:assert/strict";
import test from "node:test";
import { assistantGate, buildSystemPrompt, buildUserPrompt, decideOutcome, DEFAULT_HOLDING_MESSAGE, stripEmoji, normalizeAssistantMode, parseAssistantResult, productSearchTerms, type AssistantGateInput } from "./policy.ts";

const NOW = new Date("2026-10-07T08:00:00Z");
const gateInput = (overrides: Partial<AssistantGateInput> = {}): AssistantGateInput => ({
  mode: "AUTO", aiConfigured: true, message: { type: "text", body: "Is the black swim dress available in XL?" }, isConsentKeyword: false,
  conversation: { needsHuman: false, aiPausedUntil: null }, newerInboundExists: false, aiRepliesLastHour: 0, shopAiRepliesLastDay: 0, now: NOW, ...overrides,
});

test("assistant answers ordinary text questions when switched on", () => {
  assert.deepEqual(assistantGate(gateInput()), { action: "respond" });
  assert.equal(assistantGate(gateInput({ mode: "OFF" })).action, "skip");
  assert.equal(assistantGate(gateInput({ aiConfigured: false })).action, "skip");
});

test("assistant stays out when the team owns the chat, a newer message is coming, or it is a STOP", () => {
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: true, aiPausedUntil: null } })).action, "skip");
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: false, aiPausedUntil: new Date(NOW.getTime() + 60_000) } })).action, "skip");
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: false, aiPausedUntil: new Date(NOW.getTime() - 60_000) } })).action, "respond");
  assert.equal(assistantGate(gateInput({ newerInboundExists: true })).action, "skip");
  assert.equal(assistantGate(gateInput({ isConsentKeyword: true })).action, "skip");
});

test("photos and voice notes, and chats that run away, go to the team", () => {
  assert.equal(assistantGate(gateInput({ message: { type: "image", body: "📷 Photo" } })).action, "handoff");
  assert.equal(assistantGate(gateInput({ message: { type: "audio", body: "🎤 Voice message" } })).action, "handoff");
  assert.equal(assistantGate(gateInput({ aiRepliesLastHour: 6 })).action, "handoff");
  assert.equal(assistantGate(gateInput({ shopAiRepliesLastDay: 300 })).action, "skip");
});

test("model output is validated; anything malformed becomes a handoff", () => {
  assert.equal(parseAssistantResult(null), null);
  const empty = parseAssistantResult({ reply: "", confidence: 0.9 });
  assert.equal(empty?.needsHuman, true);
  const ok = parseAssistantResult({ reply: "Yes, XL is in stock: ₹1,195", intent: "product", needs_human: false, confidence: 1.7 });
  assert.equal(ok?.confidence, 1);
  assert.equal(ok?.needsHuman, false);
  assert.equal(parseAssistantResult({ reply: "x", confidence: "high" })?.confidence, 0);
});

test("AUTO sends confident answers, holds and hands over otherwise; DRAFT never sends", () => {
  const answer = { reply: "Yes, XL is in stock.", intent: "product", needsHuman: false, handoffKind: "SOFT" as const, handoffReason: null, confidence: 0.9 };
  assert.deepEqual(decideOutcome("AUTO", answer), { kind: "send", text: "Yes, XL is in stock.", handoff: false });
  const unsure = decideOutcome("AUTO", { ...answer, confidence: 0.4 });
  assert.equal(unsure.kind, "send");
  assert.equal(unsure.kind === "send" && unsure.text, DEFAULT_HOLDING_MESSAGE, "an unsure answer is never sent in the AI's words");
  assert.equal(unsure.kind === "send" && unsure.handoff, true);
  assert.equal(unsure.kind === "send" && unsure.handoff && unsure.handoffKind, "SOFT", "unsure answers are checked by the team, the assistant keeps going");
  const complaint = decideOutcome("AUTO", { ...answer, reply: "Sorry about that! Our team will help you shortly.", needsHuman: true, handoffKind: "HARD", handoffReason: "Damaged item" });
  assert.deepEqual(complaint, { kind: "send", text: "Sorry about that! Our team will help you shortly.", handoff: true, reason: "Damaged item", handoffKind: "HARD" });
  assert.deepEqual(decideOutcome("DRAFT", answer), { kind: "draft", text: "Yes, XL is in stock.", handoff: false, reason: null, handoffKind: "SOFT" });
  assert.equal(decideOutcome("DRAFT", { ...answer, reply: "" }).kind, "handoff_only");
});

test("mode values are normalized", () => {
  assert.equal(normalizeAssistantMode("auto"), "AUTO");
  assert.equal(normalizeAssistantMode("something"), "OFF");
  assert.equal(normalizeAssistantMode(null), "OFF");
});

test("catalog search uses the customer's own words, not filler", () => {
  assert.deepEqual(productSearchTerms([{ from: "customer", text: "Hi, do you have a black swim dress in XL? price kya hai" }, { from: "store", text: "burkini" }]), ["black", "swim", "dress"]);
});

test("prompt carries only the store's facts and the recent chat", () => {
  const prompt = buildUserPrompt(
    { storeName: "Megaska", storeUrl: "https://megaska.com", policies: [], merchantNotes: "Delivery in 3-7 days.", products: [{ title: "Swim Dress", url: "https://megaska.com/products/swim-dress", price: "₹1195", sizes: "M, L", inStock: true, description: "" }], orders: [] },
    [{ from: "customer", text: "XL available?" }],
  );
  assert.match(prompt, /MERCHANT NOTES:\nDelivery in 3-7 days\./);
  assert.match(prompt, /Swim Dress \| ₹1195 \| in stock \| sizes available: M, L \| https:\/\/megaska\.com\/products\/swim-dress/);
  assert.match(prompt, /ORDERS: none found/);
  assert.match(prompt, /Customer: XL available\?$/);
});

test("SOFT handoff keeps the assistant answering; HARD (or an older flag without a kind) silences it", () => {
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: true, handoffKind: "SOFT", aiPausedUntil: null } })).action, "respond");
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: true, handoffKind: "HARD", aiPausedUntil: null } })).action, "skip");
  assert.equal(assistantGate(gateInput({ conversation: { needsHuman: true, handoffKind: null, aiPausedUntil: null } })).action, "skip");
  const photo = assistantGate(gateInput({ message: { type: "image", body: "📷 Photo" } }));
  assert.equal(photo.action === "handoff" && photo.handoffKind, "HARD");
});

test("handoff kind: requests about refunds/complaints are always HARD; 'let me check' can be SOFT", () => {
  assert.equal(parseAssistantResult({ reply: "I'll check with the team.", intent: "product", needs_human: true, handoff_kind: "soft", confidence: 0.8 })?.handoffKind, "SOFT");
  assert.equal(parseAssistantResult({ reply: "Sorry! Team will help.", intent: "complaint", needs_human: true, handoff_kind: "soft", confidence: 0.8 })?.handoffKind, "HARD", "the model cannot soften a complaint");
  assert.equal(parseAssistantResult({ reply: "Team will help.", intent: "other", needs_human: true, confidence: 0.8 })?.handoffKind, "HARD", "no kind given: safe default");
  const returnRequest = parseAssistantResult({ reply: "Our team will arrange it.", intent: "return_exchange", needs_human: false, confidence: 0.9 });
  assert.equal(returnRequest?.needsHuman, true);
  assert.equal(returnRequest?.handoffKind, "HARD");
  const policyQuestion = parseAssistantResult({ reply: "Refunds are processed within 10 business days.", intent: "policy", needs_human: false, confidence: 0.9 });
  assert.equal(policyQuestion?.needsHuman, false, "a question about the refund policy is answered, not handed over");
});

test("'Ok', 'Thanks', 'Theek hai', emoji, reactions and stickers get no reply and no handoff", () => {
  for (const body of ["Ok", "ok.", "Okay thanks", "Thank you!", "theek hai", "👍", "🙏🙏", "Thanks 😊"]) {
    assert.deepEqual(assistantGate(gateInput({ message: { type: "text", body } })), { action: "skip", reason: "acknowledgement" }, body);
  }
  assert.equal(assistantGate(gateInput({ message: { type: "reaction", body: "Reacted 👍" } })).action, "skip");
  assert.equal(assistantGate(gateInput({ message: { type: "sticker", body: "Sticker" } })).action, "skip");
  assert.equal(assistantGate(gateInput({ message: { type: "text", body: "Ok but when will it arrive?" } })).action, "respond");
  assert.equal(assistantGate(gateInput({ message: { type: "text", body: "ok" }, lastStoreMessageAskedQuestion: true })).action, "respond", "an answer to our question");
});

test("complaint handoffs go out without emoji; soft holds keep their tone", () => {
  const hard = decideOutcome("AUTO", parseAssistantResult({ reply: "I'm sorry to hear about the delivery experience. Our team will assist you with this. 😊", intent: "complaint", needs_human: true, handoff_kind: "hard", confidence: 0.9 })!);
  assert.equal(hard.kind === "send" ? hard.text : "", "I'm sorry to hear about the delivery experience. Our team will assist you with this.");
  const empty = decideOutcome("AUTO", parseAssistantResult({ reply: "", intent: "complaint", needs_human: true, handoff_kind: "hard", confidence: 0.9 })!);
  assert.equal(empty.kind === "send" ? empty.text : "", stripEmoji(DEFAULT_HOLDING_MESSAGE));
  assert.ok(!/\p{Extended_Pictographic}/u.test(empty.kind === "send" ? empty.text : "x🙂"));
  const soft = decideOutcome("AUTO", parseAssistantResult({ reply: "Let me check that with the team 😊", intent: "product", needs_human: true, handoff_kind: "soft", confidence: 0.9 })!);
  assert.equal(soft.kind === "send" ? soft.text : "", "Let me check that with the team 😊");
  assert.equal(stripEmoji("Done 👍🏽 !"), "Done!");
});

test("the model knows the time in India and the self-service and support-hours rules", () => {
  const prompt = buildUserPrompt({ storeName: "Shop", storeUrl: null, policies: [], merchantNotes: null, products: [], orders: [] }, [{ from: "customer", text: "hi" }], new Date("2026-10-08T15:30:00Z"));
  assert.match(prompt, /NOW: .*9:00 pm.*\(India time\)/i);
  const system = buildSystemPrompt("Shop");
  assert.match(system, /do it themselves/);
  assert.match(system, /no emoji at all/);
  assert.match(system, /support hours/);
});
