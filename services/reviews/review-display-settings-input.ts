import { isReviewSort, type ReviewSort } from "./review-sort.ts";

export type DisplaySettingsInput = {
  reviewsEnabled: boolean; automaticRequestsEnabled: boolean; storefrontReviewsEnabled: boolean;
  showReviewSummary: boolean; showRatingDistribution: boolean; showVerifiedPurchaseBadge: boolean;
  showReviewDates: boolean; showVariantTitle: boolean; reviewsPerPage: number; defaultReviewSort: ReviewSort;
  reviewSectionHeading: string; reviewEmptyStateText: string; reviewVerifiedPurchaseText: string;
  reviewLoadMoreText: string; reviewWriteReviewText: string; reviewCountTextTemplate: string;
  reviewAccentColor: string; reviewStarColor: string; reviewHeadingColor: string; reviewTextColor: string;
  reviewMutedTextColor: string; reviewBorderColor: string; reviewBackgroundColor: string;
  reviewButtonBackgroundColor: string; reviewButtonTextColor: string;
  reviewAlignment: "left" | "center"; reviewCardStyle: "minimal" | "bordered";
  reviewCornerRadius: number; reviewSectionSpacing: "compact" | "normal" | "spacious";
  showReviewSectionHeading: boolean; showWriteReviewButton: boolean;
};
const booleanKeys = ["reviewsEnabled", "automaticRequestsEnabled", "storefrontReviewsEnabled", "showReviewSummary", "showRatingDistribution", "showVerifiedPurchaseBadge", "showReviewDates", "showVariantTitle", "showReviewSectionHeading", "showWriteReviewButton"] as const;
const textRules = { reviewSectionHeading: 80, reviewEmptyStateText: 160, reviewVerifiedPurchaseText: 60, reviewLoadMoreText: 60, reviewWriteReviewText: 60, reviewCountTextTemplate: 80 } as const;
const colorKeys = ["reviewAccentColor", "reviewStarColor", "reviewHeadingColor", "reviewTextColor", "reviewMutedTextColor", "reviewBorderColor", "reviewBackgroundColor", "reviewButtonBackgroundColor", "reviewButtonTextColor"] as const;
const allowedKeys = new Set([...booleanKeys, ...Object.keys(textRules), ...colorKeys, "reviewsPerPage", "defaultReviewSort", "reviewAlignment", "reviewCardStyle", "reviewCornerRadius", "reviewSectionSpacing"]);
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function readBoolean(value: Record<string, unknown>, key: string): boolean { if (typeof value[key] !== "boolean") throw new Error(`${key} must be boolean`); return value[key]; }
function readText(value: Record<string, unknown>, key: keyof typeof textRules): string { const text = value[key]; if (typeof text !== "string") throw new Error(`${key} must be text`); const trimmed = text.trim(); if (!trimmed || trimmed.length > textRules[key] || /<[^>]*>/.test(trimmed)) throw new Error(`${key} is invalid`); if (key === "reviewCountTextTemplate" && /[{}]/.test(trimmed.replaceAll("{count}", ""))) throw new Error("reviewCountTextTemplate has an unsupported placeholder"); return trimmed; }
function readColor(value: Record<string, unknown>, key: typeof colorKeys[number]): string { const color = value[key]; if (typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error(`${key} must be a six-digit hex color`); return color.toUpperCase(); }
export function parseDisplaySettingsInput(value: unknown): DisplaySettingsInput {
  if (!isRecord(value)) throw new Error("Review display settings must be an object");
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error(`${key} is not supported`);
  const result = {} as DisplaySettingsInput;
  for (const key of booleanKeys) result[key] = readBoolean(value, key);
  for (const key of Object.keys(textRules) as (keyof typeof textRules)[]) result[key] = readText(value, key);
  for (const key of colorKeys) result[key] = readColor(value, key);
  const reviewsPerPage = value.reviewsPerPage;
  if (typeof reviewsPerPage !== "number" || !Number.isInteger(reviewsPerPage) || reviewsPerPage < 1 || reviewsPerPage > 25) throw new Error("reviewsPerPage must be an integer between 1 and 25"); result.reviewsPerPage = reviewsPerPage;
  if (!isReviewSort(value.defaultReviewSort)) throw new Error("defaultReviewSort is invalid"); result.defaultReviewSort = value.defaultReviewSort;
  if (value.reviewAlignment !== "left" && value.reviewAlignment !== "center") throw new Error("reviewAlignment is invalid"); result.reviewAlignment = value.reviewAlignment;
  if (value.reviewCardStyle !== "minimal" && value.reviewCardStyle !== "bordered") throw new Error("reviewCardStyle is invalid"); result.reviewCardStyle = value.reviewCardStyle;
  if (typeof value.reviewCornerRadius !== "number" || !Number.isInteger(value.reviewCornerRadius) || value.reviewCornerRadius < 0 || value.reviewCornerRadius > 24) throw new Error("reviewCornerRadius must be an integer between 0 and 24"); result.reviewCornerRadius = value.reviewCornerRadius;
  if (value.reviewSectionSpacing !== "compact" && value.reviewSectionSpacing !== "normal" && value.reviewSectionSpacing !== "spacious") throw new Error("reviewSectionSpacing is invalid"); result.reviewSectionSpacing = value.reviewSectionSpacing;
  return result;
}
