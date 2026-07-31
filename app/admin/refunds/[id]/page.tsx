import { headers } from "next/headers";
import { getAdminRefundById } from "../../../../services/refund/admin-refunds";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../../services/shopify/shop";
import RefundActions from "./RefundActions";

function row(label: string, value: string | number | null | undefined) {
  return (
    <p className="mk-list-subtitle" style={{ marginTop: 4 }}>
      <strong style={{ color: "var(--text)" }}>{label}:</strong> {value || "—"}
    </p>
  );
}

function statusBadgeVariant(status: string) {
  const s = (status || "").toUpperCase();
  if (["PAID", "APPROVED", "COMPLETED"].includes(s)) return "success";
  if (["REJECTED", "FAILED", "CANCELLED"].includes(s)) return "danger";
  if (["DETAILS_SUBMITTED", "PENDING", "PAYOUT_PENDING", "MANUAL_PENDING"].includes(s)) return "warning";
  return "neutral";
}

export default async function AdminRefundDetailPage({
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
    parsedSearch?.shop || parsedSearch?.shopify_shop || requestHeaders.get("x-shopify-shop-domain")
  );

  const shop = shopDomain ? await getShopByDomain(shopDomain) : await resolveShopConfig();
  if (!shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-empty"><p className="mk-empty-title">Unable to resolve shop context</p></div>
      </div>
    );
  }

  const data = await getAdminRefundById(shop.id, id);
  if (!data) {
    return (
      <div className="mk-page">
        <div className="mk-empty"><p className="mk-empty-title">Refund not found</p></div>
      </div>
    );
  }

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Refund {data.id}</h1>
          <p className="mk-page-subtitle">Manual payout mode.</p>
        </div>
        <span className={`mk-badge mk-badge-${statusBadgeVariant(data.status)}`}>{data.status}</span>
      </div>

      <section className="mk-card">
        <h3 className="mk-section-title">Summary</h3>
        {row("Status", data.status)}
        {row("Source", `${data.source}${data.sourceId ? ` (${data.sourceId})` : ""}`)}
        {row("Method", data.method)}
        {row("Amount", `${data.amount} ${data.currency}`)}
        {row("Reason", data.reason)}
        {row("Customer Note", data.customerNote)}
        {row("Admin Note", data.adminNote)}
        {row("Created", data.createdAt.toISOString())}
        {row("Updated", data.updatedAt.toISOString())}
        {data.walletTransactionId ? row("Store Credit Transaction", data.walletTransactionId) : null}
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Masked payout details</h3>
        {row("Rail", data.payoutDetails?.rail)}
        {row("Account Holder", data.payoutDetails?.accountHolderName)}
        {row("Bank Account", data.payoutDetails?.bankAccountMasked)}
        {row("IFSC", data.payoutDetails?.bankIfscMasked)}
        {row("UPI", data.payoutDetails?.upiIdMasked)}
        {row("Phone", data.payoutDetails?.phoneMasked)}
      </section>

      <RefundActions id={data.id} status={data.status} method={data.method} walletTransactionId={data.walletTransactionId} shopDomain={shopDomain || ""} />
    </div>
  );
}
