// Reverse pickups the team arranges by hand (admin only):
//
// A. An exchange whose reverse-pickup fee was paid outside loopd2c's own payment
//    link (the link expired and the team sent one from the Razorpay dashboard,
//    which the webhook can't recognise), or that the team waives: record the
//    fee, then book the Delhivery pickup as a link payment would.
// B. A pickup for any order (wrong or damaged item, a late delivery the
//    customer wasn't there for, anything else): the team picks the items and
//    the reason, may edit the pickup address, and it is booked on Delhivery. It
//    attaches to the order's open issue request, or creates one marked as
//    created by the team, so tracking and the inspection / refund steps follow.
//
// Both book through bookReversePickup: one Delhivery reverse pickup per request
// (idempotent), the 7-day window enforced unless the team books anyway with a
// reason, and every step audited.

import { prisma } from "../db/prisma";
import { OFF_SHOPIFY_PAYMENTS_UNAVAILABLE, offShopifyPaymentsEnabled } from "../platform/off-shopify-payments.ts";
import { REVERSE_PICKUP_WINDOW_LOCK_REASON, isWithinReversePickupWindow } from "./deadlines";
import { canTransitionExchangeStatus } from "./lifecycle";
import { REVERSE_PICKUP_FEE_PAISE } from "./constants";
import { resolveExchangeShippingAddress } from "./pickup-address";
import { cancelRazorpayPaymentLink, fetchRazorpayPayment } from "./razorpay";
import { createDelhiveryReversePickup, DelhiveryReversePickupError } from "../logistics/delhivery-reverse-pickup";
import { resolveDelhiveryRuntimeConfig } from "../logistics/delhivery-runtime";
import { notifyExchangeMilestone } from "../notifications/exchange-milestones";
import { getSingleShopifyOrderByGid } from "../gst/shopify-runtime-admin";
import {
  MANUAL_PICKUP_REASONS,
  RAZORPAY_PAYMENT_ID,
  checkFeePayment,
  mergePickupAddress,
  normalizeOrderNumber,
  pickShopifyOrderByName,
  shopifyOrderNameQuery,
  statusAfterPickupBooked,
  type ManualPickupReason,
  type PickupAddress,
  type PickupRequestType,
} from "./manual-reverse-pickup-rules";

export class ManualPickupError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ManualPickupError";
  }
}

const OPEN_STATUSES_EXCLUDED = ["CLOSED", "REJECTED"];
// Exchange states from which the fee can still be settled and the pickup booked
// (an OPEN exchange isn't approved yet: approve it first).
const FEE_SETTLEABLE_EXCHANGE_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_RECEIVED", "APPROVED", "PICKUP_PENDING"];

type BookInput = {
  shopId: string;
  requestId: string;
  address?: Partial<PickupAddress> | null;
  allowOutsideWindow?: boolean;
  outsideWindowNote?: string | null;
  trigger: string;
};

async function loadPickupRequest(shopId: string, requestId: string) {
  const request = await prisma.orderActionRequest.findFirst({
    where: { id: requestId, shopId, requestType: { in: ["EXCHANGE", "ISSUE"] } },
    include: { customerProfile: true, items: true, shipments: true, payments: { where: { purpose: "REVERSE_PICKUP_FEE" }, orderBy: { createdAt: "desc" } } },
  });
  if (!request) throw new ManualPickupError("Request not found.", 404);
  return request;
}

