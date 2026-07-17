import { prisma } from "../db/prisma.ts";
import { isReviewSort, normalizeReviewSort, type ReviewSort } from "./review-sort.ts";

export type ReviewSettings = {
  shopId: string;
  reviewsEnabled: boolean;
  automaticRequestsEnabled: boolean;
  reviewRequestTrigger: "FULFILLED" | "DELIVERED";
  reviewRequestSendHourLocal: number;
  reviewRequestPrimaryChannel: "EMAIL" | "SMS" | "WHATSAPP";
  reviewRequestEmailEnabled: boolean;
  reviewRequestSmsEnabled: boolean;
  reviewRequestWhatsappEnabled: boolean;
  reviewRequestIncludeProductImage: boolean;
  reviewRequestIncludeIncentiveText: boolean;
  reviewRequestIncentiveText: string | null;
  reviewRequestSenderName: string | null;
  reviewRequestReplyToEmail: string | null;
  reviewRequestSubjectTemplate: string | null;
  reviewRequestBodyTemplate: string | null;
  reviewRequestReminderSubjectTemplate: string | null;
  reviewRequestReminderBodyTemplate: string | null;
  requestDelayDays: number;
  reminderEnabled: boolean;
  reminderDelayDays: number;
  maxReminderCount: number;
  minimumRating: number;
  maximumRating: number;
  requireVerifiedPurchase: boolean;
  moderationRequired: boolean;
  allowReviewEditing: boolean;
  allowReviewDeletion: boolean;
  allowMedia: boolean;
  maxMediaCount: number;
  reviewMediaEnabled: boolean;
  reviewPhotoUploadsEnabled: boolean;
  reviewVideoUploadsEnabled: boolean;
  reviewMaxMediaItems: number;
  reviewMaxPhotoSizeBytes: number;
  reviewMaxVideoSizeBytes: number;
  reviewMaxVideoDurationSeconds: number;
  exchangeProtectionDays: number | null;
  issueProtectionDays: number | null;
  cancellationBlocksReview: boolean;
  exchangeBlocksReview: boolean;
  issueBlocksReview: boolean;
  refundBlocksReview: boolean;
  storefrontReviewsEnabled: boolean;
  showReviewSummary: boolean;
  showRatingDistribution: boolean;
  showVerifiedPurchaseBadge: boolean;
  reviewsPerPage: number;
  defaultReviewSort: ReviewSort;
  showReviewDates: boolean;
  showVariantTitle: boolean;
  reviewSectionHeading: string;
  reviewEmptyStateText: string;
  reviewVerifiedPurchaseText: string;
  reviewLoadMoreText: string;
  reviewWriteReviewText: string;
  reviewCountTextTemplate: string;
  reviewAccentColor: string;
  reviewStarColor: string;
  reviewHeadingColor: string;
  reviewTextColor: string;
  reviewMutedTextColor: string;
  reviewBorderColor: string;
  reviewBackgroundColor: string;
  reviewButtonBackgroundColor: string;
  reviewButtonTextColor: string;
  reviewAlignment: "left" | "center";
  reviewCardStyle: "minimal" | "bordered";
  reviewCornerRadius: number;
  reviewSectionSpacing: "compact" | "normal" | "spacious";
  showReviewSectionHeading: boolean;
  showWriteReviewButton: boolean;
};

