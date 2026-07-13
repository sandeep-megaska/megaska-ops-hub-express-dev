import { calculateCodAdvancePolicy, type CodAdvancePolicyInput, type CodAdvancePolicyResult } from "./policy.ts";

const INTENT_EXPIRES_IN_MS = 15 * 60 * 1000;

export const COD_ADVANCE_ALLOWED_CHECKOUT_STATUSES = new Set([
  "CREATED",
  "CUSTOMER_AUTHENTICATED",
  "CART_SNAPSHOT_LOCKED",
  "ADDRESS_CAPTURED",
  "DISCOUNT_APPLIED",
  "PAYMENT_METHOD_SELECTED",
  "INITIATED",
  "SESSION_VERIFIED",
  "ADDRESS_COMPLETED",
  "DELIVERY_VALIDATED",
  "COUPON_APPLIED",
  "PAYMENT_SELECTED",
]);

const REUSABLE_STATUSES = ["CREATED", "PAYMENT_PENDING"];

export type CodAdvanceResolverErrorCode = "INVALID_CHECKOUT_STATE" | "INVALID_PAYMENT_METHOD";

export class CodAdvanceResolverError extends Error {
  readonly status: number;
  readonly code: CodAdvanceResolverErrorCode;

  constructor(status: number, code: CodAdvanceResolverErrorCode, message: string) {
    super(message);
    this.name = "CodAdvanceResolverError";
    this.status = status;
    this.code = code;
  }
}

export type CodAdvanceIntentLike = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  expressCheckoutIntentId: string | null;
  orderAmountPaise: number;
  advanceAmountPaise: number;
  codBalanceAmountPaise: number;
  currency: string;
  status: string;
  expiresAt: Date | null;
  paidAt?: Date | null;
  consumedAt?: Date | null;
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
  createdAt: Date;
};

type CodAdvanceIntentDelegate = {
  findMany(args: unknown): Promise<CodAdvanceIntentLike[]>;
  updateMany(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<CodAdvanceIntentLike>;
};

export type CodAdvanceResolverDb = {
  codAdvanceIntent: CodAdvanceIntentDelegate;
  $transaction?: <T>(fn: (tx: CodAdvanceResolverDb) => Promise<T>) => Promise<T>;
};

export type ResolveCodAdvanceInput = {
  db: CodAdvanceResolverDb;
  shopId: string;
  customerProfileId: string | null;
  expressCheckoutIntentId: string;
  checkoutStatus: string;
  selectedPaymentMethod?: string | null;
  policyInput: CodAdvancePolicyInput;
  currency?: string;
  checkoutExpiresAt?: Date | null;
  now?: Date;
  metadata?: unknown;
  audit?: (eventType: string, entityType: string, entityId: string | null, payload?: unknown) => Promise<void>;
};

export type CodAdvanceResolutionDto = {
  policy: CodAdvancePolicyResult;
  codAdvanceIntentId: string | null;
  paymentMode: "COD" | "COD_ADVANCE";
  expiresAt: Date | null;
  intent: CodAdvanceIntentLike | null;
};

function assertResolvableCheckout(input: ResolveCodAdvanceInput) {
  if (!COD_ADVANCE_ALLOWED_CHECKOUT_STATUSES.has(input.checkoutStatus)) {
    throw new CodAdvanceResolverError(409, "INVALID_CHECKOUT_STATE", `Checkout status ${input.checkoutStatus} cannot resolve COD advance`);
  }

  const paymentMethod = input.selectedPaymentMethod?.trim().toUpperCase() || null;
  if (paymentMethod !== null && paymentMethod !== "COD") {
    throw new CodAdvanceResolverError(409, "INVALID_PAYMENT_METHOD", "COD advance can only be resolved for COD checkouts");
  }
}

function isReusable(intent: CodAdvanceIntentLike, now: Date) {
  return REUSABLE_STATUSES.includes(intent.status) && (intent.expiresAt === null || intent.expiresAt > now) && !intent.paidAt && !intent.consumedAt && !intent.shopifyOrderId && !intent.shopifyOrderName;
}

function isCancellableStale(intent: CodAdvanceIntentLike, now: Date) {
  return REUSABLE_STATUSES.includes(intent.status) && intent.expiresAt !== null && intent.expiresAt <= now && !intent.paidAt && !intent.consumedAt && !intent.shopifyOrderId && !intent.shopifyOrderName;
}

function codOnlyDto(policy: CodAdvancePolicyResult, checkoutExpiresAt: Date | null | undefined): CodAdvanceResolutionDto {
  return { policy, codAdvanceIntentId: null, paymentMode: "COD", expiresAt: checkoutExpiresAt ?? null, intent: null };
}

export async function resolveCodAdvance(input: ResolveCodAdvanceInput): Promise<CodAdvanceResolutionDto> {
  assertResolvableCheckout(input);

  const policy = calculateCodAdvancePolicy(input.policyInput);
  if (!policy.available || !policy.eligible || !policy.requiresAdvance) {
    return codOnlyDto(policy, input.checkoutExpiresAt);
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + INTENT_EXPIRES_IN_MS);
  const run = async (tx: CodAdvanceResolverDb) => {
    const existing = await tx.codAdvanceIntent.findMany({
      where: { shopId: input.shopId, expressCheckoutIntentId: input.expressCheckoutIntentId },
      orderBy: { createdAt: "desc" },
    });
    const reusable = existing.find((intent) => isReusable(intent, now));
    if (reusable) return { intent: reusable, created: false };

    const cancellableIds = existing.filter((intent) => isCancellableStale(intent, now)).map((intent) => intent.id);
    if (cancellableIds.length > 0) {
      await tx.codAdvanceIntent.updateMany({
        where: {
          id: { in: cancellableIds },
          status: { in: REUSABLE_STATUSES },
          paidAt: null,
          consumedAt: null,
          shopifyOrderId: null,
          shopifyOrderName: null,
        },
        data: { status: "EXPIRED" },
      });
    }

    const intent = await tx.codAdvanceIntent.create({
      data: {
        shopId: input.shopId,
        customerProfileId: input.customerProfileId,
        expressCheckoutIntentId: input.expressCheckoutIntentId,
        orderAmountPaise: policy.orderTotalPaise,
        advanceAmountPaise: policy.advanceAmountPaise,
        codBalanceAmountPaise: policy.codBalanceAmountPaise,
        currency: input.currency ?? "INR",
        storeCreditAppliedPaise: policy.storeCreditAppliedPaise,
        customerCashLiabilityPaise: policy.customerCashLiabilityPaise,
        expiresAt,
        metadata: input.metadata ?? undefined,
      },
    });
    return { intent, created: true };
  };

  const result = input.db.$transaction ? await input.db.$transaction(run) : await run(input.db);
  if (result.created && input.audit) {
    await input.audit("cod_advance.intent.created", "CodAdvanceIntent", result.intent.id, { shopId: input.shopId, expressCheckoutIntentId: input.expressCheckoutIntentId });
  }

  return { policy, codAdvanceIntentId: result.intent.id, paymentMode: "COD_ADVANCE", expiresAt: result.intent.expiresAt, intent: result.intent };
}
