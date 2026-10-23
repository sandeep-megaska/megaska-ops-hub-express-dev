import BillingDashboard from "../../../components/billing/billing-dashboard";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import { confirmPlanChange } from "../../../services/billing/plans/plan-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingSearchParams = { shop?: string; shopify_shop?: string; host?: string; hmac?: string; planChangeId?: string; charge_id?: string };

export default async function BillingPage({ searchParams }: { searchParams?: Promise<BillingSearchParams> }) {
  const params = (await searchParams) ?? {};
  const resolved = await resolveAdminShopFromSearchParams(params);
  if (!resolved.shop?.id) return <main className="mk-page"><header className="mk-page-header"><div><h1 className="mk-page-title">Billing</h1></div></header><div className="mk-alert mk-alert-error" role="alert">{formatAdminShopResolutionError(resolved)}</div></main>;

  // Shopify returns here after the merchant approves (or declines) the subscription.
  // confirmPlanChange checks the subscription's status with Shopify for this verified
  // shop, so a planChangeId on the URL can't confirm anything by itself.
  let notice: { tone: "success" | "info"; text: string } | null = null;
  const planChangeId = String(params.planChangeId || "").trim();
  if (planChangeId) {
    try {
      await confirmPlanChange({ shopId: resolved.shop.id, planChangeId });
      notice = { tone: "success", text: "Your LoopD2C subscription is active." };
    } catch {
      notice = { tone: "info", text: "Shopify hasn't confirmed this subscription. If you declined it, approve it below to activate billing." };
    }
  }

  return (
    <>
      {notice ? <div className="mk-page"><div className={`mk-alert ${notice.tone === "success" ? "mk-alert-success" : "mk-alert-info"}`} role="status">{notice.text}</div></div> : null}
      <BillingDashboard shopDomain={resolved.shopDomain} />
    </>
  );
}
