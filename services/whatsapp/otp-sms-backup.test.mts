import assert from "node:assert/strict";
import test from "node:test";
import { sendSmsBackupForFailedOtp, SMS_BACKUP_TTL_MS, type SmsBackupDeps } from "./otp-sms-backup.ts";

const NOW = new Date("2026-11-05T12:00:00Z");

function harness(overrides: { challenge?: Record<string, unknown> | null; sms?: { available: true } | { available: false; reason: string }; recent?: number; sendFails?: boolean } = {}) {
  const challenge = overrides.challenge === null ? null : { id: "c1", shopId: "s1", phoneE164: "+919800000000", provider: "whatsapp", status: "pending", expiresAt: new Date(NOW.getTime() + 4 * 60_000), metadata: { mode: "whatsapp", codeHash: "h" }, ...overrides.challenge };
  const calls = { claimed: 0, released: 0, sent: [] as Array<Record<string, unknown>>, metadata: [] as Array<Record<string, unknown>> };
  const deps: SmsBackupDeps = {
    findChallenge: async () => challenge as never,
    claim: async (_id, metadata) => { calls.claimed++; calls.metadata.push(metadata); if (challenge) challenge.status = "superseded"; return true; },
    updateMetadata: async (_id, metadata) => { calls.metadata.push(metadata); },
    release: async (_id, metadata) => { calls.released++; calls.metadata.push(metadata); if (challenge) challenge.status = "pending"; },
    recentBackups: async () => overrides.recent ?? 0,
    smsAvailable: async () => overrides.sms ?? { available: true },
    sendSms: async (input) => { if (overrides.sendFails) throw new Error("Twilio down"); calls.sent.push(input); return { challengeId: "sms1" }; },
    now: () => NOW,
  };
  return { deps, calls, challenge };
}

test("an undelivered WhatsApp OTP is sent again by SMS, replacing the WhatsApp challenge", async () => {
  const { deps, calls, challenge } = harness();
  assert.equal(await sendSmsBackupForFailedOtp("c1", deps), "sent");
  assert.equal(challenge!.status, "superseded");
  assert.deepEqual(calls.sent, [{ shopId: "s1", phoneE164: "+919800000000", expiresAt: new Date(NOW.getTime() + SMS_BACKUP_TTL_MS), fallbackFrom: "c1" }]);
  assert.deepEqual(calls.metadata.at(-1), { mode: "whatsapp", codeHash: "h", smsBackup: { status: "sent", challengeId: "sms1", at: NOW.toISOString() } });
});

test("only a pending, unexpired WhatsApp challenge gets a backup, and only once", async () => {
  assert.equal(await sendSmsBackupForFailedOtp("c1", harness({ challenge: null }).deps), "not_pending");
  assert.equal(await sendSmsBackupForFailedOtp("c1", harness({ challenge: { status: "verified" } }).deps), "not_pending");
  assert.equal(await sendSmsBackupForFailedOtp("c1", harness({ challenge: { provider: "twilio" } }).deps), "not_pending");
  assert.equal(await sendSmsBackupForFailedOtp("c1", harness({ challenge: { expiresAt: new Date(NOW.getTime() - 1) } }).deps), "expired");
  assert.equal(await sendSmsBackupForFailedOtp("c1", harness({ challenge: { metadata: { smsBackup: { status: "sent" } } } }).deps), "already_tried");
});

test("no SMS when the shop's OTP settings don't allow it, or after too many backups", async () => {
  const off = harness({ sms: { available: false, reason: "PLATFORM_TWILIO_NOT_CONFIGURED" } });
  assert.equal(await sendSmsBackupForFailedOtp("c1", off.deps), "sms_unavailable");
  assert.equal(off.calls.sent.length, 0);
  assert.equal(off.challenge!.status, "pending");
  assert.deepEqual((off.calls.metadata[0].smsBackup as Record<string, unknown>).reason, "PLATFORM_TWILIO_NOT_CONFIGURED");
  const busy = harness({ recent: 3 });
  assert.equal(await sendSmsBackupForFailedOtp("c1", busy.deps), "limited");
  assert.equal(busy.calls.sent.length, 0);
});

test("if the SMS can't be sent, the WhatsApp challenge stays usable", async () => {
  const { deps, calls, challenge } = harness({ sendFails: true });
  assert.equal(await sendSmsBackupForFailedOtp("c1", deps), "sms_failed");
  assert.equal(calls.released, 1);
  assert.equal(challenge!.status, "pending");
  assert.equal((calls.metadata.at(-1)!.smsBackup as Record<string, unknown>).status, "failed");
});
