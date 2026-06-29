import crypto from "crypto";
import { prisma } from "../../db/prisma";

const RECOVERY_TOKEN_BYTES = 32;
const RECOVERY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const CHECKOUT_RECOVERY_EXPIRED_MESSAGE = "This checkout recovery link has expired. Please start checkout again.";

export const CHECKOUT_RECOVERY_TYPES = ["CHECKOUT_ABANDONMENT", "PAYMENT_ABANDONMENT"] as const;
export type CheckoutRecoveryType = (typeof CHECKOUT_RECOVERY_TYPES)[number];

export type CheckoutRecoveryContext = {
  checkoutIntentId: string;
  recoveryType: CheckoutRecoveryType;
  status: "ACTIVE";
  expiresAt: Date;
};

type CheckoutRecoveryTokenRecord = {
  id: string;
  shopId: string;
  checkoutIntentId: string;
  customerProfileId: string | null;
  tokenHash: string;
  recoveryType: CheckoutRecoveryType;
  status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
  expiresAt: Date;
  clickedAt: Date | null;
  usedAt: Date | null;
  revokedAt: Date | null;
};

type CheckoutIntentRecord = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  status: string;
  expiresAt: Date | null;
};

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function newRawToken() {
  return crypto.randomBytes(RECOVERY_TOKEN_BYTES).toString("base64url");
}

function minDate(left: Date, right: Date | null) {
  if (!right) return left;
  return right.getTime() < left.getTime() ? right : left;
}

function logRecovery(event: string, payload: Record<string, unknown>) {
  console.info(`[CHECKOUT RECOVERY] ${event}`, payload);
}

function logInvalid(reason: string, payload: Record<string, unknown>) {
  console.info("[CHECKOUT RECOVERY] token_invalid", { reason, ...payload });
}

function isRecoveryType(value: string): value is CheckoutRecoveryType {
  return CHECKOUT_RECOVERY_TYPES.includes(value as CheckoutRecoveryType);
}

