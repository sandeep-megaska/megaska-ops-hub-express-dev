// A test phone number for Shopify App Store reviewers, who can't receive an OTP on
// an Indian mobile number. It works only when both REVIEW_OTP_PHONE and
// REVIEW_OTP_CODE are set, and only on Shopify development stores
// (shop.plan.partnerDevelopment), so a live store never accepts it. No SMS or
// WhatsApp message is sent and no OTP usage is recorded. The challenge is stored
// like a WhatsApp code (hashed, verified locally), so /api/otp/verify needs no
// special case and the usual attempt limits and expiry apply.
import crypto from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { isDevelopmentStore } from "../billing/adapters/shopify/development-store.ts";
import { hashWhatsAppOtpCode, WHATSAPP_OTP_PROVIDER } from "./whatsapp-otp.ts";

export const REVIEW_TEST_OTP_MODE = "review_test";
const DEV_STORE_CACHE_MS = 10 * 60 * 1000;
const devStoreCache = new Map<string, { value: boolean; at: number }>();

export type ReviewTestOtpConfig = { phoneE164: string; code: string };

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : digits ? `+${digits}` : "";
}

export function reviewTestOtpConfig(env: NodeJS.ProcessEnv = process.env): ReviewTestOtpConfig | null {
  const phoneE164 = normalizePhone(String(env.REVIEW_OTP_PHONE || "").trim());
  const code = String(env.REVIEW_OTP_CODE || "").trim();
  if (!/^\+\d{8,15}$/.test(phoneE164) || !/^\d{4,6}$/.test(code)) return null;
  return { phoneE164, code };
}

type Deps = {
  env?: NodeJS.ProcessEnv;
  isDevStore?: (shopDomain: string) => Promise<boolean>;
  now?: () => number;
};

async function cachedIsDevelopmentStore(shopDomain: string, deps: Deps) {
  const now = (deps.now ?? Date.now)();
  const cached = devStoreCache.get(shopDomain);
  if (cached && now - cached.at < DEV_STORE_CACHE_MS) return cached.value;
  const check = deps.isDevStore ?? ((domain: string) => isDevelopmentStore((query, variables, options) => adminGraphql(query, variables, { ...options, preferStoredToken: true }), domain));
  // A failed lookup counts as "not a development store", so the number is refused.
  const value = await check(shopDomain).catch(() => false);
  devStoreCache.set(shopDomain, { value, at: now });
  return value;
}

/** The reviewer test code for this request, or null when it doesn't apply. */
export async function reviewTestOtpFor(shop: { shopDomain: string }, phoneE164: string, deps: Deps = {}): Promise<ReviewTestOtpConfig | null> {
  const config = reviewTestOtpConfig(deps.env);
  if (!config || normalizePhone(phoneE164) !== config.phoneE164) return null;
  return (await cachedIsDevelopmentStore(shop.shopDomain, deps)) ? config : null;
}

export async function createReviewTestOtpChallenge(input: { shopId: string; phoneE164: string; code: string; expiresAt: Date }) {
  const challengeId = crypto.randomUUID();
  await prisma.oTPChallenge.updateMany({ where: { shopId: input.shopId, phoneE164: input.phoneE164, status: "pending" }, data: { status: "superseded" } });
  await prisma.oTPChallenge.create({
    data: {
      id: challengeId,
      shopId: input.shopId,
      phoneE164: input.phoneE164,
      provider: WHATSAPP_OTP_PROVIDER,
      status: "pending",
      attemptsCount: 0,
      expiresAt: input.expiresAt,
      metadata: { mode: REVIEW_TEST_OTP_MODE, codeHash: hashWhatsAppOtpCode(challengeId, input.code) },
    },
  });
  console.info("[OTP REVIEW TEST CHALLENGE]", { challengeId, shopId: input.shopId });
  return challengeId;
}

export function __resetReviewTestOtpCacheForTests() { devStoreCache.clear(); }
