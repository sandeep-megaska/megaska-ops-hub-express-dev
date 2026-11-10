import { allowedStatusTransitions } from "../../../../services/exchange/lifecycle";
import { prisma } from "../../../../services/db/prisma";
import {
  getShopByDomain,
  normalizeShopDomain,
  resolveShopConfig,
} from "../../../../services/shopify/shop";
import ExchangeLifecycleControls from "./ExchangeLifecycleControls";
import EarlyReplacementCard from "./EarlyReplacementCard";
import StyleExchangeCard from "./StyleExchangeCard";
import { styleChangeBlocker } from "../../../../services/exchange/style-exchange";
import { earlyReplacementEligibility, returnOutstanding } from "../../../../services/exchange/early-replacement";
import { resolveDelhiveryRuntimeConfig } from "../../../../services/logistics/delhivery-runtime";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

function getStockReviewNote(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const note = (snapshot as { stockReviewMessage?: unknown }).stockReviewMessage;
  const value = typeof note === "string" ? note.trim() : "";
  return value || null;
}

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return value.toISOString();
}

function statusBadgeVariant(status: string) {
  if (["REJECTED", "CANCELLED", "FAILED"].includes(status)) return "danger";
  if (["CLOSED", "COMPLETED", "APPROVED", "PAYMENT_RECEIVED", "PICKUP_COMPLETED", "ITEM_RECEIVED", "REPLACEMENT_SHIPPED"].includes(status)) return "success";
  if (["OPEN", "PENDING", "AWAITING_PAYMENT", "PICKUP_PENDING", "PICKUP_SCHEDULED", "REPLACEMENT_PROCESSING"].includes(status)) return "warning";
  return "neutral";
}

