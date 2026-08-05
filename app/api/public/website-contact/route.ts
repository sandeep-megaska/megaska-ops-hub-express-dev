import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "../../../../services/db/prisma";
import { withCors, handleOptions } from "../../_lib/cors";
import { rateLimit } from "../../../../services/reviews/review-submission-http";
import { formatPlatformFrom, getPlatformAdminEmailTransport } from "../../../../services/notifications/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, unauthenticated endpoint for the marketing website's Contact form.
// The website posts here; the app owns the DB write (single owner of schema +
// credentials). Submissions land in WebsiteContactSubmission — a clearly
// website-scoped table in the shared app database.

const MAX = {
  name: 200,
  email: 254,
  company: 200,
  subject: 300,
  message: 5000,
  enquiryType: 80,
  shopDomain: 255,
} as const;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEmail(value: string): boolean {
  return value.length <= MAX.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  // Public endpoint → rate-limit by IP to blunt spam/abuse (in-memory per instance).
  if (!rateLimit(req, "website-contact", 5, 60_000)) {
    return withCors(
      req,
      NextResponse.json(
        { ok: false, error: "Too many requests. Please try again in a minute." },
        { status: 429 },
      ),
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return withCors(req, NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 }));
  }

  // Honeypot: a hidden field real users never fill. If populated, it's a bot —
  // return a fake success so the bot doesn't learn the trap, and store nothing.
  if (str(body.website)) {
    return withCors(req, NextResponse.json({ ok: true }, { status: 200 }));
  }

  const name = str(body.name).slice(0, MAX.name);
  const email = str(body.email).toLowerCase().slice(0, MAX.email);
  const message = str(body.message).slice(0, MAX.message);
  const company = str(body.company).slice(0, MAX.company) || null;
  const subject = str(body.subject).slice(0, MAX.subject) || null;
  const enquiryType = str(body.enquiryType).slice(0, MAX.enquiryType) || null;
  const shopDomain = str(body.shopDomain).slice(0, MAX.shopDomain) || null;

  const errors: string[] = [];
  if (!name) errors.push("Name is required");
  if (!isEmail(email)) errors.push("A valid email is required");
  if (message.length < 2) errors.push("A message is required");
  if (errors.length) {
    return withCors(req, NextResponse.json({ ok: false, error: errors.join(". ") }, { status: 400 }));
  }

  // Store only a salted hash of the IP (spam triage) — never the raw address.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const sourceIpHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 32) : null;
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 400) || null;

  let submissionId: string;
  try {
    const created = await prisma.websiteContactSubmission.create({
      data: { name, email, company, shopDomain, enquiryType, subject, message, sourceIpHash, userAgent },
      select: { id: true },
    });
    submissionId = created.id;
  } catch (error) {
    console.error("[WEBSITE CONTACT] failed to store submission", {
      error: error instanceof Error ? error.message : String(error),
    });
    return withCors(
      req,
      NextResponse.json(
        { ok: false, error: "We couldn't submit your message. Please try again." },
        { status: 500 },
      ),
    );
  }

  // Best-effort notification. The submission is already safely stored above, so
  // a missing/failed email never fails the request. Fires only when a destination
  // (WEBSITE_CONTACT_NOTIFY_EMAIL) and the platform Resend transport are configured.
  void notifyTeam({ submissionId, name, email, company, subject, enquiryType, message }).catch((error) => {
    console.warn("[WEBSITE CONTACT] notification failed", {
      submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return withCors(req, NextResponse.json({ ok: true, id: submissionId }, { status: 201 }));
}

async function notifyTeam(input: {
  submissionId: string;
  name: string;
  email: string;
  company: string | null;
  subject: string | null;
  enquiryType: string | null;
  message: string;
}): Promise<void> {
  const to = String(process.env.WEBSITE_CONTACT_NOTIFY_EMAIL || "").trim();
  if (!to) return;

  const transport = getPlatformAdminEmailTransport();
  if (!transport.enabled || !transport.apiKey) return;

  const from = formatPlatformFrom("LoopD2C Website", transport.rawPlatformSender);
  if (!from) return;

  const text = [
    "New website contact submission",
    "",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.company ? `Company: ${input.company}` : null,
    input.enquiryType ? `Enquiry type: ${input.enquiryType}` : null,
    input.subject ? `Subject: ${input.subject}` : null,
    "",
    input.message,
    "",
    `Submission id: ${input.submissionId}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${transport.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: input.email,
      subject: `Website contact: ${input.subject || input.name}`,
      text,
    }),
  });
}
