export const CHECKOUT_INTENT_STATUSES = [
  "INITIATED",
  "SESSION_VERIFIED",
  "ADDRESS_COMPLETED",
  "DELIVERY_VALIDATED",
  "COUPON_APPLIED",
  "PAYMENT_SELECTED",
  "DRAFT_ORDER_CREATED",
  "PAYMENT_PENDING",
  "PAYMENT_SUCCESS",
  "ORDER_COMPLETED",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "ABANDONED",
  "EXPIRED",
] as const;

export type CheckoutIntentStatus = (typeof CHECKOUT_INTENT_STATUSES)[number];

export const CHECKOUT_INTENT_TERMINAL_STATUSES = ["ORDER_COMPLETED", "EXPIRED"] as const satisfies readonly CheckoutIntentStatus[];

export type CheckoutIntentTerminalStatus = (typeof CHECKOUT_INTENT_TERMINAL_STATUSES)[number];

export const CHECKOUT_INTENT_VALID_TRANSITIONS: Readonly<Record<CheckoutIntentStatus, readonly CheckoutIntentStatus[]>> = {
  INITIATED: ["SESSION_VERIFIED", "ABANDONED", "EXPIRED"],
  SESSION_VERIFIED: ["ADDRESS_COMPLETED", "ABANDONED", "EXPIRED"],
  ADDRESS_COMPLETED: ["DELIVERY_VALIDATED", "ABANDONED", "EXPIRED"],
  DELIVERY_VALIDATED: ["COUPON_APPLIED", "PAYMENT_SELECTED", "ABANDONED", "EXPIRED"],
  COUPON_APPLIED: ["PAYMENT_SELECTED", "ABANDONED", "EXPIRED"],
  PAYMENT_SELECTED: ["DRAFT_ORDER_CREATED", "PAYMENT_PENDING", "ABANDONED", "EXPIRED"],
  DRAFT_ORDER_CREATED: ["PAYMENT_PENDING", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_CANCELLED", "ORDER_COMPLETED", "ABANDONED", "EXPIRED"],
  PAYMENT_PENDING: ["PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_CANCELLED", "ABANDONED", "EXPIRED"],
  PAYMENT_SUCCESS: ["ORDER_COMPLETED", "EXPIRED"],
  ORDER_COMPLETED: [],
  PAYMENT_FAILED: ["PAYMENT_SELECTED", "PAYMENT_PENDING", "ABANDONED", "EXPIRED"],
  PAYMENT_CANCELLED: ["PAYMENT_SELECTED", "ABANDONED", "EXPIRED"],
  ABANDONED: ["SESSION_VERIFIED", "ADDRESS_COMPLETED", "EXPIRED"],
  EXPIRED: [],
};

type CheckoutIntentRecord = {
  id: string;
  shopId: string;
  status: string;
};

type CheckoutIntentUpdateDelegate = {
  updateMany(args: {
    where: { id: string; shopId: string; status?: string };
    data: { status: CheckoutIntentStatus };
  }): Promise<{ count: number }>;
};

export type CheckoutStateDb = {
  expressCheckoutIntent: CheckoutIntentUpdateDelegate;
};

export type TransitionCheckoutIntentInput = {
  db: CheckoutStateDb;
  intent: CheckoutIntentRecord;
  toStatus: CheckoutIntentStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type TransitionCheckoutIntentResult =
  | { ok: true; fromStatus: string; toStatus: CheckoutIntentStatus; changed: boolean }
  | { ok: false; fromStatus: string; toStatus: CheckoutIntentStatus; reason: "terminal_state" | "invalid_transition" | "concurrent_update" };

export function isCheckoutIntentStatus(status: string): status is CheckoutIntentStatus {
  return (CHECKOUT_INTENT_STATUSES as readonly string[]).includes(status);
}

export function isCheckoutIntentTerminalStatus(status: string): status is CheckoutIntentTerminalStatus {
  return (CHECKOUT_INTENT_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export async function transitionCheckoutIntent({
  db,
  intent,
  toStatus,
  reason = "checkout_state_transition",
  metadata = {},
}: TransitionCheckoutIntentInput): Promise<TransitionCheckoutIntentResult> {
  const fromStatus = intent.status;
  const logBase = {
    shopId: intent.shopId,
    intentId: intent.id,
    fromStatus,
    toStatus,
    reason,
    metadata,
  };

  if (fromStatus === toStatus) {
    console.info("[CHECKOUT STATE] state_transition", { ...logBase, changed: false });
    return { ok: true, fromStatus, toStatus, changed: false };
  }

  if (isCheckoutIntentTerminalStatus(fromStatus)) {
    console.warn("[CHECKOUT STATE] invalid_transition_blocked", { ...logBase, blockReason: "terminal_state" });
    return { ok: false, fromStatus, toStatus, reason: "terminal_state" };
  }

  const validNextStatuses = isCheckoutIntentStatus(fromStatus) ? CHECKOUT_INTENT_VALID_TRANSITIONS[fromStatus] : [];

  if (!validNextStatuses.includes(toStatus)) {
    console.warn("[CHECKOUT STATE] invalid_transition_blocked", { ...logBase, blockReason: "invalid_transition" });
    return { ok: false, fromStatus, toStatus, reason: "invalid_transition" };
  }

  const update = await db.expressCheckoutIntent.updateMany({
    where: { id: intent.id, shopId: intent.shopId, status: fromStatus },
    data: { status: toStatus },
  });

  if (update.count !== 1) {
    console.warn("[CHECKOUT STATE] invalid_transition_blocked", { ...logBase, blockReason: "concurrent_update" });
    return { ok: false, fromStatus, toStatus, reason: "concurrent_update" };
  }

  console.info("[CHECKOUT STATE] state_transition", { ...logBase, changed: true });
  return { ok: true, fromStatus, toStatus, changed: true };
}
