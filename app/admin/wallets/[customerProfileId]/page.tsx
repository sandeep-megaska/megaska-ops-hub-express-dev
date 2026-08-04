import { prisma } from "../../../../services/db/prisma";
import { getOrCreateWalletAccount, listWalletTransactions } from "../../../../services/wallet";
import { listWalletReservationsForAdmin } from "../../../../services/wallet-reservation";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import { readCustomerGiftCard } from "../../../../services/store-credit/gift-card";
import WalletOpsControls from "./WalletOpsControls";

export const dynamic = "force-dynamic";

function displayName(customer: { firstName: string | null; lastName: string | null; fullName: string | null }) {
  const joined = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return joined || customer.fullName || "-";
}

export default async function AdminWalletDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerProfileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { customerProfileId } = await params;
  const resolved = await resolveAdminShopFromSearchParams(await searchParams);
  const shop = resolved.shop;

  if (!shop?.id) {
    return <main className="mk-page"><div className="mk-alert mk-alert-error" role="alert">{formatAdminShopResolutionError(resolved)}</div></main>;
  }

  const customer = await prisma.customerProfile.findUnique({
  where: { id: customerProfileId },
  select: {
    id: true,
    shopId: true,
    phoneE164: true,
    email: true,
    firstName: true,
    lastName: true,
    fullName: true,
  },
});

 // Tenant isolation: only render a customer that belongs to the acting shop.
 if (!customer || customer.shopId !== shop.id) {
  return <main className="mk-page"><div className="mk-empty"><p className="mk-empty-title">Customer not found</p></div></main>;
}
  const wallet = await getOrCreateWalletAccount(customer.id, "INR", {
  shopId: shop.id,
});

const transactions = await listWalletTransactions(customer.id, "INR", 200, {
  shopId: shop.id,
});
  const reservations = await listWalletReservationsForAdmin(customer.id);

  // The customer's store credit lives on a Shopify gift card - surface it here (live
  // balance + code + a deep-link into Shopify's gift-card admin) so this page is the
  // single place an operator can see and reach the actual card. Best-effort.
  const giftCard = await readCustomerGiftCard({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    customerProfileId: customer.id,
    currency: "INR",
  }).catch(() => ({ ok: false as const, reason: "read_failed" }));
  const storeHandle = (shop.myshopifyDomain || "").replace(/\.myshopify\.com$/i, "");
  const giftCardNumericId = giftCard.ok && giftCard.present ? String(giftCard.giftCardId).split("/").pop() || "" : "";
  const giftCardAdminUrl = storeHandle && giftCardNumericId
    ? `https://admin.shopify.com/store/${storeHandle}/gift_cards/${giftCardNumericId}`
    : "";

  return (
    <main className="mk-page">
      <header className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Wallet Detail</h1>
          <p className="mk-page-subtitle">{displayName(customer)}</p>
        </div>
      </header>

      <section className="mk-grid-4">
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Current Balance</p>
          <p className="mk-stat-value">{wallet.currency} {(wallet.currentBalance / 100).toFixed(2)}</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Customer</p>
          <p className="mk-stat-value" style={{ fontSize: 20 }}>{displayName(customer)}</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Phone</p>
          <p className="mk-stat-value" style={{ fontSize: 20 }}>{customer.phoneE164}</p>
        </div>
        <div className="mk-card mk-stat-card">
          <p className="mk-stat-label">Email</p>
          <p className="mk-stat-value" style={{ fontSize: 20 }}>{customer.email || "-"}</p>
        </div>
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Gift Card (store credit at checkout)</h3>
        {giftCard.ok && giftCard.present ? (
          <div className="mk-grid-4">
            <div className="mk-stat-card">
              <p className="mk-stat-label">Live balance</p>
              <p className="mk-stat-value">INR {(giftCard.balancePaise / 100).toFixed(2)}</p>
            </div>
            <div className="mk-stat-card">
              <p className="mk-stat-label">Code</p>
              <p className="mk-stat-value" style={{ fontSize: 18, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{giftCard.code || `••••${giftCard.last4}`}</p>
            </div>
            <div className="mk-stat-card">
              <p className="mk-stat-label">Last 4</p>
              <p className="mk-stat-value" style={{ fontSize: 20 }}>••••{giftCard.last4}</p>
            </div>
            <div className="mk-stat-card">
              <p className="mk-stat-label">In Shopify</p>
              <p className="mk-stat-value" style={{ fontSize: 16 }}>
                {giftCardAdminUrl ? <a href={giftCardAdminUrl} target="_blank" rel="noreferrer" className="mk-link">Open gift card ↗</a> : "—"}
              </p>
            </div>
          </div>
        ) : (
          <div className="mk-empty"><p className="mk-empty-title">No gift card yet</p><p>A gift card is created automatically on the customer&apos;s first store-credit grant.</p></div>
        )}
      </section>

      <WalletOpsControls customerProfileId={customer.id} />

      <section className="mk-card">
        <h3 className="mk-section-title">Wallet Reservations</h3>
        {reservations.length ? (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr>
                  {["Created", "Status", "Amount", "Code", "Expires", "Order"].map((head) => (
                    <th key={head}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reservations.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td>{row.status}</td>
                    <td>{row.currency} {(row.reservedAmount / 100).toFixed(2)}</td>
                    <td>{row.discountCode || "-"}</td>
                    <td>{row.expiresAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td>{row.orderNumber || row.shopifyOrderId || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mk-empty"><p className="mk-empty-title">No reservations yet</p></div>
        )}
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Wallet Ledger</h3>
        {transactions.length ? (
          <div className="mk-table-wrap">
            <table className="mk-table">
              <thead>
                <tr>
                  {["Date", "Direction", "Type", "Amount", "Reason", "Source", "Order", "Created By"].map((head) => (
                    <th key={head}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td>{txn.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td>{txn.direction}</td>
                    <td>{txn.transactionType}</td>
                    <td>{txn.currency} {(txn.amount / 100).toFixed(2)}</td>
                    <td>{txn.reason || txn.adminNote || "-"}</td>
                    <td>{txn.sourceType}{txn.sourceReference ? ` (${txn.sourceReference})` : ""}</td>
                    <td>{txn.orderNumber || "-"}</td>
                    <td>{txn.createdByType}{txn.createdById ? ` (${txn.createdById})` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mk-empty"><p className="mk-empty-title">No wallet transactions yet</p></div>
        )}
      </section>
    </main>
  );
}
