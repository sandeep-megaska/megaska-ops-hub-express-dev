import { prisma } from "../db/prisma.ts";
import type { ReviewSettings as PrismaReviewSettings } from "../../generated/prisma/index.js";
import { isReviewSort, normalizeReviewSort, type ReviewSort } from "./review-sort.ts";

export type ReviewSettings = {
  shopId: string;
  reviewsEnabled: boolean;
  automaticRequestsEnabled: boolean;
  requestDelayDays: number;
  reminderEnabled: boolean;
  reminderDelayDays: number;
  maxReminderCount: number;
  minimumRating: number;
  maximumRating: number;
  requireVerifiedPurchase: boolean;
  moderationRequired: boolean;
  allowReviewEditing: boolean;
  customerReviewEditingEnabled: boolean;
  reviewEditWindowDays: number;
  requireRemoderationAfterEdit: boolean;
  allowReviewDeletion: boolean;
  allowMedia: boolean;
  maxMediaCount: number;
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
};

/**
 * Scalar settings fields as returned by Prisma. `defaultReviewSort` remains a
 * string here because the backing column is a Prisma String field.
 */
export type RawReviewSettings = Pick<PrismaReviewSettings, keyof ReviewSettings>;

export const DEFAULT_REVIEW_SETTINGS: Omit<ReviewSettings, "shopId"> = {
  reviewsEnabled: false,
  automaticRequestsEnabled: false,
  requestDelayDays: 7,
  reminderEnabled: false,
  reminderDelayDays: 7,
  maxReminderCount: 1,
  minimumRating: 1,
  maximumRating: 5,
  requireVerifiedPurchase: true,
  moderationRequired: true,
  allowReviewEditing: true,
  customerReviewEditingEnabled: true,
  reviewEditWindowDays: 30,
  requireRemoderationAfterEdit: true,
  allowReviewDeletion: true,
  allowMedia: true,
  maxMediaCount: 5,
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
};

type ReviewSettingsWrite = Omit<RawReviewSettings, "shopId">;
export type ReviewSettingsDb = {
  shop: { findUnique(args: { where: { id: string } }): Promise<{ id: string } | null> };
  reviewSettings: {
    findUnique(args: { where: { shopId: string } }): Promise<RawReviewSettings | null>;
    upsert(args: { where: { shopId: string }; create: RawReviewSettings; update: ReviewSettingsWrite }): Promise<RawReviewSettings>;
  };
};

function integerOrDefault(value: unknown, fallback: number, min: number, max: number) { return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback; }

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeReviewsPerPage(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_REVIEW_SETTINGS.reviewsPerPage;
  return Math.min(25, Math.max(1, value));
}

export function toReviewSettings(row: RawReviewSettings | null, fallbackShopId = ""): ReviewSettings {
  if (!row) return { shopId: fallbackShopId, ...DEFAULT_REVIEW_SETTINGS };

  return {
    ...DEFAULT_REVIEW_SETTINGS,
    ...row,
    reviewsEnabled: normalizeBoolean(row.reviewsEnabled, DEFAULT_REVIEW_SETTINGS.reviewsEnabled),
    automaticRequestsEnabled: normalizeBoolean(row.automaticRequestsEnabled, DEFAULT_REVIEW_SETTINGS.automaticRequestsEnabled),
    reminderEnabled: normalizeBoolean(row.reminderEnabled, DEFAULT_REVIEW_SETTINGS.reminderEnabled),
    requireVerifiedPurchase: normalizeBoolean(row.requireVerifiedPurchase, DEFAULT_REVIEW_SETTINGS.requireVerifiedPurchase),
    moderationRequired: normalizeBoolean(row.moderationRequired, DEFAULT_REVIEW_SETTINGS.moderationRequired),
    allowReviewEditing: normalizeBoolean(row.allowReviewEditing, DEFAULT_REVIEW_SETTINGS.allowReviewEditing),
    customerReviewEditingEnabled: normalizeBoolean(row.customerReviewEditingEnabled, DEFAULT_REVIEW_SETTINGS.customerReviewEditingEnabled),
    requireRemoderationAfterEdit: normalizeBoolean(row.requireRemoderationAfterEdit, DEFAULT_REVIEW_SETTINGS.requireRemoderationAfterEdit),
    reviewEditWindowDays: integerOrDefault(row.reviewEditWindowDays, DEFAULT_REVIEW_SETTINGS.reviewEditWindowDays, 1, 365),
    allowReviewDeletion: normalizeBoolean(row.allowReviewDeletion, DEFAULT_REVIEW_SETTINGS.allowReviewDeletion),
    allowMedia: normalizeBoolean(row.allowMedia, DEFAULT_REVIEW_SETTINGS.allowMedia),
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
    reviewsPerPage: normalizeReviewsPerPage(row.reviewsPerPage),
    defaultReviewSort: normalizeReviewSort(row.defaultReviewSort),
  };
}

export async function getReviewSettings(shopId: string, db: ReviewSettingsDb = prisma): Promise<ReviewSettings> {
  const row = await db.reviewSettings.findUnique({ where: { shopId } });
  return toReviewSettings(row, shopId);
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
  const value = { ...DEFAULT_REVIEW_SETTINGS, ...input };
  for (const key of ["requestDelayDays", "reminderDelayDays"] as const) integer(value[key], key, 0, 365);
  integer(value.maxReminderCount, "maxReminderCount", 0, 5);
  integer(value.minimumRating, "minimumRating", 1, 5);
  integer(value.maximumRating, "maximumRating", 1, 5);
  integer(value.maxMediaCount, "maxMediaCount", 0, 10);
  integer(value.reviewEditWindowDays, "reviewEditWindowDays", 1, 365);
  integer(value.reviewsPerPage, "reviewsPerPage", 1, 25);
  integer(value.exchangeProtectionDays, "exchangeProtectionDays", 0, 365, true);
  integer(value.issueProtectionDays, "issueProtectionDays", 0, 365, true);
  if (value.minimumRating > value.maximumRating) throw new Error("minimumRating cannot exceed maximumRating");
  if (value.automaticRequestsEnabled && !value.reviewsEnabled) throw new Error("Automatic requests require reviews to be enabled");
  if (!isReviewSort(value.defaultReviewSort)) throw new Error("defaultReviewSort is invalid");
  for (const [key, setting] of Object.entries(value)) {
    if (typeof setting !== "boolean" && !["requestDelayDays", "reminderDelayDays", "maxReminderCount", "minimumRating", "maximumRating", "maxMediaCount", "reviewEditWindowDays", "reviewsPerPage", "exchangeProtectionDays", "issueProtectionDays", "defaultReviewSort"].includes(key)) throw new Error(`${key} must be boolean`);
  }
  const row = await db.reviewSettings.upsert({ where: { shopId }, create: { shopId, ...value }, update: value });
  return toReviewSettings(row);
}
