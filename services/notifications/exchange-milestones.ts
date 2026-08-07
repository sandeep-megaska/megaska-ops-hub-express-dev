import { prisma } from "../db/prisma";
import { EXCHANGE_STATUS_DESCRIPTIONS } from "../exchange/lifecycle";
import { sendCustomerEmail, sendOpsAlert } from "./email";
import { sendTemplateMessage } from "../whatsapp";

// Centralized customer + admin notifications for exchange status milestones.
//
// One function — notifyExchangeMilestone(requestId, status) — is called from
// every place an exchange request changes status (tracking sync, auto/manual
// reverse-pickup creation, the Razorpay webhook, and manual admin transitions).
// It is idempotent per (request, status): a marker AuditEvent guarantees each
// milestone notifies at most once no matter how many code paths reach it, so the
// 30-min tracking cron and a manual admin action can never double-notify.
//
// Channels:
//   - Customer email  (Resend, respects the merchant's notification settings)
//   - Customer WhatsApp (Meta Cloud API, pre-approved templates — gated behind
//     EXCHANGE_WHATSAPP_ENABLED and skipped gracefully if not configured)
//   - Admin/ops email (every milestone, so the team has a full audit trail)

interface MilestoneContext {
  requestId: string;
  orderNumber: string;
  status: string;
  statusDescription: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  itemTitle: string | null;
  currentSize: string | null;
  requestedSize: string | null;
  adminNote: string | null;
  reverseAwb: string | null;
  reverseTrackingUrl: string | null;
  forwardAwb: string | null;
  forwardTrackingUrl: string | null;
  adminUrl: string;
}

interface MilestoneDefinition {
  /** Customer-facing email; omit for admin-only milestones. */
  customerEmail?: (ctx: MilestoneContext) => { subject: string; text: string };
  /** WhatsApp template key (→ env WHATSAPP_TEMPLATE_EXCHANGE_<KEY>) + body vars. */
  whatsapp?: { key: string; defaultTemplate: string; variables: (ctx: MilestoneContext) => string[] };
  /** Admin/ops subject — every milestone notifies the team. */
  adminSubject: (ctx: MilestoneContext) => string;
}

function trackLine(label: string, awb: string | null, url: string | null) {
  if (!awb) return "";
  return url ? `\n${label}: ${awb}\nTrack: ${url}` : `\n${label}: ${awb}`;
}