/** Books the Delhivery reverse pickup for an exchange or issue request. */
export async function bookReversePickup(input: BookInput) {
  const request = await loadPickupRequest(input.shopId, input.requestId);
  const requestType = request.requestType as PickupRequestType;

  // Already booked: an AWB, or a Delhivery booking still waiting for its AWB (the
  // paid-link placeholder has no carrier). A failed pickup can be booked again.
  const existing = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
  if (existing && existing.status !== "FAILED" && (existing.awb || existing.carrier === "DELHIVERY")) {
    return { idempotent: true, shipment: existing, status: request.status, requestId: request.id };
  }

  if (!isWithinReversePickupWindow(request.deliveryDateSnapshot)) {
    if (!input.allowOutsideWindow) {
      throw new ManualPickupError(
        request.deliveryDateSnapshot
          ? `${REVERSE_PICKUP_WINDOW_LOCK_REASON} Tick "Book anyway" and give the reason to book it.`
          : `This order has no delivery date. Tick "Book anyway" and give the reason to book it.`,
        409,
        "OUTSIDE_WINDOW",
      );
    }
    if (!String(input.outsideWindowNote || "").trim()) {
      throw new ManualPickupError("Say why the pickup is booked outside the 7-day window.", 400, "OUTSIDE_WINDOW_NOTE_REQUIRED");
    }
  }

  const runtime = await resolveDelhiveryRuntimeConfig(request.shopId);
  if (!runtime.configured) throw new ManualPickupError(`Delhivery is not set up: ${runtime.reason}`, 503);

  const resolved = await resolveExchangeShippingAddress(request);
  const address = mergePickupAddress(resolved, input.address);
  if (!address) throw new ManualPickupError("Could not find a pickup address for this order. Enter it below.", 400, "NO_ADDRESS");

  let delhivery;
  try {
    delhivery = await createDelhiveryReversePickup(request, runtime, address);
  } catch (error) {
    if (error instanceof DelhiveryReversePickupError) throw new ManualPickupError(error.message, error.statusCode, "DELHIVERY");
    throw error;
  }

  const nextStatus = statusAfterPickupBooked(requestType, request.status);
  const remarks = delhivery.providerReference ? `Delhivery reference: ${delhivery.providerReference}` : "Created via Delhivery API (arranged by the team)";

  const shipment = await prisma.$transaction(async (tx) => {
    const upserted = await tx.shipmentTracking.upsert({
      where: { requestId_direction: { requestId: request.id, direction: "REVERSE_PICKUP" } },
      create: { requestId: request.id, direction: "REVERSE_PICKUP", carrier: "DELHIVERY", awb: delhivery.awb, trackingUrl: delhivery.trackingUrl, status: delhivery.status, remarks },
      update: { carrier: "DELHIVERY", awb: delhivery.awb, trackingUrl: delhivery.trackingUrl, status: delhivery.status, remarks },
    });
    if (nextStatus !== request.status) {
      await tx.orderActionRequest.update({ where: { id: request.id }, data: { status: nextStatus as never } });
    }
    await tx.auditEvent.create({
      data: {
        actorType: "admin",
        eventType: "reverse_pickup.manual_booked",
        entityType: "OrderActionRequest",
        entityId: request.id,
        payload: {
          shopId: request.shopId,
          requestType,
          trigger: input.trigger,
          shipmentId: upserted.id,
          awb: upserted.awb,
          providerReference: delhivery.providerReference,
          previousStatus: request.status,
          nextStatus,
          addressSource: address.source,
          addressEdited: address.edited,
          outsideWindow: !isWithinReversePickupWindow(request.deliveryDateSnapshot),
          outsideWindowNote: input.outsideWindowNote || null,
        } as never,
      },
    });
    return upserted;
  });

  // Exchange customers get the usual "pickup scheduled" message; issues (and team-created
  // returns) get the issue pickup message with the AWB (request updates switch).
  if (requestType === "EXCHANGE" && nextStatus !== request.status) {
    await notifyExchangeMilestone(request.id, nextStatus).catch((error) =>
      console.error("[MANUAL REVERSE PICKUP] milestone_notify_failed", { requestId: request.id, error: error instanceof Error ? error.message : String(error) }));
  }
  if (requestType === "ISSUE") {
    const { notifyIssuePickupScheduled } = await import("../notifications/request-updates");
    await notifyIssuePickupScheduled(request.id, shipment.awb ?? null);
  }

  return { idempotent: false, shipment, status: nextStatus, requestId: request.id };
}

/** Verifies a Razorpay payment ID against the fee; it must not settle another request already. */
async function verifyFeePayment(shopId: string, paymentId: string, feePaise: number, requestId?: string) {
  // A Razorpay payment taken outside Shopify Checkout: not used by the public app.
  if (!offShopifyPaymentsEnabled()) throw new ManualPickupError(OFF_SHOPIFY_PAYMENTS_UNAVAILABLE, 400);
  const id = paymentId.trim();
  if (!RAZORPAY_PAYMENT_ID.test(id)) throw new ManualPickupError("Enter the Razorpay payment ID, which starts with pay_ (Razorpay → Payments).", 400, "INVALID_PAYMENT_ID");
  const used = await prisma.requestPayment.findFirst({ where: { paymentId: id, ...(requestId ? { requestId: { not: requestId } } : {}) }, select: { requestId: true } });
  if (used) throw new ManualPickupError("This payment is already recorded on another request.", 409, "PAYMENT_ALREADY_USED", { requestId: used.requestId });
  let payment: Record<string, unknown> | null;
  try {
    payment = await fetchRazorpayPayment(shopId, id);
  } catch (error) {
    throw new ManualPickupError(error instanceof Error ? error.message : "Could not check the payment with Razorpay.", 502, "RAZORPAY");
  }
  const check = checkFeePayment(payment, feePaise);
  if (!check.ok) throw new ManualPickupError(check.error, 400, "PAYMENT_NOT_VALID");
  return { paymentId: id, amountPaise: check.amountPaise, paidAt: check.paidAt ?? new Date() };
}

