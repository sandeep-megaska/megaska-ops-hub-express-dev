import Link from "next/link";
import { prisma } from "../../../services/db/prisma";
import { getStoreCreditAnalytics } from "../../../services/store-credit-analytics";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

function formatMoney(amountMinor: number, currency: string) {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function getName(row: { firstName: string | null; lastName: string | null; fullName: string | null }) {
  const joined = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return joined || row.fullName || "-";
}

export default async function AdminWalletsPage({ searchParams }: Props) {
  const filters = await searchParams;
  const q = String(filters.q || "").trim();

  const analytics = await getStoreCreditAnalytics();

  const wallets = await prisma.$queryRaw<
    Array<{
      id: string;
      customerProfileId: string;
      currency: string;
      currentBalance: number;
      updatedAt: Date;
      phoneE164: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      fullName: string | null;
    }>
  >`
    SELECT wa."id", wa."customerProfileId", wa."currency", wa."currentBalance", wa."updatedAt",
      cp."phoneE164", cp."email", cp."firstName", cp."lastName", cp."fullName"
    FROM "WalletAccount" wa
    JOIN "CustomerProfile" cp ON cp."id" = wa."customerProfileId"
    WHERE wa."currency" = 'INR'
      AND (
        ${q} = ''
        OR cp."phoneE164" ILIKE ${`%${q}%`}
        OR COALESCE(cp."email", '') ILIKE ${`%${q}%`}
        OR COALESCE(cp."firstName", '') ILIKE ${`%${q}%`}
        OR COALESCE(cp."lastName", '') ILIKE ${`%${q}%`}
        OR COALESCE(cp."fullName", '') ILIKE ${`%${q}%`}
      )
    ORDER BY wa."updatedAt" DESC
    LIMIT 200
  `;

  return (
    <main style={{ padding: 24, display: "grid", gap: 12 }}>
      <h1>Wallet Operations</h1>
      <p style={{ margin: 0, color: "#555" }}>Metrics shown for the last 30 days unless otherwise specified.</p>
      <section style={{ display: "grid", gap: 12 }}>
        {analytics.map((row) => (
          <article key={`${row.shopId}-${row.currency}`} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>
              Store Credit Analytics — {row.shopId} / {row.currency}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <div><strong>Outstanding Liability</strong><br />{formatMoney(row.outstandingLiability, row.currency)}</div>
              <div><strong>Reserved Store Credit</strong><br />{formatMoney(row.reservedStoreCredit, row.currency)}</div>
              <div><strong>Issued (Last 30 Days)</strong><br />{formatMoney(row.issuedLast30Days, row.currency)}</div>
              <div><strong>Redeemed (Last 30 Days)</strong><br />{formatMoney(row.redeemedLast30Days, row.currency)}</div>
              <div><strong>Net Movement</strong><br />{formatMoney(row.netMovementLast30Days, row.currency)}</div>
              <div><strong>Refunds Settled as Store Credit</strong><br />{formatMoney(row.refundsSettledAsStoreCredit, row.currency)}</div>
            </div>
            <div style={{ marginTop: 12, color: "#555" }}>
              Issued breakdown: COD refund {formatMoney(row.issuedCodRefundCreditLast30Days, row.currency)}, manual {formatMoney(row.issuedManualCreditLast30Days, row.currency)}, goodwill {formatMoney(row.issuedGoodwillCreditLast30Days, row.currency)}, adjustment {formatMoney(row.issuedAdjustmentLast30Days, row.currency)}.
            </div>
          </article>
        ))}
        {!analytics.length ? <p style={{ margin: 0 }}>No store credit analytics available.</p> : null}
      </section>

      <form style={{ display: "flex", gap: 8, maxWidth: 560 }}>
        <input name="q" defaultValue={q} placeholder="Search by phone, name, email" style={{ width: "100%" }} />
        <button type="submit">Search</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Customer", "Phone", "Email", "Balance", "Updated", "Action"].map((head) => (
              <th key={head} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 8 }}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wallets.map((wallet) => (
            <tr key={wallet.id}>
              <td style={{ padding: 8 }}>{getName(wallet)}</td>
              <td style={{ padding: 8 }}>{wallet.phoneE164}</td>
              <td style={{ padding: 8 }}>{wallet.email || "-"}</td>
              <td style={{ padding: 8 }}>{wallet.currency} {(wallet.currentBalance / 100).toFixed(2)}</td>
              <td style={{ padding: 8 }}>{wallet.updatedAt.toISOString().slice(0, 19).replace("T", " ")}</td>
              <td style={{ padding: 8 }}>
                <Link href={`/admin/wallets/${wallet.customerProfileId}`}>Open</Link>
              </td>
            </tr>
          ))}
          {!wallets.length ? (
            <tr>
              <td colSpan={6} style={{ padding: 8 }}>
                No wallets found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
