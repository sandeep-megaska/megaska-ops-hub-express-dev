import { prisma } from "../db/prisma.ts";
import { getReviewSettings } from "./review-settings.ts";
import { findReviewRequestByToken, hashReviewToken, normalizeReviewToken, type ReviewTokenErrorCode } from "./review-token.ts";
import { normalizeReviewBody, normalizeReviewDisplayName, normalizeReviewTitle } from "./review-content.ts";
import { defaultReviewDisplayName } from "./review-display-name.ts";
import { recalculateProductReviewAggregate } from "./review-foundation.ts";
import { validateReviewSubmissionInput, type ReviewSubmissionInput } from "./review-submission-input.ts";
import { evaluateReviewSubmissionEligibility, type ReviewSubmissionEligibilityDependencies, type ReviewSubmissionEligibilityReason } from "./review-submission-eligibility.ts";
import { sendNewReviewAdminNotification, type NewReviewAdminNotificationInput } from "./review-admin-notification.ts";

type Db = typeof prisma;
export type ReviewSubmissionDomainErrorCode = ReviewTokenErrorCode | "REVIEW_ALREADY_SUBMITTED" | "REVIEW_SHOP_MISMATCH" | "REVIEWS_DISABLED" | "REVIEW_PRODUCT_UNAVAILABLE" | "REVIEW_CUSTOMER_SESSION_MISMATCH";
export type ReviewSubmissionErrorCode = ReviewSubmissionDomainErrorCode | "REVIEW_VALIDATION_FAILED";
export type SubmissionResult = { ok: true; review: { status: "PENDING_MODERATION" | "PUBLISHED"; verifiedPurchase: true } } | { ok: false; errorCode: ReviewSubmissionErrorCode; fieldErrors?: Record<string, string> };
export type ReviewSubmissionContext = { ok: true; request: { tokenExpiresAt: Date; productTitle: string; variantTitle: string | null; productImageUrl: string | null; orderName: string | null; verifiedPurchase: true }; settings: { minimumRating: number; maximumRating: number; minimumBodyLength: number; maximumBodyLength: number; moderationRequired: boolean; allowMedia: boolean }; shop: { displayName: string } } | { ok: false; errorCode: ReviewSubmissionDomainErrorCode };

function safeImage(url: string | null) { try { return url && new URL(url).protocol === "https:" ? url : null; } catch { return null; } }
function parseReviewRating(value: unknown, minimum: number, maximum: number): { ok: true; rating: number } | { ok: false; message: string } { if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) return { ok: false, message: `Choose a rating from ${minimum} to ${maximum}.` }; return { ok: true, rating: value }; }
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
  const ratingResult = parseReviewRating(input.rating, context.settings.minimumRating, context.settings.maximumRating);
  if (!ratingResult.ok) return { ok: false, errorCode: "REVIEW_VALIDATION_FAILED", fieldErrors: { rating: ratingResult.message } };
  const rating = ratingResult.rating;
  const title = normalizeReviewTitle(input.title); const body = normalizeReviewBody(input.body);
  if (title.error || body.error) return { ok: false, errorCode: "REVIEW_VALIDATION_FAILED", fieldErrors: { ...(title.error ? { title: title.error } : {}), ...(body.error ? { body: body.error } : {}) } };
  const token = normalizeReviewToken(input.token); if (!token) return { ok: false, errorCode: "REVIEW_TOKEN_INVALID" };
  try {
    const committed = await db.$transaction(async (tx) => {
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
      const status: "PENDING_MODERATION" | "PUBLISHED" = settings.moderationRequired ? "PENDING_MODERATION" : "PUBLISHED";
      const review = await tx.productReview.create({ data: { shopId: request.shopId, customerProfileId: request.customerProfileId, reviewRequestId: request.id, megaskaOrderId: request.megaskaOrderId, shopifyOrderId: request.shopifyOrderId, shopifyLineItemId: request.shopifyLineItemId, shopifyProductId: request.shopifyProductId, shopifyVariantId: request.shopifyVariantId, source: "VERIFIED_PURCHASE", status, rating, title: title.value, body: body.value, customerDisplayName: display.value, verifiedPurchase: true, productTitleSnapshot: request.productTitleSnapshot, variantTitleSnapshot: request.variantTitleSnapshot, productHandleSnapshot: request.productHandleSnapshot, publishedAt: status === "PUBLISHED" ? now : null } });
      await tx.reviewRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: now, tokenHash: null, tokenExpiresAt: null } });
      if (status === "PUBLISHED") await recalculateProductReviewAggregate(request.shopId, request.shopifyProductId, tx);
      return {
        ok: true as const,
        review: { status: review.status as "PENDING_MODERATION" | "PUBLISHED", verifiedPurchase: true as const },
        notification: { shopId: request.shopId, reviewId: review.id, rating: review.rating, title: review.title, body: review.body, customerDisplayName: review.customerDisplayName, productTitle: review.productTitleSnapshot, variantTitle: review.variantTitleSnapshot, orderName: request.shopifyOrderName, verifiedPurchase: review.verifiedPurchase, status: review.status as "PENDING_MODERATION" | "PUBLISHED", submittedAt: review.submittedAt } satisfies NewReviewAdminNotificationInput,
      };
    });
    if (!committed.ok) return committed;
    await sendNewReviewAdminNotification(committed.notification);
    return { ok: true, review: committed.review };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { ok: false, errorCode: "REVIEW_ALREADY_SUBMITTED" };
    throw error;
  }
}


