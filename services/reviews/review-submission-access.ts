import type { NextRequest } from "next/server";
import { prisma } from "../db/prisma.ts";
import { resolveCustomerDashboardContext } from "../customer-dashboard/context.ts";
import { hashReviewRequestToken, isReviewRequestTokenEligibleStatus, normalizeReviewRequestToken } from "./review-request-token.ts";

export type ReviewSubmissionSessionSource = "CUSTOMER_DASHBOARD" | "PRODUCT_PAGE";
export type ReviewSubmissionTokenSource = "REVIEW_REQUEST_EMAIL" | "REVIEW_REQUEST_WHATSAPP";
export type ReviewSubmissionAccess =
  | { ok: true; mode: "CUSTOMER_SESSION"; shopId: string; customerProfileId: string; source: ReviewSubmissionSessionSource; reviewRequestId: null; orderId: null; orderLineId: null; productId: null; variantId: null }
  | { ok: true; mode: "REVIEW_REQUEST_TOKEN"; shopId: string; customerProfileId: string; source: ReviewSubmissionTokenSource; reviewRequestId: string; orderId: string; orderLineId: string; productId: string; variantId: string | null }
  | { ok: false; reason: "UNAUTHENTICATED" | "INVALID_TOKEN" | "EXPIRED_TOKEN" | "TOKEN_REVOKED" | "TOKEN_CONSUMED" | "TENANT_MISMATCH" | "CUSTOMER_NOT_FOUND" | "REQUEST_NOT_FOUND" | "REQUEST_NOT_ELIGIBLE" | "REQUEST_TARGET_MISMATCH" };

type Db = typeof prisma;
const SESSION_SOURCES = new Set<ReviewSubmissionSessionSource>(["CUSTOMER_DASHBOARD", "PRODUCT_PAGE"]);

export async function resolveReviewAccessFromCustomerSession(input: { request: NextRequest; source?: ReviewSubmissionSessionSource }): Promise<ReviewSubmissionAccess> {
  const source = input.source && SESSION_SOURCES.has(input.source) ? input.source : "CUSTOMER_DASHBOARD";
  try {
    const context = await resolveCustomerDashboardContext(input.request);
    return { ok: true, mode: "CUSTOMER_SESSION", shopId: context.shopId, customerProfileId: context.customerProfileId, source, reviewRequestId: null, orderId: null, orderLineId: null, productId: null, variantId: null };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "CUSTOMER_NOT_FOUND") return { ok: false, reason: "CUSTOMER_NOT_FOUND" };
    return { ok: false, reason: "UNAUTHENTICATED" };
  }
}

function sourceFromChannel(channel: string | null | undefined): ReviewSubmissionTokenSource {
  return channel === "WHATSAPP" ? "REVIEW_REQUEST_WHATSAPP" : "REVIEW_REQUEST_EMAIL";
}

export async function resolveReviewAccessFromRequestToken(input: { token: unknown; shopId?: string | null; now?: Date; db?: Db }): Promise<ReviewSubmissionAccess> {
  const token = normalizeReviewRequestToken(input.token);
  if (!token) return { ok: false, reason: "INVALID_TOKEN" };
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const request = await db.reviewRequest.findUnique({
    where: { tokenHash: hashReviewRequestToken(token) },
    include: { shop: { select: { id: true } }, customerProfile: { select: { id: true, shopId: true } }, deliveryAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { channel: true } } },
  });
  if (!request) return { ok: false, reason: "INVALID_TOKEN" };
  if (input.shopId && input.shopId !== request.shopId) return { ok: false, reason: "TENANT_MISMATCH" };
  if (!request.shop) return { ok: false, reason: "TENANT_MISMATCH" };
  if (!request.customerProfile) return { ok: false, reason: "CUSTOMER_NOT_FOUND" };
  if (request.customerProfile.shopId && request.customerProfile.shopId !== request.shopId) return { ok: false, reason: "TENANT_MISMATCH" };
  if (!request.tokenExpiresAt || request.tokenExpiresAt <= now) return { ok: false, reason: "EXPIRED_TOKEN" };
  if (request.tokenRevokedAt) return { ok: false, reason: "TOKEN_REVOKED" };
  if (request.tokenConsumedAt || request.submittedReviewId) return { ok: false, reason: "TOKEN_CONSUMED" };
  if (!isReviewRequestTokenEligibleStatus(request.status) || request.suppressedAt || request.completedAt || request.canceledAt) return { ok: false, reason: "REQUEST_NOT_ELIGIBLE" };
  const settings = await db.reviewSettings.findUnique({ where: { shopId: request.shopId }, select: { reviewsEnabled: true } });
  if (!settings?.reviewsEnabled) return { ok: false, reason: "REQUEST_NOT_ELIGIBLE" };
  return { ok: true, mode: "REVIEW_REQUEST_TOKEN", shopId: request.shopId, customerProfileId: request.customerProfileId, source: sourceFromChannel(request.deliveryAttempts[0]?.channel), reviewRequestId: request.id, orderId: request.megaskaOrderId, orderLineId: request.shopifyLineItemId, productId: request.shopifyProductId, variantId: request.shopifyVariantId ?? null };
}

export async function resolveReviewSubmissionAccess(input: { request: NextRequest; accessToken?: string | null; sessionSource?: ReviewSubmissionSessionSource; shopId?: string | null; now?: Date; db?: Db }): Promise<ReviewSubmissionAccess> {
  if (input.accessToken) return resolveReviewAccessFromRequestToken({ token: input.accessToken, shopId: input.shopId, now: input.now, db: input.db });
  return resolveReviewAccessFromCustomerSession({ request: input.request, source: input.sessionSource });
}

export function resolveCanonicalReviewTarget(access: ReviewSubmissionAccess, input: { orderId?: string | null; orderLineId?: string | null; productId?: string | null; variantId?: string | null }) {
  if (!access.ok) return access;
  if (access.mode === "CUSTOMER_SESSION") return { ok: true as const, orderId: input.orderId ?? null, orderLineId: input.orderLineId ?? null, productId: input.productId ?? null, variantId: input.variantId ?? null };
  if ((input.orderId && input.orderId !== access.orderId) || (input.orderLineId && input.orderLineId !== access.orderLineId) || (input.productId && input.productId !== access.productId) || (input.variantId && input.variantId !== access.variantId)) return { ok: false as const, reason: "REQUEST_TARGET_MISMATCH" as const };
  return { ok: true as const, orderId: access.orderId, orderLineId: access.orderLineId, productId: access.productId, variantId: access.variantId };
}
