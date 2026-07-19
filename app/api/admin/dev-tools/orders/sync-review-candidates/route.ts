import { NextRequest, NextResponse } from "next/server";
import { assertDevelopmentDeliveryHelperEnabled, DevDeliveryHelperError } from "../../../../../../services/dev-tools/mark-order-delivered";
import { ReviewCandidateSyncError, syncReviewCandidatesForOrder } from "../../../../../../services/reviews/review-candidate-sync";
import { ReviewSourceError } from "../../../../../../services/shopify/order-review-source";
import { resolveAdminShopFromRequest } from "../../../../../../services/shopify/admin-shop-context";

const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers });

export async function POST(request: NextRequest) {
  try { assertDevelopmentDeliveryHelperEnabled(); }
  catch (error) { return failure(error instanceof DevDeliveryHelperError ? error.code : "DEV_HELPER_DISABLED", 404); }
  const resolved = await resolveAdminShopFromRequest(request);
  if (!resolved.shop?.id || !resolved.hmacVerified) return failure("UNAUTHENTICATED", 401);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("INVALID_INPUT", 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "orderId") || typeof input.orderId !== "string" || !input.orderId.trim()) return failure("INVALID_INPUT", 400);
  try {
    const result = await syncReviewCandidatesForOrder({ shopId: resolved.shop.id, megaskaOrderId: input.orderId, shopDomain: resolved.shop.shopDomain });
    if (result.status === "ORDER_NOT_DELIVERED") return failure("ORDER_NOT_DELIVERED", 400);
    if (result.status === "MISSING_SHOPIFY_ORDER_ID") return failure("MISSING_SHOPIFY_ORDER_ID", 400);
    return NextResponse.json({ ok: true, result: { status: result.status, megaskaOrderId: result.megaskaOrderId, sourceLineCount: result.sourceLineCount, reviewableLineCount: result.reviewableLineCount, createdCount: result.createdCount, enrichedCount: result.enrichedCount, unchangedCount: result.unchangedCount, skippedCount: result.skippedCount, integrityWarningCount: result.integrityWarningCount, eligibility: { evaluatedCount: result.eligibilityResult?.evaluated ?? 0 } } }, { headers });
  } catch (error) {
    const code = error instanceof ReviewCandidateSyncError ? error.code : error instanceof ReviewSourceError ? error.code : "REVIEW_CANDIDATE_SYNC_FAILED";
    if (code === "REVIEW_SOURCE_INVALID_ORDER") return failure("ORDER_NOT_FOUND", 404);
    if (code === "REVIEW_SOURCE_ORDER_NOT_FOUND") return failure(code, 404);
    if (code === "REVIEW_SOURCE_CUSTOMER_MISMATCH") return failure(code, 409);
    if (code === "REVIEW_SOURCE_GRAPHQL_FAILED") return failure(code, 500);
    return failure("REVIEW_CANDIDATE_SYNC_FAILED", 500);
  }
}