export type FeeSettlement = { mode: "PAYMENT_ID"; paymentId: string } | { mode: "WAIVE"; note: string };

/** A. Records the exchange's fee (paid outside the link, or waived), then books the pickup. */
export async function settleExchangeFeeAndBookPickup(input: {
  shopId: string;
  requestId: string;
  fee: FeeSettlement;
  address?: Partial<PickupAddress> | null;
  allowOutsideWindow?: boolean;
  outsideWindowNote?: string | null;
}) {
  const request = await loadPickupRequest(input.shopId, input.requestId);
  if (request.requestType !== "EXCHANGE") throw new ManualPickupError("Only exchange requests have a pickup fee.", 400);
  if (!FEE_SETTLEABLE_EXCHANGE_STATUSES.includes(request.status)) {
    throw new ManualPickupError(`This exchange is at ${request.status}, past the reverse-pickup step.`, 409, "STATUS_NOT_ELIGIBLE");
  }

  const latest = request.payments[0] || null;
  let feeOutcome: "ALREADY_PAID" | "RECORDED" | "WAIVED" = "ALREADY_PAID";

  if (latest?.status !== "PAID") {
    // The old loopd2c link may still be live: cancel it so the fee isn't paid twice
    // (its later payment would also overwrite the one recorded here).
    const cancelOldLink = async () => {
      if (latest?.status === "PENDING" && latest.paymentLinkId) await cancelRazorpayPaymentLink(request.shopId!, latest.paymentLinkId);
    };
    if (input.fee.mode === "PAYMENT_ID") {
      const verified = await verifyFeePayment(request.shopId!, input.fee.paymentId, latest?.amount || REVERSE_PICKUP_FEE_PAISE, request.id);
      await cancelOldLink();
      await prisma.$transaction(async (tx) => {
        if (latest) {
          await tx.requestPayment.update({ where: { id: latest.id }, data: { status: "PAID", paymentId: verified.paymentId, paidAt: verified.paidAt, providerReferenceId: "manual:razorpay-dashboard" } });
        } else {
          await tx.requestPayment.create({ data: { requestId: request.id, purpose: "REVERSE_PICKUP_FEE", amount: verified.amountPaise, status: "PAID", paymentId: verified.paymentId, paidAt: verified.paidAt, providerReferenceId: "manual:razorpay-dashboard" } });
        }
        await tx.auditEvent.create({ data: { actorType: "admin", eventType: "exchange.reverse_pickup_fee.recorded_manually", entityType: "OrderActionRequest", entityId: request.id, payload: { shopId: request.shopId, paymentId: verified.paymentId, amountPaise: verified.amountPaise, replacedPaymentStatus: latest?.status ?? null } as never } });
      });
      feeOutcome = "RECORDED";
    } else {
      const note = String(input.fee.note || "").trim();
      if (!note) throw new ManualPickupError("Say why the fee is waived.", 400, "WAIVE_NOTE_REQUIRED");
      await cancelOldLink();
      await prisma.$transaction(async (tx) => {
        if (latest && latest.status !== "CANCELLED") await tx.requestPayment.update({ where: { id: latest.id }, data: { status: "CANCELLED", providerReferenceId: "waived" } });
        await tx.auditEvent.create({ data: { actorType: "admin", eventType: "exchange.reverse_pickup_fee.waived", entityType: "OrderActionRequest", entityId: request.id, payload: { shopId: request.shopId, note, replacedPaymentStatus: latest?.status ?? null } as never } });
      });
      feeOutcome = "WAIVED";
    }

    // Same step the webhook takes on a paid link: approved, fee received.
    const nextStatus = canTransitionExchangeStatus(request.status, "PAYMENT_RECEIVED") ? "PAYMENT_RECEIVED" : request.status;
    if (nextStatus !== request.status) {
      await prisma.orderActionRequest.update({ where: { id: request.id }, data: { status: nextStatus as never } });
    }
    if (feeOutcome === "RECORDED" && nextStatus === "PAYMENT_RECEIVED") {
      await notifyExchangeMilestone(request.id, "PAYMENT_RECEIVED").catch(() => undefined);
    }
  }

  try {
    const booking = await bookReversePickup({ shopId: input.shopId, requestId: request.id, address: input.address, allowOutsideWindow: input.allowOutsideWindow, outsideWindowNote: input.outsideWindowNote, trigger: `exchange_fee_${feeOutcome.toLowerCase()}` });
    return { feeOutcome, booking, bookingError: null };
  } catch (error) {
    // The fee stays recorded; booking can be retried from the same panel.
    if (error instanceof ManualPickupError) return { feeOutcome, booking: null, bookingError: { message: error.message, code: error.code ?? null } };
    throw error;
  }
}

