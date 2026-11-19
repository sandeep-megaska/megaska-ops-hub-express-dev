import Link from "next/link";
import { prisma } from "../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import ArrangeReversePickupForm from "./ArrangeReversePickupForm";

export const dynamic = "force-dynamic";

// Arrange a reverse pickup for any order (wrong or damaged item, a late delivery
// the customer wasn't there for, anything else) and book it on Delhivery without
// re-typing the order. Recent ones are listed below with their tracking.
export default async function ReversePickupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params);
  const shop = resolved.shop;
  if (!shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-alert mk-alert-error">{formatAdminShopResolutionError(resolved)}</div>
      </div>
    );
  }

  const initialOrder = typeof params.order === "string" ? params.order : "";
  const recent = await prisma.orderActionRequest.findMany({
    where: { shopId: shop.id, requestType: "ISSUE", eligibilityDecision: "TEAM_CREATED" },
    include: { shipments: { where: { direction: "REVERSE_PICKUP" } } },
    orderBy: { requestedAt: "desc" },
    take: 20,
  });

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <h1 className="mk-page-title">Reverse pickups</h1>
        <p className="mk-page-subtitle">Arrange a Delhivery reverse pickup for any order: loopd2c fills in the customer, items and address. For an exchange with an expired payment link, use &quot;Fee paid another way&quot; on the exchange instead.</p>
      </div>

      <ArrangeReversePickupForm shopDomain={shop.shopDomain} initialOrder={initialOrder} />

      <section className="mk-card">
        <h2 className="mk-section-title">Arranged by the team</h2>
        {recent.length === 0 ? (
          <p className="mk-help">None yet.</p>
        ) : (
          <table className="mk-table">
            <thead>
              <tr><th>Order</th><th>Reason</th><th>Status</th><th>AWB</th><th>Pickup</th><th>Arranged</th></tr>
            </thead>
            <tbody>
              {recent.map((request) => {
                const shipment = request.shipments[0];
                return (
                  <tr key={request.id}>
                    <td><Link href={`/admin/issues/${request.id}`}>{request.orderNumber}</Link></td>
                    <td>{request.reason || "—"}</td>
                    <td>{request.status}</td>
                    <td>{shipment?.awb ? (shipment.trackingUrl ? <a href={shipment.trackingUrl} target="_blank" rel="noreferrer">{shipment.awb}</a> : shipment.awb) : "Not booked"}</td>
                    <td>{shipment?.status ?? "—"}</td>
                    <td>{request.requestedAt.toLocaleString("en-IN")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
