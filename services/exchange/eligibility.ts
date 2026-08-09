import { CLEARANCE_KEYWORDS, EXCHANGE_ALLOWED_DAYS_WINDOW, EXCLUDED_CATEGORY_KEYWORDS } from "./constants.ts";

type EligibilityInput = {
  requestedSize: string;
  currentSize?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  reason?: string | null;
  deliveredAt?: string | null;
  fulfillmentStatus?: string | null;
  /** Days after delivery a request is allowed. Defaults to EXCHANGE_ALLOWED_DAYS_WINDOW. */
  windowDays?: number;
};

export type EligibilityDecision = "ELIGIBLE" | "REJECTED" | "REVIEW_REQUIRED";

const STOCK_REVIEW_MESSAGE =
  "Exchange approval depends on the availability of the requested size. If unavailable, our team will contact you with next steps.";

function normalizeStatus(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isDeliveredStatus(status: string) {
  if (!status) return false;
  return status.includes("delivered");
}

function isKnownUndeliveredStatus(status: string) {
  if (!status) return false;

  const blockedKeywords = [
    "unfulfilled",
    "pending",
    "processing",
    "confirmed",
    "on hold",
    "hold",
    "in transit",
    "in_transit",
    "out for delivery",
    "ready for pickup",
    "shipment created",
    "label printed",
    "partial",
    "scheduled",
    "open",
    "failure",
    "failed",
  ];

  return blockedKeywords.some((keyword) => status.includes(keyword));
}

export function evaluateExchangeEligibility(input: EligibilityInput) {
  const currentSize = String(input.currentSize || "").trim().toLowerCase();
  const requestedSize = String(input.requestedSize || "").trim().toLowerCase();
  const productTitle = String(input.productTitle || "").toLowerCase();
  const variantTitle = String(input.variantTitle || "").toLowerCase();
  const reason = String(input.reason || "").trim();
  const combinedText = `${productTitle} ${variantTitle}`;
  const fulfillmentStatus = normalizeStatus(input.fulfillmentStatus);

  if (!requestedSize) {
    return {
      decision: "REJECTED" as const,
      reason: "Requested size is required",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  if (currentSize && currentSize === requestedSize) {
    return {
      decision: "REJECTED" as const,
      reason: "Current size and requested size are identical",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  const isExcludedCategory = EXCLUDED_CATEGORY_KEYWORDS.some((keyword) => combinedText.includes(keyword));
  if (isExcludedCategory) {
    return {
      decision: "REJECTED" as const,
      reason: "Product category is excluded from exchange",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  const isClearance = CLEARANCE_KEYWORDS.some((keyword) => combinedText.includes(keyword));
  if (isClearance) {
    return {
      decision: "REJECTED" as const,
      reason: "Clearance items are not exchangeable",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;
  const hasValidDeliveredAt = Boolean(deliveredAt && !Number.isNaN(deliveredAt.getTime()));

  if (fulfillmentStatus && !isDeliveredStatus(fulfillmentStatus) && isKnownUndeliveredStatus(fulfillmentStatus)) {
    return {
      decision: "REJECTED" as const,
      reason: "Exchange can be requested only after the order has been delivered.",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  if (!isDeliveredStatus(fulfillmentStatus)) {
    return {
      decision: "REJECTED" as const,
      reason: "Exchange can be requested only after the order has been delivered.",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  if (!hasValidDeliveredAt) {
    return {
      decision: "REJECTED" as const,
      reason: "We couldn’t confirm the delivery date for this order. Please contact support for help.",
      blocked: true,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  if (!reason) {
    return {
      decision: "REVIEW_REQUIRED" as const,
      reason: "Reason missing; admin review required",
      blocked: false,
      stockReviewMessage: STOCK_REVIEW_MESSAGE,
    };
  }

  if (hasValidDeliveredAt && deliveredAt) {
    const windowDays = Number.isFinite(input.windowDays) ? Number(input.windowDays) : EXCHANGE_ALLOWED_DAYS_WINDOW;
    const elapsedMs = Date.now() - deliveredAt.getTime();
    const days = elapsedMs / (1000 * 60 * 60 * 24);
    if (days > windowDays) {
      return {
        decision: "REJECTED" as const,
        reason: `Exchange requests are allowed within ${windowDays} days of delivery.`,
        blocked: true,
        stockReviewMessage: STOCK_REVIEW_MESSAGE,
      };
    }
  }

  return {
    decision: "ELIGIBLE" as const,
    reason: "Eligible for exchange",
    blocked: false,
    stockReviewMessage: STOCK_REVIEW_MESSAGE,
  };
}
