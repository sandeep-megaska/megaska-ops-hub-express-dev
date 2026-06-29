import { prisma } from "../../services/db/prisma";

export const CHECKOUT_INTENT_EXPIRY_MESSAGE = "Checkout session expired. Please start checkout again.";
export const CHECKOUT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

type CheckoutIntentExpiryDelegate = {
  updateMany(args: {
    where: { shopId: string; id: string; status: { notIn: string[] } };
    data: { status: string };
  }): Promise<{ count: number }>;
};

type CheckoutExpiryDb = { expressCheckoutIntent: CheckoutIntentExpiryDelegate };

type ExpirableCheckoutIntent = {
  id: string;
  shopId: string;
  status: string;
  expiresAt?: Date | string | null;
};

export function isCheckoutIntentExpired(intent: Pick<ExpirableCheckoutIntent, "expiresAt"> | null | undefined) {
  return Boolean(intent?.expiresAt && new Date(intent.expiresAt).getTime() <= Date.now());
}

export async function markCheckoutIntentExpiredIfNeeded(intent: ExpirableCheckoutIntent) {
  if (!isCheckoutIntentExpired(intent)) return false;
  if (intent.status === "EXPIRED") return true;

  const update = await (prisma as unknown as CheckoutExpiryDb).expressCheckoutIntent.updateMany({
    where: { shopId: intent.shopId, id: intent.id, status: { notIn: ["ORDER_COMPLETED", "EXPIRED"] } },
    data: { status: "EXPIRED" },
  });

  if (update.count > 0) console.info("[CHECKOUT STATE] checkout_expired", { shopId: intent.shopId, intentId: intent.id, fromStatus: intent.status });
  return true;
}
