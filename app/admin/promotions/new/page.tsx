import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import { promotionEmbeddedContext, type PromotionEmbeddedContext } from "../../../../services/promotions/admin-context";
import PromotionForm from "../PromotionForm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PageProps = { searchParams?: Promise<PromotionEmbeddedContext & { hmac?: string | string[]; saved?: string; error?: string }> };
export default async function NewPromotionPage({ searchParams }: PageProps) { const params = (await searchParams) ?? {}; const resolved = await resolveAdminShopFromSearchParams(params); if (!resolved.shop?.id) return <main className="mk-page"><p className="mk-alert mk-alert-error">{formatAdminShopResolutionError(resolved)}</p></main>; return <main className="mk-page"><div className="mk-page-header"><div><h1 className="mk-page-title">New promotion draft</h1><p className="mk-page-subtitle">Configure the trigger, reward, and presentation for this promotion.</p></div></div><PromotionForm shopId={resolved.shop.id} shopDomain={resolved.shop.shopDomain} embeddedContext={promotionEmbeddedContext(params, resolved.shop.shopDomain)} /></main>; }