export type PendingReviewSource = "CUSTOMER_DASHBOARD" | "PRODUCT_PAGE" | "REVIEW_REQUEST_EMAIL" | "REVIEW_REQUEST_WHATSAPP";
export type SubmitReviewCommand = { shopId: string; customerProfileId: string; source: PendingReviewSource; reviewRequestId?: string | null; input: ReviewSubmissionInput };
export type PublicSubmittedReview = { id: string; productId: string; variantId: string | null; orderId: string; orderLineId: string; rating: number; title: string | null; body: string | null; verifiedPurchase: boolean; status: "PENDING_MODERATION"; source: PendingReviewSource; submittedAt: Date };
type CreatedPendingReview = { id: string; shopId: string; shopifyProductId: string; shopifyVariantId: string | null; shopifyOrderId: string | null; shopifyLineItemId: string | null; rating: number; title: string | null; body: string | null; customerDisplayName: string; verifiedPurchase: boolean; productTitleSnapshot: string; variantTitleSnapshot: string | null; status: string; source: string; submittedAt: Date };
type PendingReviewDb = { productReview: { create(args: { data: Record<string, unknown> }): Promise<CreatedPendingReview> }; reviewRequest?: { updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> }; $transaction?: <T>(fn: (tx: PendingReviewDb) => Promise<T>) => Promise<T> };
export type ReviewSubmissionDependencies = { db?: PendingReviewDb; now?: () => Date; notifyAdmin?: typeof sendNewReviewAdminNotification };

export type ReviewSubmissionApiDomainErrorCode = ReviewSubmissionEligibilityReason | "REQUEST_NOT_ELIGIBLE" | "TOKEN_CONSUMED";
export class ReviewSubmissionDomainError extends Error {
  readonly code: ReviewSubmissionApiDomainErrorCode;
  constructor(code: ReviewSubmissionApiDomainErrorCode) { super(code); this.name = "ReviewSubmissionDomainError"; this.code = code; }
}

function isDuplicateReviewError(error: unknown) {
  const value = error as { code?: string; meta?: { target?: unknown } };
  return value?.code === "P2002";
}

function publicSubmittedReview(review: CreatedPendingReview): PublicSubmittedReview {
  return { id: review.id, productId: review.shopifyProductId, variantId: review.shopifyVariantId, orderId: review.shopifyOrderId || "", orderLineId: review.shopifyLineItemId || "", rating: review.rating, title: review.title, body: review.body, verifiedPurchase: review.verifiedPurchase, status: "PENDING_MODERATION", source: review.source as PendingReviewSource, submittedAt: review.submittedAt };
}

async function createPendingReviewRecord(command: SubmitReviewCommand, dependencies: ReviewSubmissionDependencies, snapshot?: { productTitle: string; variantTitle: string | null }): Promise<CreatedPendingReview> {
  const input = validateReviewSubmissionInput(command.input);
  const db = dependencies.db ?? (prisma as unknown as PendingReviewDb);
  const now = dependencies.now?.() ?? new Date();
  try {
    return await db.productReview.create({ data: { shopId: command.shopId, customerProfileId: command.customerProfileId, reviewRequestId: command.reviewRequestId ?? null, megaskaOrderId: input.orderId, shopifyOrderId: input.orderId, shopifyLineItemId: input.orderLineId, shopifyProductId: input.productId, shopifyVariantId: input.variantId, source: command.source, status: "PENDING_MODERATION", rating: input.rating, title: input.title, body: input.body, customerDisplayName: "Customer", verifiedPurchase: true, productTitleSnapshot: snapshot?.productTitle ?? input.productId, variantTitleSnapshot: snapshot?.variantTitle ?? null, productHandleSnapshot: null, submittedAt: now, publishedAt: null } });
  } catch (error) {
    if (isDuplicateReviewError(error)) throw new ReviewSubmissionDomainError("ALREADY_REVIEWED");
    throw error;
  }
}

