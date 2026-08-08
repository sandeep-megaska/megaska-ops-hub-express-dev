import { prisma } from "../db/prisma";
import { createRefundRequest } from "../refund-request";
import { cancelShopifyOrder } from "../shopify/admin";
import { getLoopDeskMerchantSettings } from "../loopdesk/merchant-settings";

export interface AutoCancelResult {
  ok: boolean;
  /** Machine-readable outcome/skip reason for logging. */
  reason?: string;
  refundType?: "PREPAID" | "COD" | "NO_REFUND";
  jobId?: string | null;
}

function detectPaymentMethod(paymentGatewayName: string | null | undefined): "COD" | "PREPAID" {
  const normalized = String(paymentGatewayName || "").trim().toLowerCase();
  if (normalized === "cod" || normalized === "cash on delivery" || normalized.includes("cash on delivery")) {
    return "COD";
  }
  return "PREPAID";
}

function extractGatewayName(eligibilitySnapshot: unknown): string {
  if (
    eligibilitySnapshot &&
    typeof eligibilitySnapshot === "object" &&
    "paymentGatewayName" in eligibilitySnapshot
  ) {
    return String((eligibilitySnapshot as { paymentGatewayName?: unknown }).paymentGatewayName || "");
  }
  return "";
}

/**
 * Best-effort, NON-THROWING automatic Shopify order cancellation for a
 * customer-raised CANCELLATION request on an order that is still unfulfilled.
 *
 * This mirrors the manual admin approval route
 * (app/api/admin/cancellation-requests/[id]/status/route.ts) — same prepaid/COD
 * detection, same RefundRequest record — but additionally performs the real
 * Shopify `orderCancel` (restock + native refund to source for prepaid), which
 * the manual flow does not. It is gated by the merchant setting
 * `cancellation.autoCancelUnfulfilledOnRequest` and is safe to call
 * fire-and-forget from the customer submission route: it never throws, and on
 * any Shopify user-error it leaves the request at OPEN so the admin manual flow
 * remains the fallback (no regression versus today's manual-only behaviour).
 *
 * Idempotent: only an OPEN request is acted on, and Shopify itself rejects a
 * second cancel of an already-cancelled order (surfaced as a user-error, which
 * leaves the request OPEN rather than double-recording).
 */
export async function autoCancelUnfulfilledCancellationRequest(
  requestId: string,
): Promise<AutoCancelResult> {
  try {
    const request = await prisma.orderActionRequest.findFirst({
      where: { id: requestId, requestType: "CANCELLATION" },
      include: {
        items: { take: 1, orderBy: { createdAt: "asc" }, select: { eligibilitySnapshot: true } },
      },
    });

    if (!request) return { ok: false, reason: "request-not-found" };
    if (!request.shopId) return { ok: false, reason: "no-shop" };
    // Only an OPEN, still-eligible request is auto-cancellable. The submission
    // route sets eligibilityDecision only after its trusted (server-side)
    // unfulfilled check passes, so this is the fulfilled/shipped guard too.
    if (request.status !== "OPEN") return { ok: false, reason: `ineligible-status:${request.status}` };
    if (request.eligibilityDecision !== "ELIGIBLE") return { ok: false, reason: "not-eligible" };
    // Without a Shopify order id we cannot perform the native cancel; leave it
    // for the admin manual flow.
    if (!request.shopifyOrderId) return { ok: false, reason: "no-shopify-order-id" };

    const settings = await getLoopDeskMerchantSettings(request.shopId).catch(() => null);
    if (!settings?.cancellation?.autoCancelUnfulfilledOnRequest) {
      return { ok: false, reason: "auto-cancel-disabled" };
    }

    // Prepaid vs COD determines whether Shopify should refund. An unfulfilled COD
    // order has no captured payment, so there is nothing to refund (refund:false);
    // a prepaid order is refunded to the original payment source (refund:true).
    const method = detectPaymentMethod(extractGatewayName(request.items[0]?.eligibilitySnapshot));
    const refundAmountMinor = Number(request.orderAmountSnapshot || 0);
    const hasValidAmount = Number.isFinite(refundAmountMinor) && refundAmountMinor > 0;
    const refundType: "PREPAID" | "COD" | "NO_REFUND" =
      method === "PREPAID" && hasValidAmount ? "PREPAID" : method === "COD" ? "NO_REFUND" : "NO_REFUND";
    const shopifyRefund = method === "PREPAID";

    // Resolve the shop's Shopify domain so the admin GraphQL call targets the
    // correct tenant.
    const shop = await prisma.shop.findUnique({
      where: { id: request.shopId },
      select: { shopDomain: true, myshopifyDomain: true },
    });
    const shopDomain = shop?.shopDomain || shop?.myshopifyDomain || null;

    // Shopify cancel happens OUTSIDE any DB transaction so a slow/failed call
    // never holds a transaction open.
    let cancel;
    try {
      cancel = await cancelShopifyOrder(
        request.shopifyOrderId,
        {
          reason: "CUSTOMER",
          refund: shopifyRefund,
          restock: true,
          notifyCustomer: true,
          staffNote: `Auto-cancelled on customer request (order ${request.orderNumber}).`,
        },
        { shopDomain },
      );
    } catch (error) {
      return { ok: false, reason: `shopify-cancel-threw:${error instanceof Error ? error.message : "error"}` };
    }

    if (cancel.userErrors.length > 0) {
      // Validation failure (already cancelled, not cancellable, etc.) — leave the
      // request OPEN for the admin manual flow.
      return { ok: false, reason: `shopify-user-error:${cancel.userErrors[0]?.message || "unknown"}` };
    }

    // Record the refund for dashboard visibility. Prepaid was refunded natively by
    // Shopify to source, so mark it PAID; COD/no-amount needs no refund.
    // createRefundRequest is idempotent on (shop, source, sourceId) and must not
    // fail the overall cancel if the ledger row already exists.
    try {
      await createRefundRequest({
        shop: { id: request.shopId },
        orderId: request.id,
        amount: hasValidAmount ? Math.trunc(refundAmountMinor) : 1,
        reason: "Auto-cancelled on customer request",
        adminNote: shopifyRefund
          ? "Refunded to original payment source via Shopify order cancel."
          : "No refund required (COD, no captured payment).",
        source: "CANCELLATION_REQUEST",
        sourceId: request.id,
        customer: { id: request.customerProfileId },
        method: refundType === "NO_REFUND" ? "PREPAID" : refundType,
        status: refundType === "PREPAID" ? "PAID" : "NOT_REQUIRED",
        createdBy: { type: "SYSTEM", id: null },
      });
    } catch (error) {
      console.warn("[AUTO CANCEL] refund record skipped", {
        requestId: request.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    // OPEN → CLOSED is a valid transition (CANCELLATION_ALLOWED_STATUS_TRANSITIONS).
    const note = `Auto-cancelled in Shopify on customer request (refund: ${
      shopifyRefund ? "to source" : "none"
    }, restock: yes${cancel.jobId ? `, job: ${cancel.jobId}` : ""}).`;
    await prisma.orderActionRequest.update({
      where: { id: request.id },
      data: {
        status: "CLOSED",
        adminNote: [request.adminNote, note].filter(Boolean).join("\n") || null,
      },
    });

    return { ok: true, reason: "cancelled", refundType, jobId: cancel.jobId };
  } catch (error) {
    // Never throw: the request stays OPEN and the admin manual flow is the fallback.
    return { ok: false, reason: `unexpected:${error instanceof Error ? error.message : "error"}` };
  }
}