export async function generateCheckoutRecoveryToken(params: {
  shopId: string;
  checkoutIntentId: string;
  recoveryType: CheckoutRecoveryType;
}) {
  if (!isRecoveryType(params.recoveryType)) throw new Error("Unsupported checkout recovery type");

  const intents = await prisma.$queryRaw<Array<Pick<CheckoutIntentRecord, "id" | "shopId" | "customerProfileId" | "expiresAt">>>`
    SELECT "id", "shopId", "customerProfileId", "expiresAt"
    FROM "ExpressCheckoutIntent"
    WHERE "shopId" = ${params.shopId} AND "id" = ${params.checkoutIntentId}
    LIMIT 1
  `;
  const intent = intents[0] || null;
  if (!intent) throw new Error("Checkout intent not found");

  const rawToken = newRawToken();
  const expiresAt = minDate(new Date(Date.now() + RECOVERY_TOKEN_TTL_MS), intent.expiresAt);

  const tokenId = crypto.randomUUID();

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "CheckoutRecoveryToken"
      SET "status" = 'REVOKED'::"CheckoutRecoveryTokenStatus", "revokedAt" = NOW(), "updatedAt" = NOW()
      WHERE "shopId" = ${params.shopId}
        AND "checkoutIntentId" = ${params.checkoutIntentId}
        AND "recoveryType" = ${params.recoveryType}::"CheckoutRecoveryType"
        AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"
    `;

    const rows = await tx.$queryRaw<Array<{ id: string; checkoutIntentId: string; recoveryType: CheckoutRecoveryType; expiresAt: Date }>>`
      INSERT INTO "CheckoutRecoveryToken" ("id", "shopId", "checkoutIntentId", "customerProfileId", "tokenHash", "recoveryType", "status", "expiresAt", "updatedAt")
      VALUES (${tokenId}, ${params.shopId}, ${params.checkoutIntentId}, ${intent.customerProfileId}, ${tokenHash(rawToken)}, ${params.recoveryType}::"CheckoutRecoveryType", 'ACTIVE'::"CheckoutRecoveryTokenStatus", ${expiresAt}, NOW())
      RETURNING "id", "checkoutIntentId", "recoveryType", "expiresAt"
    `;
    return rows[0];
  });

  logRecovery("token_created", { shopId: params.shopId, tokenId: created.id, checkoutIntentId: created.checkoutIntentId, recoveryType: created.recoveryType, expiresAt: created.expiresAt });

  return { token: rawToken, tokenId: created.id, recoveryUrl: `/apps/megaska/checkout/recover?t=${encodeURIComponent(rawToken)}`, expiresAt: created.expiresAt };
}

export async function validateCheckoutRecoveryToken(params: { shopId: string; token: string }): Promise<CheckoutRecoveryContext> {
  const hashedToken = tokenHash(params.token);
  const tokens = await prisma.$queryRaw<CheckoutRecoveryTokenRecord[]>`
    SELECT "id", "shopId", "checkoutIntentId", "customerProfileId", "tokenHash", "recoveryType", "status", "expiresAt", "clickedAt", "usedAt", "revokedAt"
    FROM "CheckoutRecoveryToken"
    WHERE "shopId" = ${params.shopId}
      AND "tokenHash" = ${hashedToken}
      AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"
    LIMIT 1
  `;
  const token = tokens[0] || null;

  if (!token) {
    logInvalid("missing_or_unknown", { shopId: params.shopId });
    throw new Error(CHECKOUT_RECOVERY_EXPIRED_MESSAGE);
  }

  const now = new Date();
  if (token.expiresAt <= now) {
    await prisma.$executeRaw`UPDATE "CheckoutRecoveryToken" SET "status" = 'EXPIRED'::"CheckoutRecoveryTokenStatus", "updatedAt" = NOW() WHERE "shopId" = ${params.shopId} AND "id" = ${token.id} AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"`;
    console.info("[CHECKOUT RECOVERY] token_expired", { shopId: params.shopId, tokenId: token.id, checkoutIntentId: token.checkoutIntentId, recoveryType: token.recoveryType });
    throw new Error(CHECKOUT_RECOVERY_EXPIRED_MESSAGE);
  }

  const intents = await prisma.$queryRaw<CheckoutIntentRecord[]>`
    SELECT "id", "shopId", "customerProfileId", "status", "expiresAt"
    FROM "ExpressCheckoutIntent"
    WHERE "shopId" = ${params.shopId} AND "id" = ${token.checkoutIntentId}
    LIMIT 1
  `;
  const intent = intents[0] || null;
  if (!intent || intent.status === "ORDER_COMPLETED" || intent.status === "EXPIRED" || (intent.expiresAt && intent.expiresAt <= now)) {
    logInvalid("intent_unrecoverable", { shopId: params.shopId, tokenId: token.id, checkoutIntentId: token.checkoutIntentId, intentStatus: intent?.status || null });
    throw new Error(CHECKOUT_RECOVERY_EXPIRED_MESSAGE);
  }

  if (!token.clickedAt) {
    await prisma.$executeRaw`UPDATE "CheckoutRecoveryToken" SET "clickedAt" = ${now}, "updatedAt" = NOW() WHERE "shopId" = ${params.shopId} AND "id" = ${token.id} AND "clickedAt" IS NULL AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"`;
  }

  const context = { checkoutIntentId: token.checkoutIntentId, recoveryType: token.recoveryType, status: "ACTIVE" as const, expiresAt: token.expiresAt };
  logRecovery("token_validated", { shopId: params.shopId, tokenId: token.id, checkoutIntentId: token.checkoutIntentId, recoveryType: token.recoveryType });
  return context;
}

export async function markCheckoutRecoveryTokenUsed(params: { shopId: string; tokenId: string }) {
  const changed = await prisma.$executeRaw`UPDATE "CheckoutRecoveryToken" SET "status" = 'USED'::"CheckoutRecoveryTokenStatus", "usedAt" = NOW(), "updatedAt" = NOW() WHERE "shopId" = ${params.shopId} AND "id" = ${params.tokenId} AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"`;
  console.info("[CHECKOUT RECOVERY] token_used", { shopId: params.shopId, tokenId: params.tokenId, changed });
  return changed > 0;
}

export async function revokeCheckoutRecoveryTokensForIntent(params: { shopId: string; checkoutIntentId: string }) {
  const changed = await prisma.$executeRaw`UPDATE "CheckoutRecoveryToken" SET "status" = 'REVOKED'::"CheckoutRecoveryTokenStatus", "revokedAt" = NOW(), "updatedAt" = NOW() WHERE "shopId" = ${params.shopId} AND "checkoutIntentId" = ${params.checkoutIntentId} AND "status" = 'ACTIVE'::"CheckoutRecoveryTokenStatus"`;
  console.info("[CHECKOUT RECOVERY] token_revoked", { shopId: params.shopId, checkoutIntentId: params.checkoutIntentId, changed });
  return changed;
}
