// Automatic SMS backup for WhatsApp OTPs. Meta accepts a WhatsApp OTP and only
// reports later (status webhook) that it couldn't deliver it: number not on
// WhatsApp, the WhatsApp account out of funds (130429 / 131042), and so on. The
// shopper would wait for a code that never comes, so the code is sent again by
// SMS (platform Twilio Verify) when the shop's OTP settings allow SMS. The
// WhatsApp challenge is superseded and the SMS challenge becomes the one to
// verify (the verify route takes the newest pending challenge for the phone).

export const SMS_BACKUP_WINDOW_MINUTES = 15;
export const SMS_BACKUP_MAX_PER_WINDOW = 3;
// The SMS code stays valid this long (the same as a fresh request).
export const SMS_BACKUP_TTL_MS = 5 * 60 * 1000;

type Challenge = { id: string; shopId: string; phoneE164: string; provider: string; status: string; expiresAt: Date; metadata: unknown };

export type SmsBackupDeps = {
  findChallenge(id: string): Promise<Challenge | null>;
  // Claims the WhatsApp challenge (pending -> superseded) with the backup note; false if it moved on.
  claim(id: string, metadata: Record<string, unknown>): Promise<boolean>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  // Puts the WhatsApp challenge back to pending (the SMS couldn't be sent).
  release(id: string, metadata: Record<string, unknown>): Promise<void>;
  recentBackups(shopId: string, phoneE164: string, since: Date): Promise<number>;
  smsAvailable(shopId: string): Promise<{ available: true } | { available: false; reason: string }>;
  sendSms(input: { shopId: string; phoneE164: string; expiresAt: Date; fallbackFrom: string }): Promise<{ challengeId: string }>;
  now(): Date;
};

export type SmsBackupOutcome = "sent" | "not_pending" | "expired" | "already_tried" | "sms_unavailable" | "limited" | "sms_failed";

const metadataOf = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export async function sendSmsBackupForFailedOtp(challengeId: string, deps: SmsBackupDeps): Promise<SmsBackupOutcome> {
  const challenge = await deps.findChallenge(challengeId);
  if (!challenge || challenge.provider !== "whatsapp" || challenge.status !== "pending") return "not_pending";
  const now = deps.now();
  if (challenge.expiresAt.getTime() <= now.getTime()) return "expired";
  const metadata = metadataOf(challenge.metadata);
  if (metadata.smsBackup) return "already_tried";

  const sms = await deps.smsAvailable(challenge.shopId);
  if (!sms.available) {
    await deps.updateMetadata(challenge.id, { ...metadata, smsBackup: { status: "unavailable", reason: sms.reason, at: now.toISOString() } });
    return "sms_unavailable";
  }
  // A shopper (or a bot) asking again and again doesn't run up SMS costs.
  if ((await deps.recentBackups(challenge.shopId, challenge.phoneE164, new Date(now.getTime() - SMS_BACKUP_WINDOW_MINUTES * 60_000))) >= SMS_BACKUP_MAX_PER_WINDOW) {
    await deps.updateMetadata(challenge.id, { ...metadata, smsBackup: { status: "limited", at: now.toISOString() } });
    return "limited";
  }

  const sending = { ...metadata, smsBackup: { status: "sending", at: now.toISOString() } };
  if (!(await deps.claim(challenge.id, sending))) return "not_pending";
  try {
    const sent = await deps.sendSms({ shopId: challenge.shopId, phoneE164: challenge.phoneE164, expiresAt: new Date(now.getTime() + SMS_BACKUP_TTL_MS), fallbackFrom: challenge.id });
    await deps.updateMetadata(challenge.id, { ...metadata, smsBackup: { status: "sent", challengeId: sent.challengeId, at: now.toISOString() } });
    return "sent";
  } catch (error) {
    await deps.release(challenge.id, { ...metadata, smsBackup: { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 200), at: now.toISOString() } });
    return "sms_failed";
  }
}

export async function prismaSmsBackupDeps(): Promise<SmsBackupDeps> {
  const { prisma } = await import("../db/prisma.ts");
  return {
    findChallenge: (id) => prisma.oTPChallenge.findUnique({ where: { id }, select: { id: true, shopId: true, phoneE164: true, provider: true, status: true, expiresAt: true, metadata: true } }),
    claim: async (id, metadata) => (await prisma.oTPChallenge.updateMany({ where: { id, status: "pending" }, data: { status: "superseded", metadata: metadata as object } })).count === 1,
    updateMetadata: async (id, metadata) => { await prisma.oTPChallenge.update({ where: { id }, data: { metadata: metadata as object } }); },
    release: async (id, metadata) => { await prisma.oTPChallenge.updateMany({ where: { id, status: "superseded" }, data: { status: "pending", metadata: metadata as object } }); },
    recentBackups: (shopId, phoneE164, since) => prisma.oTPChallenge.count({ where: { shopId, phoneE164, provider: "twilio", createdAt: { gt: since }, metadata: { path: ["fallbackFrom"], string_starts_with: "" } } }),
    smsAvailable: async (shopId) => {
      const { resolveOtpProviderForShop } = await import("../auth/otp-provider-resolver.ts");
      const resolution = await resolveOtpProviderForShop(shopId);
      return resolution.available ? { available: true } : { available: false, reason: resolution.reason };
    },
    sendSms: async (input) => (await import("../auth/sms-otp-challenge.ts")).createSmsOtpChallenge(input),
    now: () => new Date(),
  };
}