type OrderLine = { shopifyLineItemId: string; title: string; variantTitle: string | null; sku: string | null; quantity: number };

function linesFrom(value: unknown): OrderLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const id = String(line.shopifyLineItemId ?? line.id ?? "").trim();
      return { shopifyLineItemId: id, title: String(line.title || "Item"), variantTitle: line.variantTitle ? String(line.variantTitle) : null, sku: line.sku ? String(line.sku) : null, quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)) };
    })
    .filter((line) => line.shopifyLineItemId && line.quantity > 0);
}

// Copies one Shopify order into LoopD2C's order list (no delivery event, review schedule or
// message: see syncCanonicalShopifyOrder). Returns false when Shopify has no such order.
async function importOrderFromShopify(shopId: string, orderNumber: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true } });
  if (!shop?.shopDomain) return false;
  const { adminGraphql } = await import("../shopify/admin");
  const data = await adminGraphql<{ orders?: { nodes?: Array<{ id?: string | null; name?: string | null }> } }>(
    `query LoopD2CReversePickupOrder($query: String!) { orders(first: 5, query: $query) { nodes { id name } } }`,
    { query: shopifyOrderNameQuery(orderNumber) },
    { shopDomain: shop.shopDomain, preferStoredToken: true },
  ).catch(() => null);
  const match = pickShopifyOrderByName(data?.orders?.nodes, orderNumber);
  if (!match?.id) return false;
  const { syncCanonicalShopifyOrder, CanonicalShopifyOrderSyncError } = await import("../orders/shopify-order-sync");
  try {
    await syncCanonicalShopifyOrder({ shopId, shopDomain: shop.shopDomain, orderIdentifier: match.id });
    return true;
  } catch (error) {
    if (error instanceof CanonicalShopifyOrderSyncError && error.code === "SHOPIFY_CUSTOMER_REQUIRED") {
      throw new ManualPickupError(`Order ${orderNumber} has no customer in Shopify, so a pickup can't be arranged from it. Add the customer to the order in Shopify, then try again.`, 422, "ORDER_WITHOUT_CUSTOMER");
    }
    if (error instanceof CanonicalShopifyOrderSyncError && error.code === "IDENTITY_CONFLICT") {
      throw new ManualPickupError(`Order ${orderNumber}'s customer matches more than one customer in LoopD2C. Check the customer's phone and email in Shopify, then try again.`, 409, "ORDER_IDENTITY_CONFLICT");
    }
    throw error;
  }
}

