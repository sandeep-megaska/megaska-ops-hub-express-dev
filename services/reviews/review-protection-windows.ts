import { prisma } from "../db/prisma.ts";
import { EXCHANGE_ALLOWED_DAYS_WINDOW } from "../exchange/constants.ts";
import { DEFAULT_REVIEW_SETTINGS } from "./review-settings.ts";

export type ResolvedReviewProtectionWindows = {
  requestDelayDays: number;
  exchangeProtectionDays: number;
  issueProtectionDays: number;
  effectiveProtectionDays: number;
  sources: {
    requestDelay: "REVIEW_SETTINGS" | "DEFAULT";
    exchangeProtection: "REVIEW_OVERRIDE" | "STORE_POLICY" | "DEFAULT";
    issueProtection: "REVIEW_OVERRIDE" | "STORE_POLICY" | "DEFAULT";
  };
};

export type ReviewWindowSettings = {
  requestDelayDays: number;
  exchangeProtectionDays: number | null;
  issueProtectionDays: number | null;
};

export type ReviewProtectionWindowsDb = {
  reviewSettings: { findUnique(args: unknown): Promise<ReviewWindowSettings | null> };
};

function validDays(value: number | null | undefined, field: string, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 365) {
    throw new ReviewProtectionWindowError("REVIEW_SETTINGS_INVALID", `${field} must be an integer between 0 and 365.`);
  }
  return value as number;
}

export class ReviewProtectionWindowError extends Error {
  readonly code: "REVIEW_SETTINGS_INVALID";
  constructor(code: "REVIEW_SETTINGS_INVALID", message: string) {
    super(message);
    this.name = "ReviewProtectionWindowError";
    this.code = code;
  }
}

/** Resolves without creating a settings row; exchange and issue share the authoritative request window. */
export async function resolveReviewProtectionWindows(
  shopId: string,
  db: ReviewProtectionWindowsDb = prisma as unknown as ReviewProtectionWindowsDb,
): Promise<ResolvedReviewProtectionWindows> {
  const settings = await db.reviewSettings.findUnique({ where: { shopId } });
  const requestDelayDays = settings
    ? validDays(settings.requestDelayDays, "requestDelayDays")
    : DEFAULT_REVIEW_SETTINGS.requestDelayDays;
  const exchangeOverride = settings ? validDays(settings.exchangeProtectionDays, "exchangeProtectionDays", true) : null;
  const issueOverride = settings ? validDays(settings.issueProtectionDays, "issueProtectionDays", true) : null;
  const exchangeProtectionDays = exchangeOverride ?? EXCHANGE_ALLOWED_DAYS_WINDOW;
  const issueProtectionDays = issueOverride ?? EXCHANGE_ALLOWED_DAYS_WINDOW;

  return {
    requestDelayDays: requestDelayDays as number,
    exchangeProtectionDays,
    issueProtectionDays,
    effectiveProtectionDays: Math.max(requestDelayDays as number, exchangeProtectionDays, issueProtectionDays),
    sources: {
      requestDelay: settings ? "REVIEW_SETTINGS" : "DEFAULT",
      exchangeProtection: exchangeOverride === null ? "STORE_POLICY" : "REVIEW_OVERRIDE",
      issueProtection: issueOverride === null ? "STORE_POLICY" : "REVIEW_OVERRIDE",
    },
  };
}
