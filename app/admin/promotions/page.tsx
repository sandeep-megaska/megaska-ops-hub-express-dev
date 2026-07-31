import Link from "next/link";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import { buildPromotionAdminUrl, promotionEmbeddedContext, type PromotionEmbeddedContext } from "../../../services/promotions/admin-context";
import { getPromotionAdminListReadModel, type PromotionAdminStatusFilter } from "../../../services/promotions/admin-read-model.server";
import { toneClasses } from "./PromotionExecutionStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PromotionListSearchParams = PromotionEmbeddedContext & { hmac?: string | string[]; status?: PromotionAdminStatusFilter; saved?: string; error?: string };
type PageProps = { searchParams?: Promise<PromotionListSearchParams> };

export default async function PromotionsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const resolved = await resolveAdminShopFromSearchParams(params);
  if (!resolved.shop?.id) return <main className="mk-page"><h1 className="mk-page-title">Promotions</h1><p className="mk-alert mk-alert-error">{formatAdminShopResolutionError(resolved)}</p></main>;
  const context = promotionEmbeddedContext(params, resolved.shop.shopDomain);
  const status = params.status || "ALL";
  const items = await getPromotionAdminListReadModel(resolved.shop.id, { status });
  return <main className="mk-page"><div className="mk-page-header"><div><h1 className="mk-page-title">Promotion rules</h1><p className="mk-page-subtitle">Create and manage promotion rules for your storefront.</p></div><div className="mk-header-actions"><Link className="mk-btn mk-btn-primary" href={buildPromotionAdminUrl("/admin/promotions/new", context)}>New draft</Link></div></div>
    <div className="mk-header-actions">{["ALL", "DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].map((s) => <Link key={s} className={`mk-btn mk-btn-sm ${status === s ? "mk-btn-primary" : ""}`} href={buildPromotionAdminUrl("/admin/promotions", context, { status: s })}>{s === "ALL" ? "Current" : s}</Link>)}</div>
    {items.length === 0 ? <div className="mk-empty"><h2 className="mk-empty-title">No promotion rules found</h2><p>Archived rules are hidden unless the Archived filter is selected.</p></div> : <div className="mk-table-wrap"><table className="mk-table"><thead><tr><th>Name</th><th>Trigger</th><th>Offer product</th><th>Reward</th><th>Status</th><th>Priority</th><th>Schedule</th><th>Updated</th><th>Execution</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="font-medium"><Link className="mk-link" href={buildPromotionAdminUrl(`/admin/promotions/${item.id}`, context)}>{item.name}</Link></td><td>{item.triggerTypeLabel}</td><td>{item.offerProductTitle}</td><td>{item.rewardLabel}</td><td>{item.status}</td><td>{item.priority}</td><td>{item.scheduleLabel}</td><td>{item.updatedLabel}</td><td><span className={toneClasses(item.executionTone)}>{item.executionLabel}</span>{item.executionSecondaryText ? <p className="mk-help mt-1">{item.executionSecondaryText}</p> : null}</td></tr>)}</tbody></table></div>}
  </main>;
}
