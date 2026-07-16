import { prisma } from "../../db/prisma.ts";

export type MerchantPricingPlanDto = { id: string; code: string; name: string; description: string | null; currency: string; monthlyBasePrice: string; active: boolean; displayOrder: number; tierRank: number; features: Array<{ featureCode: string; featureName: string; includedQuantity: string; overageUnitRate: string; currency: string }> };

/** Provider-neutral public commercial catalog. Decimal values deliberately cross the boundary as strings. */
export async function listAvailablePricingPlans(input: { shopId: string; currency?: string }): Promise<MerchantPricingPlanDto[]> {
  const shop = await prisma.shop.findUnique({ where: { id: input.shopId }, select: { id: true } });
  if (!shop) throw new PlanCatalogError("SHOP_NOT_FOUND");
  const currency = input.currency?.trim().toUpperCase();
  const plans = await prisma.pricingPlan.findMany({ where: { active: true, ...(currency ? { currency } : {}) }, orderBy: [{ displayOrder: "asc" }, { tierRank: "asc" }, { code: "asc" }], include: { features: { where: { active: true }, orderBy: { billableFeature: { code: "asc" } }, include: { billableFeature: true } } } });
  return plans.map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, description: plan.description, currency: plan.currency, monthlyBasePrice: plan.monthlyBasePrice.toString(), active: plan.active, displayOrder: plan.displayOrder, tierRank: plan.tierRank, features: plan.features.filter((feature) => feature.billableFeature.active).map((feature) => ({ featureCode: feature.billableFeature.code, featureName: feature.billableFeature.name, includedQuantity: feature.includedQuantity.toString(), overageUnitRate: feature.overageUnitPrice.toString(), currency: plan.currency })) }));
}
export class PlanCatalogError extends Error { constructor(public readonly code: string) { super(code); this.name = "PlanCatalogError"; } }