export async function createPendingReview(command: SubmitReviewCommand, dependencies: ReviewSubmissionDependencies = {}): Promise<PublicSubmittedReview> {
  return publicSubmittedReview(await createPendingReviewRecord(command, dependencies));
}

function pendingNotification(review: CreatedPendingReview, orderName: string | null): NewReviewAdminNotificationInput {
  return { shopId: review.shopId, reviewId: review.id, rating: review.rating, title: review.title, body: review.body, customerDisplayName: review.customerDisplayName, productTitle: review.productTitleSnapshot, variantTitle: review.variantTitleSnapshot, orderName, verifiedPurchase: review.verifiedPurchase, status: "PENDING_MODERATION", submittedAt: review.submittedAt };
}

async function notifyAfterReviewCommit(input: NewReviewAdminNotificationInput, notify: typeof sendNewReviewAdminNotification) {
  try {
    await notify(input);
  } catch (error) {
    console.error("[REVIEWS]", { operation: "admin_submission_notification_failed", reviewId: input.reviewId, shopId: input.shopId, errorName: error instanceof Error ? error.name : null });
  }
}


export type EligibleReviewSubmissionDependencies = ReviewSubmissionDependencies & { eligibility?: ReviewSubmissionEligibilityDependencies };
export async function submitEligibleReview(command: SubmitReviewCommand, dependencies: EligibleReviewSubmissionDependencies = {}): Promise<PublicSubmittedReview> {
  const input = validateReviewSubmissionInput(command.input);
  const eligibility = await evaluateReviewSubmissionEligibility({ shopId: command.shopId, customerProfileId: command.customerProfileId, orderId: input.orderId, orderLineId: input.orderLineId, productId: input.productId, variantId: input.variantId }, dependencies.eligibility);
  if (!eligibility.eligible) throw new ReviewSubmissionDomainError(eligibility.reason);
  const review = await createPendingReviewRecord({ ...command, shopId: eligibility.shopId, customerProfileId: eligibility.customerProfileId, input: { ...input, orderId: eligibility.orderId, orderLineId: eligibility.orderLineId, productId: eligibility.productId, variantId: eligibility.variantId } }, dependencies, { productTitle: eligibility.productTitle, variantTitle: eligibility.variantTitle });
  await notifyAfterReviewCommit(pendingNotification(review, eligibility.orderName), dependencies.notifyAdmin ?? sendNewReviewAdminNotification);
  return publicSubmittedReview(review);
}


export async function submitEligibleReviewWithTokenConsumption(command: SubmitReviewCommand & { reviewRequestId: string }, dependencies: EligibleReviewSubmissionDependencies = {}): Promise<PublicSubmittedReview> {
  const db = (dependencies.db ?? prisma) as PendingReviewDb;
  if (!command.reviewRequestId) throw new ReviewSubmissionDomainError("REQUEST_NOT_ELIGIBLE");
  if (!db.$transaction) throw new Error("Review submission token consumption requires a transaction-capable database client.");
  const committed = await db.$transaction(async (tx) => {
    const input = validateReviewSubmissionInput(command.input);
    const eligibility = await evaluateReviewSubmissionEligibility({ shopId: command.shopId, customerProfileId: command.customerProfileId, orderId: input.orderId, orderLineId: input.orderLineId, productId: input.productId, variantId: input.variantId }, { ...dependencies.eligibility, db: tx as never });
    if (!eligibility.eligible) throw new ReviewSubmissionDomainError(eligibility.reason);
    const created = await createPendingReviewRecord({ ...command, shopId: eligibility.shopId, customerProfileId: eligibility.customerProfileId, input: { ...input, orderId: eligibility.orderId, orderLineId: eligibility.orderLineId, productId: eligibility.productId, variantId: eligibility.variantId } }, { ...dependencies, db: tx }, { productTitle: eligibility.productTitle, variantTitle: eligibility.variantTitle });
    const review = publicSubmittedReview(created);
    const consumed = await tx.reviewRequest?.updateMany({
      where: { id: command.reviewRequestId, shopId: command.shopId, customerProfileId: command.customerProfileId, tokenConsumedAt: null, submittedReviewId: null, tokenRevokedAt: null },
      data: { tokenConsumedAt: review.submittedAt, submittedAt: review.submittedAt, submittedReviewId: review.id, status: "COMPLETED", completedAt: review.submittedAt },
    });
    if (!consumed || consumed.count !== 1) throw new ReviewSubmissionDomainError("TOKEN_CONSUMED");
    return { review, notification: pendingNotification(created, eligibility.orderName) };
  });
  await notifyAfterReviewCommit(committed.notification, dependencies.notifyAdmin ?? sendNewReviewAdminNotification);
  return committed.review;
}
