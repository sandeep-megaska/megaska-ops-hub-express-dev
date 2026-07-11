import Link from "next/link";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import { getPromotionAdminListReadModel, type PromotionAdminStatusFilter } from "../../../services/promotions/admin-read-model.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ shop?: string; status?: PromotionAdminStatusFilter }> };

export default async function PromotionsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const resolved = await resolveAdminShopFromSearchParams(params);
  if (!resolved.shop?.id) return <main className="space-y-4"><h1 className="text-2xl font-semibold">Promotions</h1><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{formatAdminShopResolutionError(resolved)}</p></main>;
  const status = params.status || "ALL";
  const items = await getPromotionAdminListReadModel(resolved.shop.id, { status });
  const shopQuery = `shop=${encodeURIComponent(resolved.shop.shopDomain)}`;
  return <main className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Promotion rules</h1><p className="text-sm text-gray-500">Admin foundation only. Execution setup pending; no rules are published from this page.</p></div><Link className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white" href={`/admin/promotions/new?${shopQuery}`}>New draft</Link></div>
    <div className="flex gap-2">{["ALL", "DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].map((s) => <Link key={s} className={`rounded-full border px-3 py-1 text-sm ${status === s ? "bg-gray-900 text-white" : "bg-white"}`} href={`/admin/promotions?${shopQuery}&status=${s}`}>{s === "ALL" ? "Current" : s}</Link>)}</div>
    {items.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center"><h2 className="text-lg font-semibold">No promotion rules found</h2><p className="mt-2 text-sm text-gray-500">Archived rules are hidden unless the Archived filter is selected.</p></div> : <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><table className="min-w-full divide-y divide-gray-200 text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Trigger</th><th className="px-4 py-3">Offer product</th><th className="px-4 py-3">Reward</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3">Execution</th></tr></thead><tbody className="divide-y divide-gray-100">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-medium"><Link className="text-blue-700 underline" href={`/admin/promotions/${item.id}?${shopQuery}`}>{item.name}</Link></td><td className="px-4 py-3">{item.triggerTypeLabel}</td><td className="px-4 py-3">{item.offerProductTitle}</td><td className="px-4 py-3">{item.rewardLabel}</td><td className="px-4 py-3">{item.status}</td><td className="px-4 py-3">{item.priority}</td><td className="px-4 py-3">{item.scheduleLabel}</td><td className="px-4 py-3">{item.updatedLabel}</td><td className="px-4 py-3">{item.executionLabel}</td></tr>)}</tbody></table></div>}
  </main>;
}
