import { prisma } from "../db/prisma";
import { canTransitionExchangeStatus } from "./lifecycle";
import { isWithinReversePickupWindow } from "./deadlines";
import {
  createDelhiveryReversePickup,
  DelhiveryReversePickupError,
} from "../logistics/delhivery-reverse-pickup";
import { notifyExchangeMilestone } from "../notifications/exchange-milestones";

// Same eligibility gate the manual admin route uses
// (app/api/admin/exchange-requests/[id]/delhivery/reverse-pickup/route.ts).
const ELIGIBLE_STATUSES = ["PAYMENT_RECEIVED", "APPROVED", "PICKUP_PENDING"];

export interface AutoReversePickupResult {
  ok: boolean;
  /** Machine-readable outcome/skip reason for logging. */
  reason?: string;
  shipmentId?: string;
  awb?: string | null;
  status?: string;
}

/**
 * Best-effort, NON-THROWING automatic Delhivery reverse-pickup creation for a
 * paid exchange request.
 *
 * This mirrors the manual admin route exactly (same guards, same shipment write,
 * same status transition) but is safe to call fire-and-forget from the Razorpay
 * webhook: it never throws, and any failure simply leaves the request at
 * PAYMENT_RECEIVED with its PENDING placeholder ShipmentTracking row — so the
 * admin "Create reverse pickup" button remains the fallback and there is no
 * regression versus today's manual-only flow.
 *
 * Idempotent: if a REVERSE_PICKUP shipment already has an AWB it returns ok
 * without calling Delhivery again (Razorpay retries webhooks, so this matters).
 */
export async function autoCreateReversePickupForRequest(
  requestId: string,
): Promise<AutoReversePickupResult> {
  try {
    const request = await prisma.orderActionRequest.findFirst({
      where: { id: requestId, requestType: "EXCHANGE" },
      include: {
        customerProfile: true,
        items: true,
        payments: {
          where: { purpose: "REVERSE_PICKUP_FEE" },
          orderBy: { createdAt: "desc" },
        },
        shipments: true,
      },
    });

    if (!request) return { ok: false, reason: "request-not-found" };

    const latestPayment = request.payments[0] || null;
    if (latestPayment?.status !== "PAID") return { ok: false, reason: "fee-not-paid" };

    if (!ELIGIBLE_STATUSES.includes(request.status)) {
      return { ok: false, reason: `ineligible-status:${request.status}` };
    }

    if (!isWithinReversePickupWindow(request.deliveryDateSnapshot)) {
      return { ok: false, reason: "outside-reverse-pickup-window" };
    }

    // Idempotency: never book a second pickup for the same request.
    const existingReverse =
      request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
    if (existingReverse?.awb) {
      return {
        ok: true,
        reason: "already-created",
        shipmentId: existingReverse.id,
        awb: existingReverse.awb,
        status: request.status,
      };
    }

    // External Delhivery call happens OUTSIDE the transaction (same as the
    // manual route) so a slow/failed courier call never holds a DB transaction.
    const delhiveryResult = await createDelhiveryReversePickup(request);
    const nextStatus = canTransitionExchangeStatus(request.status, "PICKUP_SCHEDULED")
      ? "PICKUP_SCHEDULED"
      : "PICKUP_PENDING";
    const remarks = delhiveryResult.providerReference
      ? `Delhivery reference: ${delhiveryResult.providerReference}`
      : "Created via Delhivery API (auto)";

    const shipment = await prisma.$transaction(async (tx) => {
      const upserted = await tx.shipmentTracking.upsert({
        where: {
          requestId_direction: { requestId: request.id, direction: "REVERSE_PICKUP" },
        },
        create: {
          requestId: request.id,
          direction: "REVERSE_PICKUP",
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          remarks,
        },
        update: {
          carrier: "DELHIVERY",
          awb: delhiveryResult.awb,
          trackingUrl: delhiveryResult.trackingUrl,
          status: delhiveryResult.status,
          remarks,
        },
      });

      await tx.orderActionRequest.update({
        where: { id: request.id },
        data: { status: nextStatus as never },
      });

      await tx.auditEvent.create({
        data: {
          actorType: "system",
          eventType: "exchange.delhivery.reverse_pickup.auto_created",
          entityType: "OrderActionRequest",
          entityId: request.id,
          payload: {
            shopId: request.shopId,
            shipmentId: upserted.id,
            awb: upserted.awb,
            providerReference: delhiveryResult.providerReference,
            trigger: "razorpay_payment_paid",
          } as never,
        },
      });

      return upserted;
    });

    // Notify customer + admin that the pickup is scheduled (idempotent per
    // request+status, so it won't double-fire if tracking sync also reports it).
    await notifyExchangeMilestone(request.id, nextStatus);

    return { ok: true, shipmentId: shipment.id, awb: shipment.awb, status: nextStatus };
  } catch (error) {
    const reason =
      error instanceof DelhiveryReversePickupError
        ? `delhivery-error:${error.message}`
        : error instanceof Error
          ? error.message
          : "unknown-error";
    return { ok: false, reason };
  }
}
