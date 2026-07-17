import { prisma } from "../db/prisma.ts";
import { normalizeReviewBody } from "./review-content.ts";
import { recalculateProductReviewAggregate } from "./review-foundation.ts";

export type ReviewModerationAction = "PUBLISH" | "REJECT" | "UNPUBLISH";
export type ReviewModerationErrorCode = "REVIEW_NOT_FOUND" | "REVIEW_SHOP_MISMATCH" | "REVIEW_ALREADY_PUBLISHED" | "REVIEW_ALREADY_REJECTED" | "REVIEW_ALREADY_PENDING" | "REVIEW_INVALID_TRANSITION" | "REVIEW_REJECTION_REASON_INVALID";
type ReviewStatus = "PENDING_MODERATION" | "PUBLISHED" | "REJECTED";
type ModerationDb = Pick<typeof prisma, "$transaction"> & { productReview: { findFirst(args: unknown): Promise<{ id: string; shopId: string; shopifyProductId: string; status: string } | null>; update(args: unknown): Promise<unknown> } };
export type ReviewModerationResult = { ok: true; status: ReviewStatus } | { ok: false; errorCode: ReviewModerationErrorCode };

export function normalizeRejectionReason(value: unknown) {
  return normalizeReviewBody(value === undefined ? undefined : value);
}
function conflict(status: string): ReviewModerationErrorCode {
  if (status === "PUBLISHED") return "REVIEW_ALREADY_PUBLISHED";
  if (status === "REJECTED") return "REVIEW_ALREADY_REJECTED";
  if (status === "PENDING_MODERATION") return "REVIEW_ALREADY_PENDING";
  return "REVIEW_INVALID_TRANSITION";
}
const transition: Record<ReviewModerationAction, Partial<Record<ReviewStatus, ReviewStatus>>> = {
  PUBLISH: { PENDING_MODERATION: "PUBLISHED", REJECTED: "PUBLISHED" },
  REJECT: { PENDING_MODERATION: "REJECTED", PUBLISHED: "REJECTED" },
  UNPUBLISH: { PUBLISHED: "PENDING_MODERATION", REJECTED: "PENDING_MODERATION" },
};
export async function moderateReview(input: { shopId: string; reviewId: string; action: ReviewModerationAction; rejectionReason?: unknown; actorId: string; now?: Date; db?: ModerationDb }): Promise<ReviewModerationResult> {
  const db = input.db ?? prisma as ModerationDb; const now = input.now ?? new Date();
  const reason = normalizeRejectionReason(input.rejectionReason);
  if (reason.error || reason.value?.length && reason.value.length > 500) return { ok: false, errorCode: "REVIEW_REJECTION_REASON_INVALID" };
  return db.$transaction(async (tx: ModerationDb) => {
    const review = await tx.productReview.findFirst({ where: { id: input.reviewId, shopId: input.shopId }, select: { id: true, shopId: true, shopifyProductId: true, status: true } });
    if (!review) return { ok: false as const, errorCode: "REVIEW_NOT_FOUND" as const };
    const previousStatus = review.status;
    const next = transition[input.action][previousStatus as ReviewStatus];
    if (!next) return { ok: false as const, errorCode: conflict(review.status) };
    const data = input.action === "PUBLISH" ? { status: next, publishedAt: now, rejectionReason: null, moderatedAt: now, moderatedBy: input.actorId } : input.action === "REJECT" ? { status: next, publishedAt: null, rejectionReason: reason.value, moderatedAt: now, moderatedBy: input.actorId } : { status: next, publishedAt: null, rejectionReason: null, moderatedAt: now, moderatedBy: input.actorId };
    await tx.productReview.update({ where: { id: review.id }, data });
    if (previousStatus === "PUBLISHED" || next === "PUBLISHED") await recalculateProductReviewAggregate(review.shopId, review.shopifyProductId, tx);
    return { ok: true as const, status: next };
  });
}
