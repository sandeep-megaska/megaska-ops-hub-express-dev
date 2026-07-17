import { prisma } from "../db/prisma.ts";
import { recalculateProductReviewAggregate } from "./review-foundation.ts";

export type ReviewModerationAction = "PUBLISH" | "REJECT" | "UNPUBLISH";
export type ReviewModerationErrorCode = "REVIEW_NOT_FOUND" | "REVIEW_SHOP_MISMATCH" | "REVIEW_ALREADY_PUBLISHED" | "REVIEW_ALREADY_REJECTED" | "REVIEW_ALREADY_PENDING" | "REVIEW_INVALID_TRANSITION" | "REVIEW_REJECTION_REASON_INVALID";
type Status = "PENDING_MODERATION" | "PUBLISHED" | "REJECTED";
type Db = typeof prisma;

export function normalizeRejectionReason(value: unknown): { value: string | null; error?: undefined } | { value?: undefined; error: "REVIEW_REJECTION_REASON_INVALID" } {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string") return { error: "REVIEW_REJECTION_REASON_INVALID" };
  const normalized = value.trim();
  if (!normalized) return { value: null };
  if (normalized.length > 500 || /[\u0000-\u001F\u007F]/.test(normalized) || /<\/?[a-z][^>]*>/i.test(normalized)) return { error: "REVIEW_REJECTION_REASON_INVALID" };
  return { value: normalized };
}

function transitionError(status: Status, action: ReviewModerationAction): ReviewModerationErrorCode {
  if (action === "PUBLISH" && status === "PUBLISHED") return "REVIEW_ALREADY_PUBLISHED";
  if (action === "REJECT" && status === "REJECTED") return "REVIEW_ALREADY_REJECTED";
  if (action === "UNPUBLISH" && status === "PENDING_MODERATION") return "REVIEW_ALREADY_PENDING";
  return "REVIEW_INVALID_TRANSITION";
}

export async function moderateReview(input: { shopId: string; reviewId: string; action: ReviewModerationAction; rejectionReason?: unknown; actorId: string; now?: Date; db?: Db }): Promise<{ ok: true; review: { id: string; status: Status; publishedAt: Date | null; moderatedAt: Date | null; moderatedBy: string | null; rejectionReason: string | null } } | { ok: false; errorCode: ReviewModerationErrorCode }> {
  const reason = normalizeRejectionReason(input.rejectionReason);
  if (reason.error) return { ok: false, errorCode: reason.error };
  const db = input.db ?? prisma; const now = input.now ?? new Date();
  const review = await db.productReview.findFirst({ where: { id: input.reviewId, shopId: input.shopId }, select: { id: true, shopId: true, shopifyProductId: true, status: true } });
  if (!review) return { ok: false, errorCode: "REVIEW_NOT_FOUND" };
  if (!["PENDING_MODERATION", "PUBLISHED", "REJECTED"].includes(review.status)) return { ok: false, errorCode: "REVIEW_INVALID_TRANSITION" };
  const status = review.status as Status;
  const next: Record<ReviewModerationAction, Status> = { PUBLISH: "PUBLISHED", REJECT: "REJECTED", UNPUBLISH: "PENDING_MODERATION" };
  if ((status === "PENDING_MODERATION" && !["PUBLISH", "REJECT"].includes(input.action)) || (status === "PUBLISHED" && !["REJECT", "UNPUBLISH"].includes(input.action)) || (status === "REJECTED" && !["PUBLISH", "UNPUBLISH"].includes(input.action))) return { ok: false, errorCode: transitionError(status, input.action) };
  return db.$transaction(async (tx) => {
    const data = input.action === "PUBLISH" ? { status: next[input.action], publishedAt: now, rejectionReason: null, moderatedAt: now, moderatedBy: input.actorId } : input.action === "REJECT" ? { status: next[input.action], publishedAt: null, rejectionReason: reason.value, moderatedAt: now, moderatedBy: input.actorId, rejectedAt: now } : { status: next[input.action], publishedAt: null, rejectionReason: null, moderatedAt: now, moderatedBy: input.actorId };
    const updated = await tx.productReview.update({ where: { id: review.id }, data, select: { id: true, status: true, publishedAt: true, moderatedAt: true, moderatedBy: true, rejectionReason: true } });
    if (status === "PUBLISHED" || updated.status === "PUBLISHED") await recalculateProductReviewAggregate(review.shopId, review.shopifyProductId, tx);
    return { ok: true as const, review: updated as { id: string; status: Status; publishedAt: Date | null; moderatedAt: Date | null; moderatedBy: string | null; rejectionReason: string | null } };
  });
}
