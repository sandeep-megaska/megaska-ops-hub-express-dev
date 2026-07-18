import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.ts";

export const DEFAULT_REVIEW_REQUEST_TOKEN_TTL_DAYS = 30;
export const REVIEW_REQUEST_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,200}$/;
const ELIGIBLE_STATUSES = new Set(["SCHEDULED", "READY", "SENT", "DELIVERED", "OPENED", "CLICKED", "REMINDER_SENT"]);
const CONSUMED_STATUS = "SUBMITTED";

export type ReviewRequestTokenConsumeResult = { ok: true } | { ok: false; reason: "TOKEN_CONSUMED" };

type Db = typeof prisma;

export function reviewRequestTokenTtlDays(value = process.env.REVIEW_REQUEST_TOKEN_TTL_DAYS): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 90 ? parsed : DEFAULT_REVIEW_REQUEST_TOKEN_TTL_DAYS;
}

export function hashReviewRequestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeReviewRequestToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return TOKEN_PATTERN.test(trimmed) ? trimmed : null;
}

export function createReviewRequestToken(input: { now?: Date; expiresAt?: Date } = {}) {
  const now = input.now ?? new Date();
  const token = randomBytes(REVIEW_REQUEST_TOKEN_BYTES).toString("base64url");
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + reviewRequestTokenTtlDays() * 86_400_000);
  return { token, tokenHash: hashReviewRequestToken(token), expiresAt, tokenCreatedAt: now };
}

export async function issueReviewRequestToken(input: { reviewRequestId: string; shopId: string; now?: Date; expiresAt?: Date; db?: Db }) {
  const db = input.db ?? prisma;
  const generated = createReviewRequestToken({ now: input.now, expiresAt: input.expiresAt });
  const updated = await db.reviewRequest.updateMany({
    where: { id: input.reviewRequestId, shopId: input.shopId, status: { in: [...ELIGIBLE_STATUSES] as never }, suppressedAt: null, completedAt: null, canceledAt: null },
    data: { tokenHash: generated.tokenHash, tokenCreatedAt: generated.tokenCreatedAt, tokenExpiresAt: generated.expiresAt, expiresAt: generated.expiresAt, tokenConsumedAt: null, tokenRevokedAt: null },
  });
  return updated.count === 1 ? { ok: true as const, token: generated.token, expiresAt: generated.expiresAt } : { ok: false as const, reason: "REQUEST_NOT_ELIGIBLE" as const };
}

export function buildReviewSubmissionUrl(input: { baseUrl: string; token: string }) {
  const url = new URL(input.baseUrl);
  url.pathname = "/customer/reviews/write";
  url.search = "";
  url.searchParams.set("token", input.token);
  return url.toString();
}

export async function consumeReviewRequestToken(input: { reviewRequestId: string; reviewId: string; consumedAt?: Date; db?: Db }): Promise<ReviewRequestTokenConsumeResult> {
  const db = input.db ?? prisma;
  const consumedAt = input.consumedAt ?? new Date();
  const updated = await db.reviewRequest.updateMany({
    where: { id: input.reviewRequestId, tokenConsumedAt: null, tokenRevokedAt: null },
    data: { tokenConsumedAt: consumedAt, submittedReviewId: input.reviewId, submittedAt: consumedAt, completedAt: consumedAt, status: CONSUMED_STATUS },
  });
  return updated.count === 1 ? { ok: true } : { ok: false, reason: "TOKEN_CONSUMED" };
}

export function isReviewRequestTokenEligibleStatus(status: string) {
  return ELIGIBLE_STATUSES.has(status);
}
