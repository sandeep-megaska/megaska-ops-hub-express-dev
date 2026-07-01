import { headers } from "next/headers";
import { getAdminRefundById } from "../../../../services/refund/admin-refunds";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../../services/shopify/shop";
import RefundActions from "./RefundActions";

function row(label: string, value: string | number | null | undefined) {
  return <p><strong>{label}:</strong> {value || "—"}</p>;
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
  if (!shop?.id) return <main style={{ padding: 24 }}>Unable to resolve shop context.</main>;

  const data = await getAdminRefundById(shop.id, id);
  if (!data) return <main style={{ padding: 24 }}>Refund not found.</main>;

  return <main style={{ padding: 24, display: "grid", gap: 16 }}><h1>Refund {data.id}</h1><section><h3>Summary</h3>{row("Status", data.status)}{row("Source", `${data.source}${data.sourceId ? ` (${data.sourceId})` : ""}`)}{row("Method", data.method)}{row("Amount", `${data.amount} ${data.currency}`)}{row("Reason", data.reason)}{row("Customer Note", data.customerNote)}{row("Admin Note", data.adminNote)}{row("Created", data.createdAt.toISOString())}{row("Updated", data.updatedAt.toISOString())}{data.walletTransactionId ? row("Megaska Store Credit Transaction", data.walletTransactionId) : null}</section><section><h3>Masked payout details</h3>{row("Rail", data.payoutDetails?.rail)}{row("Account Holder", data.payoutDetails?.accountHolderName)}{row("Bank Account", data.payoutDetails?.bankAccountMasked)}{row("IFSC", data.payoutDetails?.bankIfscMasked)}{row("UPI", data.payoutDetails?.upiIdMasked)}{row("Phone", data.payoutDetails?.phoneMasked)}</section><RefundActions id={data.id} status={data.status} method={data.method} walletTransactionId={data.walletTransactionId} shopDomain={shopDomain || ""} /></main>;
}
