import { prisma } from "../../services/db/prisma";
import { CheckoutStateDb, transitionCheckoutIntent } from "./state-machine";

const ABANDONMENT_PENDING_MS = 30 * 60 * 1000;

type AbandonedCheckoutCandidate = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  status: string;
  selectedPaymentMethod: string | null;
  paymentPendingAt: Date | null;
  completedAt: Date | null;
  abandonedAt: Date | null;
  expiresAt: Date | null;
};

type CheckoutIntentForAbandonment = {
  id: string;
  shopId: string;
  status: string;
};

type CheckoutIntentFindDelegate = {
  findFirst(args: { where: { id: string }; select: { id: true; shopId: true; status: true } }): Promise<CheckoutIntentForAbandonment | null>;
};

type CheckoutIntentAbandonmentDb = {
  expressCheckoutIntent: CheckoutIntentFindDelegate;
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export async function findAbandonedCheckoutCandidates(now = new Date()) {
  const cutoff = new Date(now.getTime() - ABANDONMENT_PENDING_MS);
  const db = prisma as unknown as CheckoutIntentAbandonmentDb;

  return db.$queryRaw<AbandonedCheckoutCandidate[]>`
    SELECT
      "id",
      "shopId",
      "customerProfileId",
      "status"::text AS "status",
      "selectedPaymentMethod"::text AS "selectedPaymentMethod",
      "paymentPendingAt",
      "completedAt",
      "abandonedAt",
      "expiresAt"
    FROM "ExpressCheckoutIntent"
    WHERE "selectedPaymentMethod" = 'PREPAID'::"ExpressCheckoutPaymentMethod"
      AND "status" = 'PAYMENT_PENDING'::"ExpressCheckoutIntentStatus"
      AND "paymentPendingAt" < ${cutoff}
      AND "completedAt" IS NULL
      AND "abandonedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
    ORDER BY "paymentPendingAt" ASC
  `;
}

async function checkoutIntentHasAbandonedAtColumn(db: CheckoutIntentAbandonmentDb) {
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'ExpressCheckoutIntent'
        AND column_name = 'abandonedAt'
    ) AS "exists"
  `;

  return Boolean(rows[0]?.exists);
}

export async function markCheckoutIntentAbandoned(intentId: string) {
  const db = prisma as unknown as CheckoutIntentAbandonmentDb;
  const intent = await db.expressCheckoutIntent.findFirst({
    where: { id: intentId },
    select: { id: true, shopId: true, status: true },
  });

  if (!intent || intent.status !== "PAYMENT_PENDING") return false;

  const transition = await transitionCheckoutIntent({
    db: prisma as unknown as CheckoutStateDb,
    intent,
    toStatus: "ABANDONED",
    reason: "checkout_abandoned_ready",
  });

  if (!transition.ok || !transition.changed) return false;

  if (await checkoutIntentHasAbandonedAtColumn(db)) {
    await db.$executeRaw`
      UPDATE "ExpressCheckoutIntent"
      SET "abandonedAt" = COALESCE("abandonedAt", NOW())
      WHERE "id" = ${intent.id}
        AND "shopId" = ${intent.shopId}
        AND "status" = 'ABANDONED'::"ExpressCheckoutIntentStatus"
    `;
  }

  console.info("[CHECKOUT STATE] checkout_abandoned_ready", { shopId: intent.shopId, intentId: intent.id, fromStatus: intent.status, toStatus: "ABANDONED" });
  return true;
}
