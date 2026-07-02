import { prisma } from "../../../../services/db/prisma";
import { getOrCreateWalletAccount, listWalletTransactions } from "../../../../services/wallet";
import { listWalletReservationsForAdmin } from "../../../../services/wallet-reservation";
import WalletOpsControls from "./WalletOpsControls";

export const dynamic = "force-dynamic";

function displayName(customer: { firstName: string | null; lastName: string | null; fullName: string | null }) {
  const joined = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return joined || customer.fullName || "-";
}

export default async function AdminWalletDetailPage({ params }: { params: Promise<{ customerProfileId: string }> }) {
  const { customerProfileId } = await params;

  const customer = await prisma.customerProfile.findUnique({
    where: { id: customerProfileId },
    select: {
      id: true,
      phoneE164: true,
      email: true,
      firstName: true,
      lastName: true,
      fullName: true,
    },
  });

  if (!customer) {
    return <main style={{ padding: 24 }}>Customer not found.</main>;
  }

  const wallet = await getOrCreateWalletAccount(customer.id, "INR");
  const transactions = await listWalletTransactions(customer.id, "INR", 200);
  const reservations = await listWalletReservationsForAdmin(customer.id);

  return (
    <main style={{ padding: 24, display: "grid", gap: 14 }}>
      <h1>Wallet Detail</h1>
      <section>
        <p>Customer: {displayName(customer)}</p>
        <p>Phone: {customer.phoneE164}</p>
        <p>Email: {customer.email || "-"}</p>
        <p>Current Balance: {wallet.currency} {(wallet.currentBalance / 100).toFixed(2)}</p>
      </section>

      <WalletOpsControls customerProfileId={customer.id} />


      <section>
        <h3>Wallet Reservations</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Created", "Status", "Amount", "Code", "Expires", "Order"].map((head) => (
                <th key={head} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 8 }}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reservations.map((row) => (
              <tr key={row.id}>
                <td style={{ padding: 8 }}>{row.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td style={{ padding: 8 }}>{row.status}</td>
                <td style={{ padding: 8 }}>{row.currency} {(row.reservedAmount / 100).toFixed(2)}</td>
                <td style={{ padding: 8 }}>{row.discountCode || "-"}</td>
                <td style={{ padding: 8 }}>{row.expiresAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td style={{ padding: 8 }}>{row.orderNumber || row.shopifyOrderId || "-"}</td>
              </tr>
            ))}
            {!reservations.length ? (
              <tr>
                <td style={{ padding: 8 }} colSpan={6}>
                  No reservations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Wallet Ledger</h3>
        <p style={{ color: "#555", marginTop: -6 }}>Showing latest 200 wallet transactions.</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Direction", "Type", "Amount", "Reason", "Admin Note", "Source", "Order", "Created By"].map((head) => (
                <th key={head} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 8 }}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => (
              <tr key={txn.id}>
                <td style={{ padding: 8 }}>{txn.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td style={{ padding: 8 }}>{txn.direction}</td>
                <td style={{ padding: 8 }}>{txn.transactionType}</td>
                <td style={{ padding: 8 }}>
                  {txn.currency} {(txn.amount / 100).toFixed(2)}
                </td>
                <td style={{ padding: 8 }}>{txn.reason || "-"}</td>
                <td style={{ padding: 8 }}>{txn.adminNote || "-"}</td>
                <td style={{ padding: 8 }}>
                  <div>Type: {txn.sourceType || "-"}</div>
                  <div>Reference: {txn.sourceReference || "-"}</div>
                  <div>ID: {txn.sourceId || "-"}</div>
                </td>
                <td style={{ padding: 8 }}>{txn.orderNumber || "-"}</td>
                <td style={{ padding: 8 }}>{txn.createdByType}{txn.createdById ? ` (${txn.createdById})` : ""}</td>
              </tr>
            ))}
            {!transactions.length ? (
              <tr>
                <td style={{ padding: 8 }} colSpan={9}>
                  No wallet transactions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
