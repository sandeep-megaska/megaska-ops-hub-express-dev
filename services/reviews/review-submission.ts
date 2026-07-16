import { prisma } from "../db/prisma.ts";
import { getReviewSettings } from "./review-settings.ts";
import { findReviewRequestByToken, hashReviewToken, normalizeReviewToken } from "./review-token.ts";
import { normalizeReviewBody, normalizeReviewDisplayName, normalizeReviewTitle } from "./review-content.ts";
import { defaultReviewDisplayName } from "./review-display-name.ts";
import { recalculateProductReviewAggregate } from "./review-foundation.ts";

type Db = typeof prisma;
type ErrorCode = "REVIEW_TOKEN_INVALID" | "REVIEW_TOKEN_EXPIRED" | "REVIEW_TOKEN_REQUEST_INACTIVE" | "REVIEW_ALREADY_SUBMITTED" | "REVIEW_SHOP_MISMATCH" | "REVIEWS_DISABLED" | "REVIEW_PRODUCT_UNAVAILABLE" | "REVIEW_CUSTOMER_SESSION_MISMATCH";
export type SubmissionResult = { ok: true; review: { status: "PENDING_MODERATION" | "PUBLISHED"; verifiedPurchase: true } } | { ok: false; errorCode: ErrorCode | "REVIEW_VALIDATION_FAILED"; fieldErrors?: Record<string, string> };
type ReviewSubmissionContext =
  | { ok: true; request: { tokenExpiresAt: Date; productTitle: string; variantTitle: string | null; productImageUrl: string | null; orderName: string | null; verifiedPurchase: true }; settings: { minimumRating: number; maximumRating: number; minimumBodyLength: number; maximumBodyLength: number; moderationRequired: boolean; allowMedia: boolean }; shop: { displayName: string } }
  | { ok: false; errorCode: ErrorCode };

function safeImage(url: string | null) { try { return url && new URL(url).protocol === "https:" ? url : null; } catch { return null; } }
export async function getReviewSubmissionContext({ token, shopId, now = new Date(), db = prisma }: { token: unknown; shopId: string; now?: Date; db?: Db }): Promise<ReviewSubmissionContext> {
  const found = await findReviewRequestByToken(token, { now, db });
  if (!found.ok) return found;
  if (found.reviewRequest.shopId !== shopId) return { ok: false as const, errorCode: "REVIEW_SHOP_MISMATCH" as const };
  const request = await db.reviewRequest.findUnique({ where: { id: found.reviewRequest.id }, include: { review: { select: { id: true } } } });
  if (!request || !request.sentAt || request.completedAt || request.canceledAt || !["SENT", "REMINDER_SENT"].includes(request.status)) return { ok: false as const, errorCode: "REVIEW_TOKEN_REQUEST_INACTIVE" as const };
  if (request.review) return { ok: false as const, errorCode: "REVIEW_ALREADY_SUBMITTED" as const };
  const settings = await getReviewSettings(shopId, db);
  if (!settings.reviewsEnabled) return { ok: false as const, errorCode: "REVIEWS_DISABLED" as const };
  if (!request.productTitleSnapshot.trim()) return { ok: false as const, errorCode: "REVIEW_PRODUCT_UNAVAILABLE" as const };
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { shopName: true, shopDomain: true } });
  return { ok: true as const, request: { tokenExpiresAt: request.tokenExpiresAt!, productTitle: request.productTitleSnapshot, variantTitle: request.variantTitleSnapshot, productImageUrl: safeImage(request.productImageUrlSnapshot), orderName: request.shopifyOrderName, verifiedPurchase: true as const }, settings: { minimumRating: settings.minimumRating, maximumRating: settings.maximumRating, minimumBodyLength: 0, maximumBodyLength: 5000, moderationRequired: settings.moderationRequired, allowMedia: false }, shop: { displayName: shop?.shopName || shop?.shopDomain || "This store" } };
}

