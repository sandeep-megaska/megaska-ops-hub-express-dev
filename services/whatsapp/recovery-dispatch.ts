import { createHash, randomBytes } from "crypto";
import { prisma } from "../db/prisma";
import { sendTemplateMessage, WHATSAPP_PROVIDER_META_CLOUD_API } from "./index";

const RECOVERY_LINK_PREFIX = "/apps/megaska/checkout/recover?t=";
const RECOVERY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_RECOVERY_SUPPRESSION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LANGUAGE_CODE = "en";

const RECOVERY_TEMPLATES = {
  CHECKOUT_ABANDONMENT: "checkout_recovery",
  PAYMENT_ABANDONMENT: "payment_recovery",
} as const;

type RecoveryType = keyof typeof RECOVERY_TEMPLATES;

type RecoveryCandidateCustomer = {
  phone?: string | null;
  phoneE164?: string | null;
  optedOut?: boolean | null;
  whatsappOptedOut?: boolean | null;
  whatsAppOptedOut?: boolean | null;
};

export type RecoveryDispatchCandidate = {
  shopId?: string | null;
  checkoutIntentId?: string | null;
  recoveryType?: string | null;
  customerPhone?: string | null;
  phone?: string | null;
  phoneE164?: string | null;
  customer?: RecoveryCandidateCustomer | null;
  customerProfileId?: string | null;
  recoveryToken?: string | null;
  languageCode?: string | null;
};

type RecoveryDispatchResult =
  | { ok: true; sent: true; templateName: string; recoveryLink: string; messageId: string | null }
  | { ok: true; sent: false; suppressed: true; reason: string }
  | { ok: false; sent: false; reason: string };