export type RawReviewSettings = Omit<ReviewSettings, "defaultReviewSort" | "reviewAlignment" | "reviewCardStyle" | "reviewSectionSpacing"> & {
  defaultReviewSort: string;
  reviewAlignment: string;
  reviewCardStyle: string;
  reviewSectionSpacing: string;
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export const DEFAULT_REVIEW_SETTINGS: Omit<ReviewSettings, "shopId"> = {
  reviewsEnabled: false,
  automaticRequestsEnabled: false,
  reviewRequestTrigger: "DELIVERED",
  reviewRequestSendHourLocal: 10,
  reviewRequestPrimaryChannel: "EMAIL",
  reviewRequestEmailEnabled: true,
  reviewRequestSmsEnabled: false,
  reviewRequestWhatsappEnabled: false,
  reviewRequestIncludeProductImage: true,
  reviewRequestIncludeIncentiveText: false,
  reviewRequestIncentiveText: null,
  reviewRequestSenderName: null,
  reviewRequestReplyToEmail: null,
  reviewRequestSubjectTemplate: null,
  reviewRequestBodyTemplate: null,
  reviewRequestReminderSubjectTemplate: null,
  reviewRequestReminderBodyTemplate: null,
  requestDelayDays: 7,
  reminderEnabled: false,
  reminderDelayDays: 7,
  maxReminderCount: 1,
  minimumRating: 1,
  maximumRating: 5,
  requireVerifiedPurchase: true,
  moderationRequired: true,
  allowReviewEditing: true,
  allowReviewDeletion: true,
  allowMedia: true,
  maxMediaCount: 5,
  reviewMediaEnabled: true,
  reviewPhotoUploadsEnabled: true,
  reviewVideoUploadsEnabled: true,
  reviewMaxMediaItems: 5,
  reviewMaxPhotoSizeBytes: 8_388_608,
  reviewMaxVideoSizeBytes: 41_943_040,
  reviewMaxVideoDurationSeconds: 30,
  exchangeProtectionDays: null,
  issueProtectionDays: null,
  cancellationBlocksReview: true,
  exchangeBlocksReview: true,
  issueBlocksReview: true,
  refundBlocksReview: true,
  storefrontReviewsEnabled: true,
  showReviewSummary: true,
  showRatingDistribution: true,
  showVerifiedPurchaseBadge: true,
  reviewsPerPage: 10,
  defaultReviewSort: "NEWEST",
  showReviewDates: true,
  showVariantTitle: true,
  reviewSectionHeading: "Customer reviews",
  reviewEmptyStateText: "No reviews yet.",
  reviewVerifiedPurchaseText: "Verified purchase",
  reviewLoadMoreText: "Load more reviews",
  reviewWriteReviewText: "Write a review",
  reviewCountTextTemplate: "{count} reviews",
  reviewAccentColor: "#111111",
  reviewStarColor: "#F5A623",
  reviewHeadingColor: "#111111",
  reviewTextColor: "#333333",
  reviewMutedTextColor: "#6B6B6B",
  reviewBorderColor: "#E5E5E5",
  reviewBackgroundColor: "#FFFFFF",
  reviewButtonBackgroundColor: "#111111",
  reviewButtonTextColor: "#FFFFFF",
  reviewAlignment: "left",
  reviewCardStyle: "minimal",
  reviewCornerRadius: 8,
  reviewSectionSpacing: "normal",
  showReviewSectionHeading: true,
  showWriteReviewButton: true,
};

type ReviewSettingsWrite = Omit<RawReviewSettings, "shopId">;
export type ReviewSettingsDb = {
  shop: { findUnique(args: { where: { id: string } }): Promise<{ id: string } | null> };
  reviewSettings: {
    findUnique(args: { where: { shopId: string } }): Promise<RawReviewSettings | null>;
    upsert(args: { where: { shopId: string }; create: RawReviewSettings; update: ReviewSettingsWrite }): Promise<RawReviewSettings>;
  };
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeReviewsPerPage(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_REVIEW_SETTINGS.reviewsPerPage;
  return Math.min(25, Math.max(1, value));
}

export function toReviewSettings(row: RawReviewSettings | null): ReviewSettings {
  if (!row) return { shopId: "", ...DEFAULT_REVIEW_SETTINGS };

  // Prisma rows include database metadata. Project only canonical domain fields so
  // metadata can never be merged, validated, returned, or written as settings.
  const settings = Object.fromEntries(
    Object.keys(DEFAULT_REVIEW_SETTINGS).map((key) => [
      key,
      row[key as keyof typeof DEFAULT_REVIEW_SETTINGS],
    ]),
  ) as Omit<ReviewSettings, "shopId">;

  const textKeys = ["reviewSectionHeading", "reviewEmptyStateText", "reviewVerifiedPurchaseText", "reviewLoadMoreText", "reviewWriteReviewText", "reviewCountTextTemplate", "reviewAccentColor", "reviewStarColor", "reviewHeadingColor", "reviewTextColor", "reviewMutedTextColor", "reviewBorderColor", "reviewBackgroundColor", "reviewButtonBackgroundColor", "reviewButtonTextColor"] as const;
  for (const key of textKeys) if (typeof settings[key] !== "string") settings[key] = DEFAULT_REVIEW_SETTINGS[key];

  return {
    ...DEFAULT_REVIEW_SETTINGS,
    ...settings,
    shopId: row.shopId,
    reviewsEnabled: normalizeBoolean(row.reviewsEnabled, DEFAULT_REVIEW_SETTINGS.reviewsEnabled),
    automaticRequestsEnabled: normalizeBoolean(row.automaticRequestsEnabled, DEFAULT_REVIEW_SETTINGS.automaticRequestsEnabled),
    reminderEnabled: normalizeBoolean(row.reminderEnabled, DEFAULT_REVIEW_SETTINGS.reminderEnabled),
    requireVerifiedPurchase: normalizeBoolean(row.requireVerifiedPurchase, DEFAULT_REVIEW_SETTINGS.requireVerifiedPurchase),
    moderationRequired: normalizeBoolean(row.moderationRequired, DEFAULT_REVIEW_SETTINGS.moderationRequired),
    allowReviewEditing: normalizeBoolean(row.allowReviewEditing, DEFAULT_REVIEW_SETTINGS.allowReviewEditing),
    allowReviewDeletion: normalizeBoolean(row.allowReviewDeletion, DEFAULT_REVIEW_SETTINGS.allowReviewDeletion),
    allowMedia: normalizeBoolean(row.allowMedia, DEFAULT_REVIEW_SETTINGS.allowMedia),
    reviewMediaEnabled: normalizeBoolean(row.reviewMediaEnabled, DEFAULT_REVIEW_SETTINGS.reviewMediaEnabled),
    reviewPhotoUploadsEnabled: normalizeBoolean(row.reviewPhotoUploadsEnabled, DEFAULT_REVIEW_SETTINGS.reviewPhotoUploadsEnabled),
    reviewVideoUploadsEnabled: normalizeBoolean(row.reviewVideoUploadsEnabled, DEFAULT_REVIEW_SETTINGS.reviewVideoUploadsEnabled),
    cancellationBlocksReview: normalizeBoolean(row.cancellationBlocksReview, DEFAULT_REVIEW_SETTINGS.cancellationBlocksReview),
    exchangeBlocksReview: normalizeBoolean(row.exchangeBlocksReview, DEFAULT_REVIEW_SETTINGS.exchangeBlocksReview),
    issueBlocksReview: normalizeBoolean(row.issueBlocksReview, DEFAULT_REVIEW_SETTINGS.issueBlocksReview),
    refundBlocksReview: normalizeBoolean(row.refundBlocksReview, DEFAULT_REVIEW_SETTINGS.refundBlocksReview),
    storefrontReviewsEnabled: normalizeBoolean(row.storefrontReviewsEnabled, DEFAULT_REVIEW_SETTINGS.storefrontReviewsEnabled),
    showReviewSummary: normalizeBoolean(row.showReviewSummary, DEFAULT_REVIEW_SETTINGS.showReviewSummary),
    showRatingDistribution: normalizeBoolean(row.showRatingDistribution, DEFAULT_REVIEW_SETTINGS.showRatingDistribution),
    showVerifiedPurchaseBadge: normalizeBoolean(row.showVerifiedPurchaseBadge, DEFAULT_REVIEW_SETTINGS.showVerifiedPurchaseBadge),
    showReviewDates: normalizeBoolean(row.showReviewDates, DEFAULT_REVIEW_SETTINGS.showReviewDates),
    showVariantTitle: normalizeBoolean(row.showVariantTitle, DEFAULT_REVIEW_SETTINGS.showVariantTitle),
    showReviewSectionHeading: normalizeBoolean(row.showReviewSectionHeading, DEFAULT_REVIEW_SETTINGS.showReviewSectionHeading),
    showWriteReviewButton: normalizeBoolean(row.showWriteReviewButton, DEFAULT_REVIEW_SETTINGS.showWriteReviewButton),
    reviewAlignment: row.reviewAlignment === "center" ? "center" : "left",
    reviewCardStyle: row.reviewCardStyle === "bordered" ? "bordered" : "minimal",
    reviewSectionSpacing: ["compact", "normal", "spacious"].includes(row.reviewSectionSpacing) ? row.reviewSectionSpacing as ReviewSettings["reviewSectionSpacing"] : DEFAULT_REVIEW_SETTINGS.reviewSectionSpacing,
    reviewCornerRadius: typeof row.reviewCornerRadius === "number" && Number.isInteger(row.reviewCornerRadius) ? Math.min(24, Math.max(0, row.reviewCornerRadius)) : DEFAULT_REVIEW_SETTINGS.reviewCornerRadius,
    reviewsPerPage: normalizeReviewsPerPage(row.reviewsPerPage),
    defaultReviewSort: normalizeReviewSort(row.defaultReviewSort),
  };
}
export async function getReviewSettings(shopId: string, db: ReviewSettingsDb = prisma): Promise<ReviewSettings> {
  const row = await db.reviewSettings.findUnique({ where: { shopId } });
  return row ? toReviewSettings(row) : { shopId, ...DEFAULT_REVIEW_SETTINGS };
}

function integer(value: unknown, name: string, min: number, max: number, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

export async function saveReviewSettings(
  shopId: string,
  input: Partial<Omit<ReviewSettings, "shopId">>,
  db: ReviewSettingsDb = prisma,
): Promise<ReviewSettings> {
  if (!(await db.shop.findUnique({ where: { id: shopId } }))) throw new Error("Shop not found");
  // Admin routes submit a deliberately small, public subset. Merge it with the
  // persisted tenant row so saving display controls never resets request policy.
  const existing = await db.reviewSettings.findUnique({ where: { shopId } });
  const current = toReviewSettings(existing);
  const writableCurrent = Object.fromEntries(
    Object.keys(DEFAULT_REVIEW_SETTINGS).map((key) => [key, current[key as keyof typeof DEFAULT_REVIEW_SETTINGS]]),
  ) as Omit<ReviewSettings, "shopId">;
  const value: ReviewSettingsWrite = { ...DEFAULT_REVIEW_SETTINGS, ...writableCurrent, ...input };
  integer(value.requestDelayDays, "requestDelayDays", 0, 90); integer(value.reminderDelayDays, "reminderDelayDays", 1, 30); integer(value.reviewRequestSendHourLocal, "reviewRequestSendHourLocal", 0, 23);
  integer(value.maxReminderCount, "maxReminderCount", 0, 3);
  integer(value.minimumRating, "minimumRating", 1, 5);
  integer(value.maximumRating, "maximumRating", 1, 5);
  integer(value.maxMediaCount, "maxMediaCount", 0, 10);
  integer(value.reviewMaxMediaItems, "reviewMaxMediaItems", 1, 10);
  integer(value.reviewMaxPhotoSizeBytes, "reviewMaxPhotoSizeBytes", 262_144, 52_428_800);
  integer(value.reviewMaxVideoSizeBytes, "reviewMaxVideoSizeBytes", 1_048_576, 104_857_600);
  integer(value.reviewMaxVideoDurationSeconds, "reviewMaxVideoDurationSeconds", 5, 120);
  integer(value.reviewsPerPage, "reviewsPerPage", 1, 25);
  integer(value.exchangeProtectionDays, "exchangeProtectionDays", 0, 365, true);
  integer(value.issueProtectionDays, "issueProtectionDays", 0, 365, true);
  if (value.minimumRating > value.maximumRating) throw new Error("minimumRating cannot exceed maximumRating");
  if (value.automaticRequestsEnabled && !value.reviewsEnabled) throw new Error("Automatic requests require reviews to be enabled");
  if (!["FULFILLED", "DELIVERED"].includes(value.reviewRequestTrigger)) throw new Error("reviewRequestTrigger is invalid");
  if (!["EMAIL", "SMS", "WHATSAPP"].includes(value.reviewRequestPrimaryChannel)) throw new Error("reviewRequestPrimaryChannel is invalid");
  const enabled = { EMAIL: value.reviewRequestEmailEnabled, SMS: value.reviewRequestSmsEnabled, WHATSAPP: value.reviewRequestWhatsappEnabled };
  if (value.automaticRequestsEnabled && (!Object.values(enabled).some(Boolean) || !enabled[value.reviewRequestPrimaryChannel])) throw new Error("Automation needs an enabled primary channel");
  for (const key of ["reviewRequestIncentiveText", "reviewRequestSenderName", "reviewRequestReplyToEmail", "reviewRequestSubjectTemplate", "reviewRequestBodyTemplate", "reviewRequestReminderSubjectTemplate", "reviewRequestReminderBodyTemplate"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length > 6000)) throw new Error(`${key} is invalid`);
  integer(value.reviewCornerRadius, "reviewCornerRadius", 0, 24);
  if (!["left", "center"].includes(value.reviewAlignment)) throw new Error("reviewAlignment is invalid");
  if (!["minimal", "bordered"].includes(value.reviewCardStyle)) throw new Error("reviewCardStyle is invalid");
  if (!["compact", "normal", "spacious"].includes(value.reviewSectionSpacing)) throw new Error("reviewSectionSpacing is invalid");
  if (!isReviewSort(value.defaultReviewSort)) throw new Error("defaultReviewSort is invalid");
  for (const [key, setting] of Object.entries(value)) {
    if (typeof setting !== "boolean" && !["requestDelayDays", "reminderDelayDays", "maxReminderCount", "minimumRating", "maximumRating", "maxMediaCount", "reviewMaxMediaItems", "reviewMaxPhotoSizeBytes", "reviewMaxVideoSizeBytes", "reviewMaxVideoDurationSeconds", "reviewsPerPage", "exchangeProtectionDays", "issueProtectionDays", "defaultReviewSort", "reviewRequestTrigger", "reviewRequestPrimaryChannel", "reviewRequestSendHourLocal", "reviewRequestIncentiveText", "reviewRequestSenderName", "reviewRequestReplyToEmail", "reviewRequestSubjectTemplate", "reviewRequestBodyTemplate", "reviewRequestReminderSubjectTemplate", "reviewRequestReminderBodyTemplate", "reviewSectionHeading", "reviewEmptyStateText", "reviewVerifiedPurchaseText", "reviewLoadMoreText", "reviewWriteReviewText", "reviewCountTextTemplate", "reviewAccentColor", "reviewStarColor", "reviewHeadingColor", "reviewTextColor", "reviewMutedTextColor", "reviewBorderColor", "reviewBackgroundColor", "reviewButtonBackgroundColor", "reviewButtonTextColor", "reviewAlignment", "reviewCardStyle", "reviewCornerRadius", "reviewSectionSpacing"].includes(key)) throw new Error(`${key} must be boolean`);
  }
  const row = await db.reviewSettings.upsert({ where: { shopId }, create: { shopId, ...value }, update: value });
  return toReviewSettings(row);
}
