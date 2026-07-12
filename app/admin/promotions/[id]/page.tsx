import { notFound } from "next/navigation";
import { promotionEmbeddedContext, type PromotionEmbeddedContext } from "../../../../services/promotions/admin-context";
import { getPromotionRuleById, PromotionRuleNotFoundError } from "../../../../services/promotions/repository.server";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../../services/shopify/admin-shop-context";
import PromotionForm from "../PromotionForm";
import { getPromotionCompilationReadModel } from "../../../../services/promotions/compiler-admin-read-model.server";
import PromotionExecutionStatus from "../PromotionExecutionStatus";
import PromotionCompilationHistory from "../PromotionCompilationHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<PromotionEmbeddedContext & { hmac?: string | string[]; saved?: string; error?: string; publication?: string; sync?: string }> };

export default async function EditPromotionPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const resolved = await resolveAdminShopFromSearchParams(sp);

  if (!resolved.shop?.id) {
    return <main><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{formatAdminShopResolutionError(resolved)}</p></main>;
  }

  const rule = await getPromotionRuleById(resolved.shop.id, id).catch((error: unknown) => {
    if (error instanceof PromotionRuleNotFoundError) notFound();
    throw error;
  });

  const execution = await getPromotionCompilationReadModel(resolved.shop.id, id, { historyLimit: 10 });
  const context = promotionEmbeddedContext(sp, resolved.shop.shopDomain);
  return <main className="space-y-6"><div><h1 className="text-2xl font-semibold">Edit promotion</h1><p className="text-sm text-gray-500">Status: {rule.status}. Compilation: {execution.label}.</p></div><PromotionExecutionStatus model={execution} ruleStatus={rule.status} saved={typeof sp.saved === "string" ? sp.saved : undefined} publication={typeof sp.publication === "string" ? sp.publication : undefined} sync={typeof sp.sync === "string" ? sp.sync : undefined} /><PromotionForm shopId={resolved.shop.id} shopDomain={resolved.shop.shopDomain} embeddedContext={context} rule={rule} execution={execution} /><PromotionCompilationHistory model={execution} /></main>;
}
