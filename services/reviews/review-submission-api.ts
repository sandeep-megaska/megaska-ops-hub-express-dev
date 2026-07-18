export const reviewSubmissionEnvelopeFields = new Set(["rating", "title", "body", "productId", "variantId", "orderId", "orderLineId", "accessToken", "entryPoint"]);
export const reviewSubmissionEntryPoints = new Set(["CUSTOMER_DASHBOARD", "PRODUCT_PAGE"]);

export function reviewSubmissionErrorStatus(errorCode: string): number {
  switch (errorCode) {
    case "INVALID_INPUT":
    case "REQUEST_TARGET_MISMATCH":
    case "PRODUCT_MISMATCH":
    case "VARIANT_MISMATCH": return 400;
    case "UNAUTHENTICATED":
    case "INVALID_TOKEN":
    case "EXPIRED_TOKEN":
    case "TOKEN_REVOKED": return 401;
    case "TOKEN_CONSUMED":
    case "ORDER_NOT_DELIVERED":
    case "ALREADY_REVIEWED":
    case "REQUEST_NOT_ELIGIBLE": return 409;
    case "REVIEWS_DISABLED":
    case "CUSTOMER_NOT_FOUND":
    case "ORDER_NOT_OWNED":
    case "TENANT_MISMATCH": return 403;
    case "ORDER_NOT_FOUND":
    case "ORDER_LINE_NOT_FOUND": return 404;
    case "RATE_LIMITED": return 429;
    default: return 500;
  }
}

export function reviewSubmissionMessage(errorCode: string): string {
  switch (errorCode) {
    case "INVALID_INPUT": return "Review submission details are invalid.";
    case "REQUEST_TARGET_MISMATCH": return "This review request does not match the requested item.";
    case "UNAUTHENTICATED": return "Sign in or use a valid review link to submit a review.";
    case "INVALID_TOKEN":
    case "EXPIRED_TOKEN":
    case "TOKEN_REVOKED": return "This review link is no longer valid.";
    case "TOKEN_CONSUMED":
    case "ALREADY_REVIEWED": return "A review has already been submitted for this item.";
    case "REVIEWS_DISABLED": return "Reviews are not currently available for this store.";
    case "ORDER_NOT_DELIVERED": return "This item is not eligible for review yet.";
    case "PRODUCT_MISMATCH":
    case "VARIANT_MISMATCH": return "This review request does not match the requested item.";
    case "ORDER_NOT_FOUND":
    case "ORDER_NOT_OWNED":
    case "ORDER_LINE_NOT_FOUND":
    case "CUSTOMER_NOT_FOUND": return "This item is not eligible for review.";
    case "REQUEST_NOT_ELIGIBLE": return "This review request is not eligible for submission.";
    case "TENANT_MISMATCH": return "This review request is not available for this store.";
    case "RATE_LIMITED": return "Too many attempts. Try again later.";
    default: return "Review submission failed.";
  }
}

function validEntryPoint(value: unknown) { return typeof value === "string" && reviewSubmissionEntryPoints.has(value) ? value as "CUSTOMER_DASHBOARD" | "PRODUCT_PAGE" : null; }
export function validateSubmissionEnvelope(body: Record<string, unknown>) {
  for (const field of Object.keys(body)) if (!reviewSubmissionEnvelopeFields.has(field)) return { ok: false as const, errorCode: "INVALID_INPUT" };
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() || null : body.accessToken == null ? null : "__invalid__";
  if (accessToken === "__invalid__") return { ok: false as const, errorCode: "INVALID_INPUT" };
  const entryPoint = body.entryPoint == null ? null : validEntryPoint(body.entryPoint);
  if (!accessToken && !entryPoint) return { ok: false as const, errorCode: "INVALID_INPUT" };
  if (body.entryPoint != null && !entryPoint) return { ok: false as const, errorCode: "INVALID_INPUT" };
  return { ok: true as const, accessToken, entryPoint };
}