const MILESTONES: Record<string, MilestoneDefinition> = {
  AWAITING_PAYMENT: {
    // Customer email for this milestone is the dedicated payment-link email
    // (sendExchangeApprovedPaymentRequiredEmail); here we only alert the team.
    adminSubject: (c) => `Exchange awaiting payment: #${c.orderNumber}`,
  },
  APPROVED: {
    customerEmail: (c) => ({
      subject: `Your exchange for order #${c.orderNumber} is approved`,
      text: `Hi ${c.customerName || "there"},\n\nYour exchange request for order #${c.orderNumber} has been approved. Please ship the item back to us using the return instructions provided.\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "APPROVED",
      defaultTemplate: "exchange_approved",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Exchange approved: #${c.orderNumber}`,
  },
  PAYMENT_RECEIVED: {
    customerEmail: (c) => ({
      subject: `Payment received for your exchange — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nWe've received your reverse-pickup payment for order #${c.orderNumber}. We're now arranging the pickup of your item and will share tracking details shortly.\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "PAYMENT_RECEIVED",
      defaultTemplate: "exchange_payment_received",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Exchange payment received: #${c.orderNumber}`,
  },
  PICKUP_PENDING: {
    adminSubject: (c) => `Reverse pickup pending: #${c.orderNumber}`,
  },
  PICKUP_SCHEDULED: {
    customerEmail: (c) => ({
      subject: `Reverse pickup scheduled for order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nWe've scheduled the pickup of your item for order #${c.orderNumber}. Please keep the item packed and ready.${trackLine("Pickup AWB", c.reverseAwb, c.reverseTrackingUrl)}\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "PICKUP_SCHEDULED",
      defaultTemplate: "exchange_pickup_scheduled",
      variables: (c) => [c.customerName || "there", c.orderNumber, c.reverseAwb || "-"],
    },
    adminSubject: (c) => `Reverse pickup scheduled: #${c.orderNumber}`,
  },
  PICKUP_COMPLETED: {
    customerEmail: (c) => ({
      subject: `Your item has been picked up — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nYour item for order #${c.orderNumber} has been picked up and is on its way back to us. We'll let you know once it's received.${trackLine("Pickup AWB", c.reverseAwb, c.reverseTrackingUrl)}\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "PICKUP_COMPLETED",
      defaultTemplate: "exchange_pickup_completed",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Reverse pickup completed: #${c.orderNumber}`,
  },
  ITEM_RECEIVED: {
    customerEmail: (c) => ({
      subject: `We've received your returned item — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nWe've received your returned item for order #${c.orderNumber} at our warehouse and are now processing your replacement.\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "ITEM_RECEIVED",
      defaultTemplate: "exchange_item_received",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Return received at warehouse: #${c.orderNumber}`,
  },
  REPLACEMENT_PROCESSING: {
    customerEmail: (c) => ({
      subject: `Your replacement is being prepared — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nGood news — your replacement for order #${c.orderNumber} is being prepared and will ship soon.\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "REPLACEMENT_PROCESSING",
      defaultTemplate: "exchange_replacement_processing",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Replacement processing: #${c.orderNumber}`,
  },
  REPLACEMENT_SHIPPED: {
    customerEmail: (c) => ({
      subject: `Your replacement has shipped — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nYour replacement for order #${c.orderNumber} has shipped.${trackLine("Tracking AWB", c.forwardAwb, c.forwardTrackingUrl)}\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "REPLACEMENT_SHIPPED",
      defaultTemplate: "exchange_replacement_shipped",
      variables: (c) => [c.customerName || "there", c.orderNumber, c.forwardAwb || "-"],
    },
    adminSubject: (c) => `Replacement shipped: #${c.orderNumber}`,
  },
  CLOSED: {
    customerEmail: (c) => ({
      subject: `Your exchange is complete — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nYour replacement for order #${c.orderNumber} has been delivered and your exchange is now complete. We hope you love it!\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "CLOSED",
      defaultTemplate: "exchange_completed",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Exchange completed: #${c.orderNumber}`,
  },
  REJECTED: {
    customerEmail: (c) => ({
      subject: `Update on your exchange request — order #${c.orderNumber}`,
      text: `Hi ${c.customerName || "there"},\n\nAfter reviewing your exchange request for order #${c.orderNumber}, we're unable to approve it${c.adminNote ? `: ${c.adminNote}` : "."}\n\nIf you have questions, please reply to this email.\n\nThank you,\nMegaska`,
    }),
    whatsapp: {
      key: "REJECTED",
      defaultTemplate: "exchange_rejected",
      variables: (c) => [c.customerName || "there", c.orderNumber],
    },
    adminSubject: (c) => `Exchange rejected: #${c.orderNumber}`,
  },
};

function whatsappEnabled() {
  return String(process.env.EXCHANGE_WHATSAPP_ENABLED || "").trim().toLowerCase() === "true";
}

function resolveWhatsappTemplate(key: string, fallback: string) {
  const override = String(process.env[`WHATSAPP_TEMPLATE_EXCHANGE_${key}`] || "").trim();
  return override || fallback;
}

function buildAdminBody(ctx: MilestoneContext) {
  return [
    `Request ID: ${ctx.requestId}`,
    `Order Number: ${ctx.orderNumber}`,
    `Status: ${ctx.status} (${ctx.statusDescription})`,
    `Customer: ${ctx.customerName || "-"} / ${ctx.customerPhone || "-"} / ${ctx.customerEmail || "-"}`,
    `Item: ${ctx.itemTitle || "-"} (${ctx.currentSize || "-"} → ${ctx.requestedSize || "-"})`,
    ctx.reverseAwb ? `Reverse AWB: ${ctx.reverseAwb}` : "",
    ctx.forwardAwb ? `Replacement AWB: ${ctx.forwardAwb}` : "",
    ctx.adminNote ? `Admin Note: ${ctx.adminNote}` : "",
    `Admin URL: ${ctx.adminUrl}`,
  ].filter(Boolean).join("\n");
}

/**
 * Send customer (email + WhatsApp) and admin notifications for one exchange
 * milestone. Idempotent per (request, status) via a marker AuditEvent. Never
 * throws — always safe to call fire-and-forget or awaited.
 */
export async function notifyExchangeMilestone(requestId: string, status: string): Promise<{ notified: boolean; reason?: string }> {
  try {
    const definition = MILESTONES[status];
    if (!definition) return { notified: false, reason: "no-milestone-config" };

    const markerEventType = `exchange.milestone_notified.${status}`;
    const already = await prisma.auditEvent.findFirst({
      where: { entityType: "OrderActionRequest", entityId: requestId, eventType: markerEventType },
      select: { id: true },
    });
    if (already) return { notified: false, reason: "already-notified" };

    const request = await prisma.orderActionRequest.findFirst({
      where: { id: requestId, requestType: "EXCHANGE" },
      include: { items: { take: 1 }, shipments: true },
    });
    if (!request) return { notified: false, reason: "request-not-found" };

    const reverse = request.shipments.find((s) => s.direction === "REVERSE_PICKUP") || null;
    const forward = request.shipments.find((s) => s.direction === "FORWARD_REPLACEMENT") || null;
    const appBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");

    const ctx: MilestoneContext = {
      requestId: request.id,
      orderNumber: request.orderNumber,
      status,
      statusDescription: EXCHANGE_STATUS_DESCRIPTIONS[status] || status,
      customerName: request.customerNameSnapshot,
      customerEmail: request.customerEmailSnapshot,
      customerPhone: request.customerPhoneSnapshot,
      itemTitle: request.items[0]?.productTitle ?? null,
      currentSize: request.items[0]?.currentSize ?? null,
      requestedSize: request.items[0]?.requestedSize ?? null,
      adminNote: request.adminNote,
      reverseAwb: reverse?.awb ?? null,
      reverseTrackingUrl: reverse?.trackingUrl ?? null,
      forwardAwb: forward?.awb ?? null,
      forwardTrackingUrl: forward?.trackingUrl ?? null,
      adminUrl: appBaseUrl ? `${appBaseUrl}/admin/exchanges/${encodeURIComponent(request.id)}` : "-",
    };

    const shopId = request.shopId || "";

    // Customer email
    if (definition.customerEmail && shopId) {
      const copy = definition.customerEmail(ctx);
      const result = await sendCustomerEmail({
        shopId,
        to: ctx.customerEmail,
        eventType: "EXCHANGE",
        subject: copy.subject,
        text: copy.text,
        usageContext: {
          sourceType: "EXCHANGE_REQUEST",
          sourceId: request.id,
          idempotencyKey: `usage:email-send:${shopId}:exchange:${request.id}:${status.toLowerCase()}-customer`,
        },
      });
      if (!result.success && !result.skipped) {
        console.error("[EXCHANGE MILESTONE] customer email failed", { requestId: request.id, status });
      }
    }

    // Customer WhatsApp (best-effort, gated + graceful)
    if (definition.whatsapp && whatsappEnabled() && ctx.customerPhone) {
      const templateName = resolveWhatsappTemplate(definition.whatsapp.key, definition.whatsapp.defaultTemplate);
      if (templateName) {
        await sendTemplateMessage({
          shopId,
          toPhone: ctx.customerPhone,
          templateName,
          languageCode: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en").trim() || "en",
          variables: definition.whatsapp.variables(ctx),
        }).catch((error) => {
          console.warn("[EXCHANGE MILESTONE] whatsapp send threw", {
            requestId: request.id,
            status,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    // Admin/ops email (every milestone)
    if (shopId) {
      await sendOpsAlert({
        shopId,
        eventType: "EXCHANGE",
        subject: definition.adminSubject(ctx),
        text: buildAdminBody(ctx),
        usageContext: {
          sourceType: "EXCHANGE_REQUEST",
          sourceId: request.id,
          idempotencyKey: `usage:email-send:${shopId}:exchange:${request.id}:${status.toLowerCase()}-admin`,
        },
      });
    }

    // Idempotency marker — after attempting sends, so a transient total failure
    // isn't permanently suppressed by a marker (subsequent transitions still
    // notify their own milestones).
    await prisma.auditEvent.create({
      data: {
        actorType: "system",
        eventType: markerEventType,
        entityType: "OrderActionRequest",
        entityId: request.id,
        payload: { shopId, status } as never,
      },
    });

    console.info("[EXCHANGE MILESTONE] notified", { requestId: request.id, status });
    return { notified: true };
  } catch (error) {
    console.error("[EXCHANGE MILESTONE] failed", {
      requestId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    return { notified: false, reason: "error" };
  }
}