/** Everything the "Arrange reverse pickup" form needs for one order. */
export async function lookupOrderForReversePickup(shopId: string, orderNumberRaw: string) {
  const orderNumber = normalizeOrderNumber(orderNumberRaw);
  if (!orderNumber) throw new ManualPickupError("Enter an order number.", 400);
  const findOrder = () => prisma.megaskaOrder.findFirst({ where: { shopId, shopifyOrderName: orderNumber }, include: { customerProfile: true, shop: { select: { shopDomain: true } } } });
  // LoopD2C only keeps a copy of orders it has worked with (delivered orders for reviews,
  // exchanges): anything else, such as an exchange replacement order, is fetched from Shopify once.
  const order = (await findOrder()) ?? ((await importOrderFromShopify(shopId, orderNumber)) ? await findOrder() : null);
  if (!order) throw new ManualPickupError(`No order ${orderNumber} found in Shopify.`, 404, "ORDER_NOT_FOUND");

  let lines: OrderLine[] = [];
  let paymentGateway: string | null = null;
  if (order.shopifyOrderId) {
    try {
      const live = await getSingleShopifyOrderByGid({ shopifyOrderGid: order.shopifyOrderId, shopDomain: order.shop.shopDomain });
      lines = linesFrom(live?.lines);
      paymentGateway = (live as { paymentGateway?: string | null } | null)?.paymentGateway ?? null;
    } catch {
      // fall back to the GST import copy below
    }
    if (!lines.length) {
      const imported = await prisma.gstOrderImport.findFirst({ where: { shopId, shopifyOrderId: order.shopifyOrderId }, select: { snapshot: true } });
      const snapshot = (imported?.snapshot && typeof imported.snapshot === "object" ? imported.snapshot : {}) as Record<string, unknown>;
      lines = linesFrom(snapshot.lines);
      paymentGateway = paymentGateway ?? (typeof snapshot.paymentGateway === "string" ? snapshot.paymentGateway : null);
    }
  }

  const openRequests = await prisma.orderActionRequest.findMany({
    where: { shopId, requestType: { in: ["EXCHANGE", "ISSUE"] }, status: { notIn: OPEN_STATUSES_EXCLUDED as never }, OR: [{ megaskaOrderId: order.id }, { orderNumber }] },
    include: { shipments: { where: { direction: "REVERSE_PICKUP" } } },
    orderBy: { requestedAt: "desc" },
  });

  const profile = order.customerProfile;
  const address = await resolveExchangeShippingAddress({
    shopId,
    shopifyOrderId: order.shopifyOrderId,
    orderNumber,
    customerNameSnapshot: profile.fullName,
    customerPhoneSnapshot: profile.phoneE164,
    customerEmailSnapshot: profile.email,
    customerProfile: profile,
  });

  return {
    order: { id: order.id, orderNumber, shopifyOrderId: order.shopifyOrderId, status: order.status, deliveredAt: order.deliveredAt, withinWindow: isWithinReversePickupWindow(order.deliveredAt), paymentGateway },
    customer: { id: profile.id, name: profile.fullName, phone: profile.phoneE164, email: profile.email, shopifyCustomerId: profile.shopifyCustomerId },
    lines,
    address,
    openRequests: openRequests.map((request) => ({ id: request.id, requestType: request.requestType, status: request.status, reverseAwb: request.shipments[0]?.awb ?? null })),
  };
}

