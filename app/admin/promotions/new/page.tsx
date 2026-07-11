import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import PromotionForm from "../PromotionForm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PageProps = { searchParams?: Promise<{ shop?: string }> };
export default async function NewPromotionPage({ searchParams }: PageProps) { const params = (await searchParams) ?? {}; const resolved = await resolveAdminShopFromSearchParams(params); if (!resolved.shop?.id) return <main><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{formatAdminShopResolutionError(resolved)}</p></main>; return <main className="space-y-6"><div><h1 className="text-2xl font-semibold">New promotion draft</h1><p className="text-sm text-gray-500">Resource Picker is intentionally not included in this phase.</p></div><PromotionForm shopDomain={resolved.shop.shopDomain} /></main>; }
