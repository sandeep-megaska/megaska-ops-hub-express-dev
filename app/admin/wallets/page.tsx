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
    return <main className="mk-page"><div className="mk-alert mk-alert-error" role="alert">{formatAdminShopResolutionError(resolved)}</div></main>;
  }

  const q = String(Array.isArray(filters.q) ? filters.q[0] : filters.q || "").trim();
  const shopDomain = resolved.shopDomain || "";

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
      shopifyGiftCardLast4: string | null;
    }>
  >`
    SELECT wa."id", wa."customerProfileId", wa."currency", wa."currentBalance", wa."updatedAt",
      wa."shopifyGiftCardLast4",
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
    <main className="mk-page">
      <header className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Wallet Operations</h1>
          <p className="mk-page-subtitle">Search customer wallets and open a customer to manage credits, debits, and view their ledger.</p>
        </div>
      </header>

      <form className="mk-header-actions" style={{ maxWidth: 560 }}>
        {shopDomain ? <input type="hidden" name="shop" value={shopDomain} /> : null}
        <input className="mk-input" name="q" defaultValue={q} placeholder="Search by phone, name, email" />
        <button type="submit" className="mk-btn mk-btn-primary">Search</button>
      </form>

      {wallets.length ? (
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                {["Customer", "Phone", "Email", "Balance", "Gift card", "Updated", "Action"].map((head) => (
                  <th key={head}>{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet.id}>
                  <td>{getName(wallet)}</td>
                  <td>{wallet.phoneE164}</td>
                  <td>{wallet.email || "-"}</td>
                  <td>{wallet.currency} {(wallet.currentBalance / 100).toFixed(2)}</td>
                  <td>{wallet.shopifyGiftCardLast4 ? `••••${wallet.shopifyGiftCardLast4}` : "—"}</td>
                  <td>{wallet.updatedAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td>
                    <Link className="mk-btn mk-btn-sm" href={shopDomain ? `/admin/wallets/${wallet.customerProfileId}?shop=${encodeURIComponent(shopDomain)}` : `/admin/wallets/${wallet.customerProfileId}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mk-empty">
          <p className="mk-empty-title">No wallets found</p>
          <p>Try a different phone number, name, or email.</p>
        </div>
      )}
    </main>
  );
}
