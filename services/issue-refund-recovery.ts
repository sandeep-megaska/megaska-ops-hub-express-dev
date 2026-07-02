import type { RefundMethod } from "../generated/prisma/index.js";
import { prisma } from "./db/prisma";
import { createRefundRequest, detectRefundMethodFromGateway } from "./refund-request";

const SHOP_CONTEXT_ERROR = "Cannot approve for refund because shop context is missing.";
const AMOUNT_ERROR = "Cannot approve for refund because refund amount is missing.";
const PAYMENT_METHOD_ERROR = "Cannot approve for refund because payment method could not be determined.";

type IssueForRefundRecovery = Awaited<ReturnType<typeof loadIssueForRefundRecovery>>;

type ResolveIssueRefundSnapshotInput = {
  refundAmountMinor?: number | null;
  refundMethod?: RefundMethod | null;
  adminNote?: string | null;
  adminId?: string | null;
};

type RecoveryResult = {
  ok: boolean;
  error?: string;
  refundRequestId?: string | null;
  resolvedShopId?: string | null;
  resolvedOrderId?: string | null;
  resolvedAmount?: number | null;
  resolvedPaymentMethod?: RefundMethod | null;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return null;
}

function snapshotValue(snapshot: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = snapshot;
    for (const key of path) current = jsonObject(current)[key];
    const found = firstString(current);
    if (found) return found;
  }
  return null;
}

async function loadIssueForRefundRecovery(issueId: string) {
  return prisma.orderActionRequest.findFirst({
    where: { id: issueId, requestType: "ISSUE" },
    include: {
      items: { take: 1, orderBy: { createdAt: "asc" } },
      customerProfile: { select: { id: true, shopId: true } },
      megaskaOrder: true,
      refundRequests: { where: { source: "ISSUE_REQUEST" }, take: 1 },
    },
  });
}

async function findDashboardOrder(issue: NonNullable<IssueForRefundRecovery>, shopId: string | null) {
  if (!shopId) return null;
  const candidates = [
    ...(issue.shopifyOrderId ? [{ shopifyOrderId: issue.shopifyOrderId }] : []),
    { shopifyOrderName: issue.orderNumber },
    { shopifyOrderName: issue.orderNumber.startsWith("#") ? issue.orderNumber : `#${issue.orderNumber}` },
  ];
  return prisma.gstOrderImport.findFirst({
    where: { shopId, OR: candidates },
    orderBy: { orderCreatedAt: "desc" },
  });
}

export async function resolveIssueRefundSnapshot(issueId: string, input: ResolveIssueRefundSnapshotInput = {}): Promise<RecoveryResult> {
  const issue = await loadIssueForRefundRecovery(issueId);
  if (!issue) return { ok: false, error: "Issue request not found." };

  if (issue.refundRequests[0]) {
    const refund = issue.refundRequests[0];
    return {
      ok: true,
      refundRequestId: refund.id,
      resolvedShopId: refund.shopId || issue.shopId || null,
      resolvedOrderId: refund.shopifyOrderId || issue.shopifyOrderId || null,
      resolvedAmount: refund.amount,
      resolvedPaymentMethod: refund.method,
    };
  }

  const itemSnapshot = jsonObject(issue.items[0]?.eligibilitySnapshot);
  const resolvedShopId = firstString(issue.shopId, issue.customerProfile?.shopId, issue.megaskaOrder?.shopId);
  if (!resolvedShopId) return logSkip(issue.id, { error: SHOP_CONTEXT_ERROR });
  if (!issue.customerProfileId) return logSkip(issue.id, { resolvedShopId, error: "Cannot approve for refund because customer profile is missing." });

  const dashboardOrder = await findDashboardOrder(issue, resolvedShopId);
  const dashboardSnapshot = dashboardOrder?.snapshot ?? null;
  const resolvedOrderId = firstString(issue.shopifyOrderId, issue.megaskaOrder?.shopifyOrderId, dashboardOrder?.shopifyOrderId);
  const resolvedAmount = input.refundAmountMinor ?? null;
  if (!resolvedAmount) return logSkip(issue.id, { resolvedShopId, resolvedOrderId, error: AMOUNT_ERROR });

  const paymentGatewayName = firstString(
    itemSnapshot.paymentGatewayName,
    snapshotValue(dashboardSnapshot, [["paymentGateway"], ["payment_gateway"], ["order", "paymentGateway"], ["source", "paymentGateway"]])
  );
  const resolvedPaymentMethod = input.refundMethod || (paymentGatewayName ? detectRefundMethodFromGateway(paymentGatewayName) : null);
  if (!resolvedPaymentMethod) {
    return logSkip(issue.id, { resolvedShopId, resolvedOrderId, resolvedAmount, resolvedPaymentMethod, error: PAYMENT_METHOD_ERROR });
  }

  if (!issue.shopId || !issue.shopifyOrderId) {
    await prisma.orderActionRequest.update({
      where: { id: issue.id },
      data: {
        shopId: issue.shopId || resolvedShopId,
        shopifyOrderId: issue.shopifyOrderId || resolvedOrderId,
      },
    });
  }

  const refund = await createRefundRequest({
    shop: { id: resolvedShopId },
    orderId: issue.id,
    amount: resolvedAmount,
    reason: input.adminNote || issue.adminNote || "Issue approved",
    adminNote: input.adminNote || issue.adminNote || null,
    source: "ISSUE_REQUEST",
    sourceId: issue.id,
    customer: { id: issue.customerProfileId },
    method: resolvedPaymentMethod,
    createdBy: { type: "ADMIN", id: input.adminId },
  });

  console.info("[ISSUE REFUND RECOVERY] resolved", { issueId: issue.id, resolvedShopId, resolvedOrderId, resolvedAmount, resolvedPaymentMethod, refundRequestId: refund.id, walletTransactionId: refund.walletTransactionId || null });
  return { ok: true, refundRequestId: refund.id, resolvedShopId, resolvedOrderId, resolvedAmount, resolvedPaymentMethod };
}

function logSkip(issueId: string, input: Omit<RecoveryResult, "ok">): RecoveryResult {
  console.warn("[ISSUE REFUND RECOVERY] skip", { issueId, resolvedShopId: input.resolvedShopId || null, resolvedOrderId: input.resolvedOrderId || null, resolvedAmount: input.resolvedAmount || null, resolvedPaymentMethod: input.resolvedPaymentMethod || null, refundRequestId: input.refundRequestId || null, walletTransactionId: null, skipReason: input.error });
  return { ok: false, ...input };
}

export const ISSUE_REFUND_RECOVERY_ERRORS = { SHOP_CONTEXT_ERROR, AMOUNT_ERROR, PAYMENT_METHOD_ERROR };