export default async function AdminExchangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shop?: string; shopify_shop?: string }>;
}) {
  const { id } = await params;
  const parsedSearch = await searchParams;
  const requestHeaders = await headers();
  const shopDomain = normalizeShopDomain(
    parsedSearch?.shop ||
      parsedSearch?.shopify_shop ||
      requestHeaders.get("x-shopify-shop-domain")
  );

  const shop = shopDomain
    ? await getShopByDomain(shopDomain)
    : await resolveShopConfig();
  if (!shop) {
    return (
      <div className="mk-page">
        <div className="mk-alert mk-alert-error">
          Unable to load exchange request details right now. Please refresh and try again.
        </div>
      </div>
    );
  }

  const request = await prisma.orderActionRequest.findFirst({
    where: { id, requestType: "EXCHANGE", shopId: shop.id },
    include: {
      items: true,
      payments: { where: { purpose: "REVERSE_PICKUP_FEE" }, orderBy: { createdAt: "desc" }, include: { invoice: true } },
      shipments: true,
    },
  });

  if (!request) {
    return (
      <div className="mk-page">
        <div className="mk-empty">
          <p className="mk-empty-title">Exchange request not found</p>
        </div>
      </div>
    );
  }

  const reverseShipment = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
  // Per-shop Delhivery capability (merchant's own credentials). Only expose the
  // {configured, reason} view to the client — never the resolved API token.
  const delhiveryRuntime = await resolveDelhiveryRuntimeConfig(shop.id);
  const delhiveryCapability = { configured: delhiveryRuntime.configured, reason: delhiveryRuntime.reason };
  const forwardShipment = request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT") || null;
  const nextTransitions = allowedStatusTransitions[request.status] || [];
  const stylePayment = await prisma.requestPayment.findFirst({ where: { requestId: request.id, purpose: "STYLE_DIFFERENCE" }, orderBy: { createdAt: "desc" } });
  const styleLocked = styleChangeBlocker({ status: request.status, styleSettledAt: request.styleSettledAt, forwardAwb: forwardShipment?.awb, stylePaymentPaid: stylePayment?.status === "PAID" && stylePayment.amount === request.styleDifferencePaise });
  const earlyEligibility = earlyReplacementEligibility({ status: request.status, earlyReplacementAt: request.earlyReplacementAt, reverseShipment, forwardAwb: forwardShipment?.awb });

  return (
    <div className="mk-page">
      <section className="mk-card">
        <div className="mk-page-header">
          <div>
            <h1 className="mk-page-title">Exchange Request #{request.id}</h1>
            <p className="mk-page-subtitle">Order {request.orderNumber || "—"}</p>
          </div>
          <span className={`mk-badge mk-badge-${statusBadgeVariant(request.status)}`}>
            {request.status}
          </span>
        </div>

        <div className="mk-grid-3" style={{ marginTop: 20 }}>
          <div>
            <p className="mk-stat-label">Customer</p>
            <p style={{ fontWeight: 600 }}>{request.customerNameSnapshot || "—"}</p>
          </div>
          <div>
            <p className="mk-stat-label">Phone</p>
            <p style={{ fontWeight: 600 }}>{request.customerPhoneSnapshot || "—"}</p>
          </div>
          <div>
            <p className="mk-stat-label">Email</p>
            <p style={{ fontWeight: 600 }}>{request.customerEmailSnapshot || "—"}</p>
          </div>
          <div>
            <p className="mk-stat-label">Requested Date</p>
            <p style={{ fontWeight: 600 }}>{formatDate(request.requestedAt)}</p>
          </div>
          <div>
            <p className="mk-stat-label">Last Updated</p>
            <p style={{ fontWeight: 600 }}>{formatDate(request.updatedAt)}</p>
          </div>
        </div>
      </section>

      <StyleExchangeCard
        requestId={request.id}
        shopDomain={shopDomain || shop.shopDomain}
        items={request.items.map((item) => ({ id: item.id, productTitle: item.productTitle, variantTitle: item.variantTitle, sku: item.sku, requestedSize: item.requestedSize, quantity: item.quantity, replacementTitle: item.replacementTitle, replacementSku: item.replacementSku, replacementUnitPricePaise: item.replacementUnitPricePaise, originalUnitPricePaise: item.originalUnitPricePaise }))}
        differencePaise={request.styleDifferencePaise}
        settlement={request.styleSettlement}
        settledAtIso={request.styleSettledAt ? request.styleSettledAt.toISOString() : null}
        payment={stylePayment ? { status: stylePayment.status, url: stylePayment.paymentLinkUrl, amount: stylePayment.amount } : null}
        locked={request.status === "REJECTED" ? "This exchange was rejected." : styleLocked}
      />

      <EarlyReplacementCard
        requestId={request.id}
        shopDomain={shopDomain || shop.shopDomain}
        eligible={earlyEligibility.ok}
        early={request.earlyReplacementAt ? { atIso: request.earlyReplacementAt.toISOString(), reason: request.earlyReplacementReason } : null}
        returnOutstanding={returnOutstanding({ earlyReplacementAt: request.earlyReplacementAt, reverseShipment })}
        reverseStatus={reverseShipment?.status ?? null}
      />

      <ExchangeLifecycleControls
        requestId={request.id}
        shopDomain={shopDomain}
        currentStatus={request.status}
        allowedTransitions={nextTransitions}
        currentAdminNote={request.adminNote || ""}
        reason={request.reason || ""}
        customerNote={request.customerNote || ""}
        items={request.items.map((item) => ({
          id: item.id,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          currentSize: item.currentSize,
          requestedSize: item.requestedSize,
          quantity: item.quantity,
          stockReviewNote: getStockReviewNote(item.eligibilitySnapshot),
        }))}
        payments={request.payments.map((payment) => ({
          id: payment.id,
          purpose: payment.purpose,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          provider: payment.provider,
          paymentLinkUrl: payment.paymentLinkUrl,
          paymentId: payment.paymentId,
          createdAtIso: payment.createdAt.toISOString(),
          paidAtIso: payment.paidAt?.toISOString() || null,
          invoice: payment.invoice ? {
            id: payment.invoice.id,
            invoiceNumber: payment.invoice.invoiceNumber,
            invoiceStatus: payment.invoice.invoiceStatus,
            invoiceDateIso: payment.invoice.invoiceDate.toISOString(),
            totalPaise: payment.invoice.totalPaise,
            gstPaise: payment.invoice.cgstPaise + payment.invoice.sgstPaise + payment.invoice.igstPaise,
          } : null,
        }))}
        reverseShipment={
          reverseShipment
            ? {
                status: reverseShipment.status,
                carrier: reverseShipment.carrier,
                awb: reverseShipment.awb,
                trackingUrl: reverseShipment.trackingUrl,
                pickupAtIso: reverseShipment.pickupAt?.toISOString() || null,
                deliveredAtIso: reverseShipment.deliveredAt?.toISOString() || null,
                remarks: reverseShipment.remarks,
              }
            : null
        }
        delhiveryCapability={delhiveryCapability}
        forwardShipment={
          forwardShipment
            ? {
                status: forwardShipment.status,
                carrier: forwardShipment.carrier,
                awb: forwardShipment.awb,
                trackingUrl: forwardShipment.trackingUrl,
                shippedAtIso: forwardShipment.shippedAt?.toISOString() || null,
                deliveredAtIso: forwardShipment.deliveredAt?.toISOString() || null,
                remarks: forwardShipment.remarks,
              }
            : null
        }
      />
    </div>
  );
}