export async function submitVerifiedReview(input: { token: unknown; shopId: string; rating: unknown; title?: unknown; body?: unknown; customerDisplayName?: unknown; sessionCustomerProfileId?: string | null; now?: Date; db?: Db }): Promise<SubmissionResult> {
  const { db = prisma, now = new Date() } = input;
  const context = await getReviewSubmissionContext({ token: input.token, shopId: input.shopId, now, db });
  if (!context.ok) return context;
  if (typeof input.rating !== "number" || !Number.isInteger(input.rating) || input.rating < context.settings.minimumRating || input.rating > context.settings.maximumRating) return { ok: false, errorCode: "REVIEW_VALIDATION_FAILED", fieldErrors: { rating: `Choose a rating from ${context.settings.minimumRating} to ${context.settings.maximumRating}.` } };
  const title = normalizeReviewTitle(input.title); const body = normalizeReviewBody(input.body);
  if (title.error || body.error) return { ok: false, errorCode: "REVIEW_VALIDATION_FAILED", fieldErrors: { ...(title.error ? { title: title.error } : {}), ...(body.error ? { body: body.error } : {}) } };
  const token = normalizeReviewToken(input.token); if (!token) return { ok: false, errorCode: "REVIEW_TOKEN_INVALID" };
  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.reviewRequest.findUnique({ where: { tokenHash: hashReviewToken(token) }, include: { review: true, customerProfile: { select: { firstName: true, lastName: true } } } });
      if (!request || request.shopId !== input.shopId) return { ok: false as const, errorCode: request ? "REVIEW_SHOP_MISMATCH" as const : "REVIEW_TOKEN_INVALID" as const };
      if (request.review) { await tx.reviewRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: request.completedAt || now, tokenHash: null, tokenExpiresAt: null } }); return { ok: false as const, errorCode: "REVIEW_ALREADY_SUBMITTED" as const }; }
      if (!request.tokenExpiresAt || request.tokenExpiresAt <= now) return { ok: false as const, errorCode: "REVIEW_TOKEN_EXPIRED" as const };
      if (!request.sentAt || request.completedAt || request.canceledAt || !["SENT", "REMINDER_SENT"].includes(request.status)) return { ok: false as const, errorCode: "REVIEW_TOKEN_REQUEST_INACTIVE" as const };
      if (input.sessionCustomerProfileId && input.sessionCustomerProfileId !== request.customerProfileId) return { ok: false as const, errorCode: "REVIEW_CUSTOMER_SESSION_MISMATCH" as const };
      const settings = await getReviewSettings(input.shopId, tx);
      if (!settings.reviewsEnabled) return { ok: false as const, errorCode: "REVIEWS_DISABLED" as const };
      const display = input.customerDisplayName === undefined ? { value: defaultReviewDisplayName(request.customerProfile) } : normalizeReviewDisplayName(input.customerDisplayName);
      if (display.error || !display.value) return { ok: false as const, errorCode: "REVIEW_VALIDATION_FAILED" as const, fieldErrors: { customerDisplayName: display.error || "Enter a display name." } };
      const status = settings.moderationRequired ? "PENDING_MODERATION" as const : "PUBLISHED" as const;
      const review = await tx.productReview.create({ data: { shopId: request.shopId, customerProfileId: request.customerProfileId, reviewRequestId: request.id, megaskaOrderId: request.megaskaOrderId, shopifyOrderId: request.shopifyOrderId, shopifyLineItemId: request.shopifyLineItemId, shopifyProductId: request.shopifyProductId, shopifyVariantId: request.shopifyVariantId, source: "VERIFIED_PURCHASE", status, rating: input.rating, title: title.value, body: body.value, customerDisplayName: display.value, verifiedPurchase: true, productTitleSnapshot: request.productTitleSnapshot, variantTitleSnapshot: request.variantTitleSnapshot, productHandleSnapshot: request.productHandleSnapshot, publishedAt: status === "PUBLISHED" ? now : null } });
      await tx.reviewRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: now, tokenHash: null, tokenExpiresAt: null } });
      if (status === "PUBLISHED") await recalculateProductReviewAggregate(request.shopId, request.shopifyProductId, tx);
      return { ok: true as const, review: { status: review.status as "PENDING_MODERATION" | "PUBLISHED", verifiedPurchase: true as const } };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ok: false, errorCode: "REVIEW_ALREADY_SUBMITTED" };
    throw error;
  }
}
