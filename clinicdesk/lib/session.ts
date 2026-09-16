import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { hashToken, numericCode, randomToken, safeEqual } from "@/lib/ids";

// `cookies()` is async in Next 16 — synchronous access was removed
// (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md).

const COOKIE = "cd_session";
const SESSION_DAYS = 14;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

export type StaffSessionContext = {
  staffUserId: string;
  clinicId: string;
  fullName: string;
  email: string;
  role: "OWNER" | "PRACTITIONER" | "FRONT_DESK";
  practitionerId: string | null;
  clinicName: string;
  clinicTimezone: string;
  clinicLocale: string;
  clinicCurrency: string;
};

/**
 * Issues a one-time login code.
 *
 * Always reports success, whether or not the address exists — a login form that
 * distinguishes the two is an account-enumeration oracle, and here the accounts
 * are healthcare practitioners.
 */
export async function requestLoginCode(email: string) {
  const staffUser = await prisma.staffUser.findFirst({
    where: { email: email.trim().toLowerCase(), isActive: true },
    include: { clinic: { select: { name: true } } },
  });
  if (!staffUser) return { sent: true as const };

  const code = numericCode(6);
  await prisma.loginChallenge.create({
    data: {
      staffUserId: staffUser.id,
      codeHash: hashToken(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  });

  if (process.env.DEV_LOGIN_CODES === "true" || !process.env.RESEND_API_KEY) {
    console.info(`[auth] login code for ${staffUser.email}: ${code}`);
  } else {
    const { Resend } = await import("resend");
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `ClinicDesk <no-reply@${process.env.NEXT_PUBLIC_ROOT_DOMAIN?.split(":")[0] ?? "clinicdesk.in"}>`,
      to: staffUser.email,
      subject: `${code} is your ${staffUser.clinic.name} sign-in code`,
      text: `Your sign-in code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
    });
  }

  return { sent: true as const };
}

export async function verifyLoginCode(email: string, code: string) {
  const staffUser = await prisma.staffUser.findFirst({
    where: { email: email.trim().toLowerCase(), isActive: true },
  });
  if (!staffUser) return { ok: false as const, error: "That code is not valid." };

  const challenge = await prisma.loginChallenge.findFirst({
    where: { staffUserId: staffUser.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false as const, error: "That code has expired. Request a new one." };

  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false as const, error: "Too many attempts. Request a new code." };
  }

  if (!safeEqual(challenge.codeHash, hashToken(code.trim()))) {
    await prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false as const, error: "That code is not valid." };
  }

  await prisma.loginChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.staffSession.create({
    data: { staffUserId: staffUser.id, tokenHash: hashToken(token), expiresAt },
  });
  await prisma.staffUser.update({
    where: { id: staffUser.id },
    data: { lastLoginAt: new Date() },
  });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  await recordAudit({
    clinicId: staffUser.clinicId,
    action: "LOGIN",
    resourceType: "StaffUser",
    resourceId: staffUser.id,
    actorStaffUserId: staffUser.id,
  });

  return { ok: true as const };
}

/** Deduped per request so a layout and its pages share one lookup. */
export const getStaffSession = cache(async (): Promise<StaffSessionContext | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      staffUser: {
        include: {
          practitioner: { select: { id: true } },
          clinic: { select: { name: true, timezone: true, locale: true, currency: true, status: true } },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  const { staffUser } = session;
  if (!staffUser.isActive || staffUser.clinic.status === "SUSPENDED") return null;

  return {
    staffUserId: staffUser.id,
    clinicId: staffUser.clinicId,
    fullName: staffUser.fullName,
    email: staffUser.email,
    role: staffUser.role,
    practitionerId: staffUser.practitioner?.id ?? null,
    clinicName: staffUser.clinic.name,
    clinicTimezone: staffUser.clinic.timezone,
    clinicLocale: staffUser.clinic.locale,
    clinicCurrency: staffUser.clinic.currency,
  };
});

export async function requireStaff(): Promise<StaffSessionContext> {
  const session = await getStaffSession();
  if (!session) redirect("/console/login");
  return session;
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await prisma.staffSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  store.delete(COOKIE);
}
