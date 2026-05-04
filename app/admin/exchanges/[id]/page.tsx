import { allowedStatusTransitions } from "../../../../services/exchange/lifecycle";
import { prisma } from "../../../../services/db/prisma";
import { getShopByDomain, normalizeShopDomain } from "../../../../services/shopify/shop";
import ExchangeLifecycleControls from "./ExchangeLifecycleControls";
import { getDelhiveryCapabilityState } from "../../../../services/logistics/delhivery";
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

function statusBadgeClass(status: string) {
  if (["REJECTED"].includes(status)) return "bg-red-100 text-red-700 border-red-200";
  if (["CLOSED"].includes(status)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["APPROVED", "PAYMENT_RECEIVED", "REPLACEMENT_SHIPPED"].includes(status)) {
    return "bg-indigo-100 text-indigo-700 border-indigo-200";
  }
  return "bg-amber-100 text-amber-700 border-amber-200";
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

  if (!shopDomain) {
    return (
      <main className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Unable to load exchange request details right now. Please return to the exchanges list and try again.
        </div>
      </main>
    );
  }

  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    return (
      <main className="p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Unable to load exchange request details right now. Please refresh and try again.
        </div>
      </main>
    );
  }

  const request = await prisma.orderActionRequest.findFirst({
    where: { id, requestType: "EXCHANGE", shopId: shop.id },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" }, include: { invoice: true } },
      shipments: true,
    },
  });

  if (!request) {
    return <main className="p-8">Exchange request not found.</main>;
  }

  const reverseShipment = request.shipments.find((shipment) => shipment.direction === "REVERSE_PICKUP") || null;
  const delhiveryCapability = getDelhiveryCapabilityState();
  const forwardShipment = request.shipments.find((shipment) => shipment.direction === "FORWARD_REPLACEMENT") || null;
  const nextTransitions = allowedStatusTransitions[request.status] || [];

  return (
    <main className="grid gap-6 p-8">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Exchange Request #{request.id}</h1>
            <p className="mt-1 text-sm text-slate-500">Order {request.orderNumber || "—"}</p>
          </div>
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(request.status)}`}>
            {request.status}
          </span>
        </div>

        <div className="mt-5 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-slate-500">Customer</p>
            <p className="font-medium text-slate-900">{request.customerNameSnapshot || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Phone</p>
            <p className="font-medium text-slate-900">{request.customerPhoneSnapshot || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Email</p>
            <p className="font-medium text-slate-900">{request.customerEmailSnapshot || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Requested Date</p>
            <p className="font-medium text-slate-900">{formatDate(request.requestedAt)}</p>
          </div>
          <div>
            <p className="text-slate-500">Last Updated</p>
            <p className="font-medium text-slate-900">{formatDate(request.updatedAt)}</p>
          </div>
        </div>
      </section>

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
    </main>
  );
}
