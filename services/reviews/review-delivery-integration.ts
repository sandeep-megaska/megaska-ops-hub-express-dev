import type { ReviewCandidateSyncResult, syncReviewCandidatesForOrder } from "./review-candidate-sync.ts";

type Sync = typeof syncReviewCandidatesForOrder;

export type DeliveredOrderReviewSyncInput = {
  shopId: string;
  megaskaOrderId: string;
  shopDomain: string;
  now?: Date;
};

export type DeliveredOrderReviewSyncOutcome =
  | { ok: true; result: ReviewCandidateSyncResult }
  | { ok: false; errorCode: string };

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "REVIEW_CANDIDATE_SYNC_FAILED";
}

/**
 * Runs only after the canonical delivery write has committed. Delivery callers
 * deliberately receive an outcome rather than an exception: delivery is the
 * primary event and candidate creation is repairable downstream work.
 */
export async function synchronizeDeliveredOrderReviewCandidatesBestEffort(
  input: DeliveredOrderReviewSyncInput,
  dependencies: { sync?: Sync; log?: (event: Record<string, unknown>) => void } = {},
): Promise<DeliveredOrderReviewSyncOutcome> {
  try {
    const sync = dependencies.sync ?? (await import("./review-candidate-sync.ts")).syncReviewCandidatesForOrder;
    const result = await sync({
      shopId: input.shopId,
      megaskaOrderId: input.megaskaOrderId,
      shopDomain: input.shopDomain,
      now: input.now,
    });
    return { ok: true, result };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    (dependencies.log ?? console.error)({
      event: "review_candidate_sync_after_delivery_failed",
      shopId: input.shopId,
      megaskaOrderId: input.megaskaOrderId,
      errorCode,
    });
    return { ok: false, errorCode };
  }
}
