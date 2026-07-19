import { prisma } from "../db/prisma.ts";
import { recordCanonicalOrderDelivery } from "../orders/canonical-delivery.ts";
import { synchronizeDeliveredOrderReviewCandidatesBestEffort } from "../reviews/review-delivery-integration.ts";

export type DevDeliveryHelperErrorCode =
  | "DEV_HELPER_DISABLED"
  | "DEV_HELPER_NOT_ALLOWED_IN_ENVIRONMENT"
  | "SHOP_NOT_RESOLVED"
  | "ORDER_NOT_FOUND"
  | "DELIVERY_TRANSITION_FAILED"
  | "INVALID_INPUT";

export class DevDeliveryHelperError extends Error {
  readonly code: DevDeliveryHelperErrorCode;

  constructor(code: DevDeliveryHelperErrorCode) {
    super(code);
    this.code = code;
    this.name = "DevDeliveryHelperError";
  }
}

type Environment = Record<string, string | undefined>;

export function assertDevelopmentDeliveryHelperEnabled(env: Environment = process.env): void {
  if (env.LOOPDESK_DEV_DELIVERY_HELPER_ENABLED !== "true") {
    throw new DevDeliveryHelperError("DEV_HELPER_DISABLED");
  }

  const deployment = env.VERCEL_ENV?.toLowerCase();
  const loopdeskEnvironment = env.LOOPDESK_ENV?.toLowerCase();
  const explicitlyProduction = deployment === "production" || loopdeskEnvironment === "production";
  const explicitlyNonProduction =
    deployment === "preview" ||
    deployment === "development" ||
    loopdeskEnvironment === "development" ||
    env.NODE_ENV === "development";
  if (explicitlyProduction || !explicitlyNonProduction) {
    throw new DevDeliveryHelperError("DEV_HELPER_NOT_ALLOWED_IN_ENVIRONMENT");
  }
}

type CanonicalOrder = {
  id: string;
  shopId: string;
  shopifyOrderName: string;
  status: string;
  deliveredAt: Date | null;
};

type DevDeliveryDb = {
  shop: { findUnique(args: unknown): Promise<{ id: string } | null> };
  megaskaOrder: { findFirst(args: unknown): Promise<CanonicalOrder | null> };
};

type Dependencies = {
  db?: DevDeliveryDb;
  transition?: typeof recordCanonicalOrderDelivery;
  synchronizeReviews?: typeof synchronizeDeliveredOrderReviewCandidatesBestEffort;
  env?: Environment;
  log?: (event: Record<string, unknown>) => void;
};

export type MarkOrderDeliveredForDevelopmentInput = {
  shopId: string;
  shopDomain?: string;
  orderId: string;
  deliveredAt?: Date;
  actor?: string | null;
  reason?: string | null;
  runDeliveryAutomations?: boolean;
};

export async function markOrderDeliveredForDevelopment(
  input: MarkOrderDeliveredForDevelopmentInput,
  dependencies: Dependencies = {},
) {
  assertDevelopmentDeliveryHelperEnabled(dependencies.env);
  const shopId = input.shopId.trim();
  const orderId = input.orderId.trim();
  const reason = input.reason?.trim().slice(0, 240) || null;
  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : new Date();
  if (!shopId || !orderId || Number.isNaN(deliveredAt.getTime()) || input.runDeliveryAutomations === true) {
    throw new DevDeliveryHelperError("INVALID_INPUT");
  }

  const db = dependencies.db ?? (prisma as unknown as DevDeliveryDb);
  if (!(await db.shop.findUnique({ where: { id: shopId }, select: { id: true } }))) {
    throw new DevDeliveryHelperError("SHOP_NOT_RESOLVED");
  }
  const order = await db.megaskaOrder.findFirst({
    where: { id: orderId, shopId },
    select: { id: true, shopId: true, shopifyOrderName: true, status: true, deliveredAt: true },
  });
  if (!order) throw new DevDeliveryHelperError("ORDER_NOT_FOUND");

  const alreadyDelivered = order.status === "DELIVERED" && Boolean(order.deliveredAt);
  let canonical = order;
  if (!alreadyDelivered) {
    try {
      const transitioned = await (dependencies.transition ?? recordCanonicalOrderDelivery)(
        { shopId, megaskaOrderId: order.id, deliveredAt, source: "MANUAL" },
        db as never,
      );
      canonical = { ...order, status: transitioned.status, deliveredAt: transitioned.deliveredAt };
    } catch {
      throw new DevDeliveryHelperError("DELIVERY_TRANSITION_FAILED");
    }
  }
  if (!canonical.deliveredAt || canonical.status !== "DELIVERED") {
    throw new DevDeliveryHelperError("DELIVERY_TRANSITION_FAILED");
  }

  const result = {
    orderId: canonical.id,
    orderName: canonical.shopifyOrderName,
    deliveryStatus: "DELIVERED" as const,
    deliveredAt: canonical.deliveredAt,
    alreadyDelivered,
    updatedRecords: alreadyDelivered ? [] : ["MegaskaOrder"],
    automationsExecuted: false,
  };
  const reviewSync = input.shopDomain
    ? await (dependencies.synchronizeReviews ?? synchronizeDeliveredOrderReviewCandidatesBestEffort)({
        shopId,
        megaskaOrderId: canonical.id,
        shopDomain: input.shopDomain,
      })
    : null;
  (dependencies.log ?? console.info)({
    event: "development_order_marked_delivered",
    shopId,
    orderId: order.id,
    actor: input.actor?.trim().slice(0, 120) || null,
    deliveredAt: canonical.deliveredAt.toISOString(),
    reason,
    alreadyDelivered,
    automationsExecuted: false,
    deploymentEnvironment: dependencies.env?.VERCEL_ENV ?? process.env.VERCEL_ENV ?? dependencies.env?.LOOPDESK_ENV ?? process.env.LOOPDESK_ENV ?? dependencies.env?.NODE_ENV ?? process.env.NODE_ENV ?? null,
  });
  return { ...result, reviewSync };
}
