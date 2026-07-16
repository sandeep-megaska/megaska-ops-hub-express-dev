import BillingDashboard from "../../../components/billing/billing-dashboard";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams?: Promise<{ shop?: string; shopify_shop?: string; host?: string; hmac?: string }> }) {
  const params = await searchParams;
  const resolved = await resolveAdminShopFromSearchParams(params ?? {});
  if (!resolved.shop?.id) return <main className="mk-page"><h1 className="mk-page-title">Billing</h1><section className="mk-card" role="alert"><p>{formatAdminShopResolutionError(resolved)}</p></section></main>;
  return <BillingDashboard shopDomain={resolved.shopDomain} />;
}
