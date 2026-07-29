import Link from "next/link";
import { prisma } from "../../../services/db/prisma";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getName(row: { firstName: string | null; lastName: string | null; fullName: string | null }) {
  const joined = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return joined || row.fullName || "-";
}

export default async function AdminWalletsPage({ searchParams }: Props) {
  const filters = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(filters);
  const shop = resolved.shop;

  if (!shop?.id) {
    return <main style={{ padding: 24 }}>{formatAdminShopResolutionError(resolved)}</main>;
  }

  const q = String(Array.isArray(filters.q) ? filters.q[0] : filters.q || "").trim();

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
      AND wa."shopId" = ${shop.id}
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
