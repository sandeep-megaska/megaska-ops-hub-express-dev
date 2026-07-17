import { isReviewSort, type ReviewSort } from "./review-sort.ts";

export type DisplaySettingsInput = { storefrontReviewsEnabled: boolean; showReviewSummary: boolean; showRatingDistribution: boolean; showVerifiedPurchaseBadge: boolean; showReviewDates: boolean; showVariantTitle: boolean; reviewsPerPage: number; defaultReviewSort: ReviewSort };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== "boolean") throw new Error(`${key} must be boolean`);
  return value[key];
}

export function parseDisplaySettingsInput(value: unknown): DisplaySettingsInput {
  if (!isRecord(value)) throw new Error("Review display settings must be an object");
  const storefrontReviewsEnabled = readBoolean(value, "storefrontReviewsEnabled");
  const showReviewSummary = readBoolean(value, "showReviewSummary");
  const showRatingDistribution = readBoolean(value, "showRatingDistribution");
  const showVerifiedPurchaseBadge = readBoolean(value, "showVerifiedPurchaseBadge");
  const showReviewDates = readBoolean(value, "showReviewDates");
  const showVariantTitle = readBoolean(value, "showVariantTitle");
  const reviewsPerPage = value.reviewsPerPage;
  if (typeof reviewsPerPage !== "number" || !Number.isInteger(reviewsPerPage) || reviewsPerPage < 1 || reviewsPerPage > 25) throw new Error("reviewsPerPage must be an integer between 1 and 25");
  if (!isReviewSort(value.defaultReviewSort)) throw new Error("defaultReviewSort is invalid");
  return { storefrontReviewsEnabled, showReviewSummary, showRatingDistribution, showVerifiedPurchaseBadge, showReviewDates, showVariantTitle, reviewsPerPage, defaultReviewSort: value.defaultReviewSort };
}
