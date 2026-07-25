import crypto from "crypto";
import { prisma } from "../db/prisma";

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;

function generateCode() {
  const max = 10 ** CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(CODE_LENGTH, "0");
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function codesMatch(providedHash: string, storedHash: string) {
  const a = Buffer.from(providedHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type CreateEmailVerificationChallengeResult =
  | { created: true; code: string }
  | { created: false; reason: "COOLDOWN" };

/** Issues a fresh one-time code, unless a live one for this email was just sent. */
export async function createEmailVerificationChallenge(input: {
  shopId: string;
  customerProfileId: string;
  email: string;
  candidateShopifyCustomerId: string;
}): Promise<CreateEmailVerificationChallengeResult> {
  const email = input.email.trim().toLowerCase();

  const recent = await prisma.emailVerificationChallenge.findFirst({
    where: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      email,
      status: "pending",
      createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recent) {
    return { created: false, reason: "COOLDOWN" };
  }

  const code = generateCode();

  await prisma.emailVerificationChallenge.create({
    data: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      email,
      candidateShopifyCustomerId: input.candidateShopifyCustomerId,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    },
  });

  return { created: true, code };
}

export type VerifyEmailVerificationChallengeResult =
  | { ok: true; candidateShopifyCustomerId: string; email: string }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "INCORRECT_CODE" };

export async function verifyEmailVerificationChallenge(input: {
  shopId: string;
  customerProfileId: string;
  email: string;
  code: string;
}): Promise<VerifyEmailVerificationChallengeResult> {
  const email = input.email.trim().toLowerCase();

  const challenge = await prisma.emailVerificationChallenge.findFirst({
    where: {
      shopId: input.shopId,
      customerProfileId: input.customerProfileId,
      email,
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    await prisma.emailVerificationChallenge.update({
      where: { id: challenge.id },
      data: { status: "expired" },
    });
    return { ok: false, reason: "EXPIRED" };
  }

  if (challenge.attemptsCount >= MAX_ATTEMPTS) {
    await prisma.emailVerificationChallenge.update({
      where: { id: challenge.id },
      data: { status: "failed" },
    });
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }

  const providedHash = hashCode(String(input.code || "").trim());

  if (!codesMatch(providedHash, challenge.codeHash)) {
    await prisma.emailVerificationChallenge.update({
      where: { id: challenge.id },
      data: { attemptsCount: { increment: 1 } },
    });
    return { ok: false, reason: "INCORRECT_CODE" };
  }

  await prisma.emailVerificationChallenge.update({
    where: { id: challenge.id },
    data: { status: "verified", verifiedAt: new Date() },
  });

  return { ok: true, candidateShopifyCustomerId: challenge.candidateShopifyCustomerId, email };
}
