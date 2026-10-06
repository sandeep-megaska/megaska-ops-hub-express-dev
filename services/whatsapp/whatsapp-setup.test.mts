/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { consentKeyword, isWhatsAppOptedOut, normalizeWhatsAppPhone, recordWhatsAppConsent } from "./consent.ts";
import { verifyMetaSignature } from "./webhook-signature.ts";
import { dispatchRecoveryMessage, isWhatsAppRecoveryEnabled } from "./recovery-dispatch.ts";

test("phone numbers normalize to one WhatsApp contact", () => {
  for (const phone of ["+91 96393 90404", "919639390404", "9639390404", "09639390404"]) {
    assert.equal(normalizeWhatsAppPhone(phone), "919639390404");
  }
  assert.equal(normalizeWhatsAppPhone(""), null);
});

test("STOP-style replies opt out and START opts back in; ordinary chat is ignored", () => {
  for (const text of ["STOP", "stop.", "Stop promotions", "Unsubscribe", " opt out "]) assert.equal(consentKeyword(text), "opt_out", text);
  for (const text of ["START", "Subscribe", "Resume promotions"]) assert.equal(consentKeyword(text), "opt_in", text);
  for (const text of ["Please stop by tomorrow", "size?", "", null]) assert.equal(consentKeyword(text as string), null);
});

test("the latest consent event decides whether a contact is opted out", async () => {
  const events: any[] = [];
  const db = {
    auditEvent: {
      create: async ({ data }: any) => { events.push({ ...data, createdAt: events.length }); },
      findFirst: async ({ where }: any) => [...events].reverse().find((e) => e.entityType === where.entityType && e.entityId === where.entityId && where.eventType.in.includes(e.eventType)) || null,
    },
  };
  assert.equal(await isWhatsAppOptedOut("9639390404", db), false);
  await recordWhatsAppConsent("+91 96393 90404", "opt_out", { source: "test" }, db);
  assert.equal(await isWhatsAppOptedOut("919639390404", db), true);
  await recordWhatsAppConsent("9639390404", "opt_in", { source: "test" }, db);
  assert.equal(await isWhatsAppOptedOut("9639390404", db), false);
});

test("webhook signature must match the app secret over the raw body", () => {
  const body = '{"object":"whatsapp_business_account"}';
  const signature = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, signature, "secret"), true);
  assert.equal(verifyMetaSignature(body + " ", signature, "secret"), false);
  assert.equal(verifyMetaSignature(body, signature, "other"), false);
  assert.equal(verifyMetaSignature(body, signature, ""), false, "no app secret configured must reject");
  assert.equal(verifyMetaSignature(body, null, "secret"), false);
});

test("checkout recovery sends nothing unless WHATSAPP_RECOVERY_ENABLED=true", async () => {
  const previous = process.env.WHATSAPP_RECOVERY_ENABLED;
  delete process.env.WHATSAPP_RECOVERY_ENABLED;
  try {
    assert.equal(isWhatsAppRecoveryEnabled(), false);
    const result = await dispatchRecoveryMessage({ shopId: "shop-1", checkoutIntentId: "intent-1", recoveryType: "CHECKOUT_ABANDONMENT", phone: "+919639390404" });
    assert.deepEqual(result, { ok: true, sent: false, suppressed: true, reason: "whatsapp_recovery_disabled" });
    process.env.WHATSAPP_RECOVERY_ENABLED = "true";
    assert.equal(isWhatsAppRecoveryEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_RECOVERY_ENABLED; else process.env.WHATSAPP_RECOVERY_ENABLED = previous;
  }
});