type RecoveryDispatchDb = {
  expressCheckoutIntent: {
    findFirst(args: { where: { id: string; shopId: string }; select: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
  checkoutRecoveryToken?: {
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  auditEvent?: {
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
};

function logRecovery(event: string, payload: Record<string, unknown>) {
  console.log(`[CHECKOUT RECOVERY] ${event}`, payload);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateRecoveryToken() {
  return randomBytes(32).toString("base64url");
}

function getCustomerPhone(candidate: RecoveryDispatchCandidate) {
  return candidate.customerPhone || candidate.phoneE164 || candidate.phone || candidate.customer?.phoneE164 || candidate.customer?.phone || null;
}

function isCustomerOptedOut(candidate: RecoveryDispatchCandidate) {
  return Boolean(candidate.customer?.optedOut || candidate.customer?.whatsappOptedOut || candidate.customer?.whatsAppOptedOut);
}

function isRecoveryType(value: string | null | undefined): value is RecoveryType {
  return value === "CHECKOUT_ABANDONMENT" || value === "PAYMENT_ABANDONMENT";
}

function isCompletedIntent(intent: Record<string, unknown>) {
  return ["ORDER_CREATED", "ORDER_COMPLETED", "PAYMENT_SUCCESS", "PAYMENT_CONFIRMED"].includes(String(intent.status || "")) || Boolean(intent.completedAt);
}

function isExpiredIntent(intent: Record<string, unknown>, now: Date) {
  if (String(intent.status || "") === "EXPIRED") return true;
  const expiresAt = intent.expiresAt instanceof Date ? intent.expiresAt : intent.expiresAt ? new Date(String(intent.expiresAt)) : null;
  return Boolean(expiresAt && expiresAt <= now);
}

async function findRecentRecoveryEvent(db: RecoveryDispatchDb, candidate: Required<Pick<RecoveryDispatchCandidate, "shopId" | "checkoutIntentId">> & { recoveryType: RecoveryType }, since: Date) {
  if (!db.auditEvent?.findFirst) return null;

  return db.auditEvent.findFirst({
    where: {
      eventType: "checkout_recovery.dispatch_sent",
      entityType: "ExpressCheckoutIntent",
      entityId: candidate.checkoutIntentId,
      createdAt: { gte: since },
      payload: { path: ["shopId"], equals: candidate.shopId },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function createRecoveryEvent(db: RecoveryDispatchDb, eventType: string, entityId: string, payload: Record<string, unknown>) {
  if (!db.auditEvent?.create) return;
  await db.auditEvent.create({ data: { actorType: "system", eventType, entityType: "ExpressCheckoutIntent", entityId, payload: payload as never } });
}

async function generateOrReuseRecoveryToken(db: RecoveryDispatchDb, candidate: RecoveryDispatchCandidate & { shopId: string; checkoutIntentId: string; recoveryType: RecoveryType }, now: Date) {
  if (candidate.recoveryToken) return candidate.recoveryToken;

  const existing = await db.checkoutRecoveryToken?.findFirst({
    where: { shopId: candidate.shopId, checkoutIntentId: candidate.checkoutIntentId, recoveryType: candidate.recoveryType, status: "ACTIVE", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  const metadataToken = typeof existing?.metadata === "object" && existing.metadata && "token" in existing.metadata ? String((existing.metadata as { token?: unknown }).token || "") : "";
  if (metadataToken) return metadataToken;

  const token = generateRecoveryToken();
  await db.checkoutRecoveryToken?.create({
    data: {
      shopId: candidate.shopId,
      checkoutIntentId: candidate.checkoutIntentId,
      customerProfileId: candidate.customerProfileId || null,
      recoveryType: candidate.recoveryType,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RECOVERY_TOKEN_TTL_MS),
      metadata: { provider: WHATSAPP_PROVIDER_META_CLOUD_API },
    },
  });
  return token;
}

export async function dispatchRecoveryMessage(candidate: RecoveryDispatchCandidate): Promise<RecoveryDispatchResult> {
  const now = new Date();
  const phone = getCustomerPhone(candidate);
  const context = { shopId: candidate.shopId || null, checkoutIntentId: candidate.checkoutIntentId || null, recoveryType: candidate.recoveryType || null };
  logRecovery("dispatch_attempt", context);

  if (!candidate.shopId || !candidate.checkoutIntentId || !isRecoveryType(candidate.recoveryType) || !phone) {
    logRecovery("dispatch_failed", { ...context, reason: "missing_required_candidate_fields" });
    return { ok: false, sent: false, reason: "missing_required_candidate_fields" };
  }

  if (isCustomerOptedOut(candidate)) {
    logRecovery("dispatch_suppressed", { ...context, reason: "customer_opted_out" });
    return { ok: true, sent: false, suppressed: true, reason: "customer_opted_out" };
  }

  const db = prisma as unknown as RecoveryDispatchDb;
  const intent = await db.expressCheckoutIntent.findFirst({ where: { id: candidate.checkoutIntentId, shopId: candidate.shopId }, select: { id: true, shopId: true, status: true, expiresAt: true, completedAt: true } });
  if (!intent) {
    logRecovery("dispatch_failed", { ...context, reason: "intent_not_found" });
    return { ok: false, sent: false, reason: "intent_not_found" };
  }
  if (isCompletedIntent(intent) || isExpiredIntent(intent, now)) {
    const reason = isCompletedIntent(intent) ? "intent_completed" : "intent_expired";
    logRecovery("dispatch_suppressed", { ...context, reason });
    return { ok: true, sent: false, suppressed: true, reason };
  }

  const recentEvent = await findRecentRecoveryEvent(db, { shopId: candidate.shopId, checkoutIntentId: candidate.checkoutIntentId, recoveryType: candidate.recoveryType }, new Date(now.getTime() - RECENT_RECOVERY_SUPPRESSION_MS));
  if (recentEvent) {
    logRecovery("dispatch_suppressed", { ...context, reason: "recent_recovery_already_sent" });
    return { ok: true, sent: false, suppressed: true, reason: "recent_recovery_already_sent" };
  }

  try {
    const token = await generateOrReuseRecoveryToken(db, { ...candidate, shopId: candidate.shopId, checkoutIntentId: candidate.checkoutIntentId, recoveryType: candidate.recoveryType }, now);
    const recoveryLink = `${RECOVERY_LINK_PREFIX}${encodeURIComponent(token)}`;
    const templateName = RECOVERY_TEMPLATES[candidate.recoveryType];
    const result = await sendTemplateMessage({
      shopId: candidate.shopId,
      checkoutIntentId: candidate.checkoutIntentId,
      recoveryType: candidate.recoveryType,
      toPhone: phone,
      templateName,
      languageCode: candidate.languageCode || DEFAULT_LANGUAGE_CODE,
      variables: [recoveryLink],
    });

    if (!result.success) throw new Error("whatsapp_provider_send_failed");

    await createRecoveryEvent(db, "checkout_recovery.dispatch_sent", candidate.checkoutIntentId, { shopId: candidate.shopId, recoveryType: candidate.recoveryType, provider: result.provider, messageId: result.messageId || null, templateName });
    logRecovery("dispatch_sent", { ...context, templateName, messageId: result.messageId || null });
    return { ok: true, sent: true, templateName, recoveryLink, messageId: result.messageId || null };
  } catch (error) {
    logRecovery("dispatch_failed", { ...context, reason: error instanceof Error ? error.message : String(error) });
    return { ok: false, sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export { RECOVERY_TEMPLATES };