/** B. Arranges a reverse pickup for an order, on its open issue or a new team-created one. */
export async function arrangeReversePickupForOrder(input: {
  shopId: string;
  orderNumber: string;
  lines: Array<{ shopifyLineItemId: string; quantity: number }>;
  reason: ManualPickupReason;
  note?: string | null;
  fee: { mode: "WAIVE" } | { mode: "PAYMENT_ID"; paymentId: string };
  address?: Partial<PickupAddress> | null;
  allowOutsideWindow?: boolean;
  outsideWindowNote?: string | null;
}) {
  const found = await lookupOrderForReversePickup(input.shopId, input.orderNumber);
  const openExchange = found.openRequests.find((request) => request.requestType === "EXCHANGE");
  if (openExchange) {
    throw new ManualPickupError("This order has an open exchange. Record the fee or book the pickup on that exchange instead.", 409, "OPEN_EXCHANGE", { requestId: openExchange.id });
  }
  const openIssue = found.openRequests.find((request) => request.requestType === "ISSUE") || null;
  if (openIssue?.reverseAwb) {
    throw new ManualPickupError(`A reverse pickup is already booked for this order (AWB ${openIssue.reverseAwb}).`, 409, "ALREADY_BOOKED", { requestId: openIssue.id });
  }

  const byId = new Map(found.lines.map((line) => [line.shopifyLineItemId, line]));
  const chosen = input.lines
    .map((pick) => ({ line: byId.get(String(pick.shopifyLineItemId)), quantity: Math.floor(Number(pick.quantity) || 0) }))
    .filter((pick): pick is { line: OrderLine; quantity: number } => Boolean(pick.line) && pick.quantity > 0);
  if (!openIssue && !chosen.length) throw new ManualPickupError("Choose at least one item to pick up.", 400, "NO_ITEMS");
  for (const pick of chosen) {
    if (pick.quantity > pick.line.quantity) throw new ManualPickupError(`Only ${pick.line.quantity} of "${pick.line.title}" were ordered.`, 400, "QUANTITY");
  }

  // Verify the payment before writing anything. A retry after a failed booking
  // may send the same payment ID that is already recorded on this issue.
  const alreadyOnIssue = input.fee.mode === "PAYMENT_ID" && openIssue
    ? await prisma.requestPayment.findFirst({ where: { requestId: openIssue.id, paymentId: input.fee.paymentId.trim(), status: "PAID" }, select: { id: true } })
    : null;
  const verified = input.fee.mode === "PAYMENT_ID" && !alreadyOnIssue ? await verifyFeePayment(input.shopId, input.fee.paymentId, REVERSE_PICKUP_FEE_PAISE) : null;

  const reasonLabel = MANUAL_PICKUP_REASONS[input.reason];
  const note = String(input.note || "").trim();
  const teamNote = `Reverse pickup arranged by the team: ${reasonLabel}${note ? `. ${note}` : ""}${input.fee.mode === "WAIVE" ? " (pickup fee: paid by the store)" : ""}`;

  const requestId = await prisma.$transaction(async (tx) => {
    let id = openIssue?.id ?? null;
    if (!id) {
      const created = await tx.orderActionRequest.create({
        data: {
          shopId: input.shopId,
          requestType: "ISSUE",
          customerProfileId: found.customer.id,
          shopifyCustomerId: found.customer.shopifyCustomerId,
          shopifyOrderId: found.order.shopifyOrderId,
          orderNumber: found.order.orderNumber,
          megaskaOrderId: found.order.id,
          status: "OPEN",
          reason: reasonLabel,
          adminNote: teamNote,
          customerNameSnapshot: found.address?.name || found.customer.name,
          customerPhoneSnapshot: found.address?.phone || found.customer.phone,
          customerEmailSnapshot: found.address?.email || found.customer.email,
          deliveryDateSnapshot: found.order.deliveredAt,
          eligibilityDecision: "TEAM_CREATED",
          eligibilityReason: input.reason,
          items: {
            create: chosen.map((pick) => ({
              shopifyLineItemId: pick.line.shopifyLineItemId,
              productTitle: pick.line.title,
              variantTitle: pick.line.variantTitle,
              sku: pick.line.sku,
              currentSize: pick.line.variantTitle,
              requestedSize: "",
              quantity: pick.quantity,
              eligibilitySnapshot: { createdBy: "team", reason: input.reason, paymentGatewayName: found.order.paymentGateway } as never,
            })),
          },
        },
      });
      id = created.id;
    } else {
      await tx.orderActionRequest.update({ where: { id }, data: { adminNote: teamNote } });
    }
    if (verified) {
      await tx.requestPayment.create({ data: { requestId: id, purpose: "REVERSE_PICKUP_FEE", amount: verified.amountPaise, status: "PAID", paymentId: verified.paymentId, paidAt: verified.paidAt, providerReferenceId: "manual:razorpay-dashboard" } });
    }
    await tx.auditEvent.create({
      data: { actorType: "admin", eventType: openIssue ? "reverse_pickup.arranged_on_issue" : "reverse_pickup.issue_created_by_team", entityType: "OrderActionRequest", entityId: id, payload: { shopId: input.shopId, orderNumber: found.order.orderNumber, reason: input.reason, note: note || null, fee: input.fee.mode, paymentId: verified?.paymentId ?? null, items: chosen.map((pick) => ({ shopifyLineItemId: pick.line.shopifyLineItemId, quantity: pick.quantity })) } as never },
    });
    return id;
  });

  try {
    const booking = await bookReversePickup({ shopId: input.shopId, requestId, address: input.address, allowOutsideWindow: input.allowOutsideWindow, outsideWindowNote: input.outsideWindowNote, trigger: `arranged_${input.reason.toLowerCase()}` });
    return { requestId, createdIssue: !openIssue, booking, bookingError: null };
  } catch (error) {
    // The issue is saved; running the form again for this order retries the booking on it.
    if (error instanceof ManualPickupError) return { requestId, createdIssue: !openIssue, booking: null, bookingError: { message: error.message, code: error.code ?? null } };
    throw error;
  }
}
