import { prisma as defaultPrisma } from "../db/prisma.ts";

export const DEFAULT_PRIMARY_COMMERCIAL_PLAN_CODE = "PROFESSIONAL";
export const REQUIRED_BILLING_FEATURE_CODES = ["OTP", "EMAIL"] as const;
export const COMMERCIAL_CATALOG_NOT_CONFIGURED = "COMMERCIAL_CATALOG_NOT_CONFIGURED";
export const COMMERCIAL_CATALOG_SAFE_MESSAGE = "LoopD2C billing is being configured. Please try again shortly.";

type CatalogFeature = { active: boolean; billableFeature: { code: string; active: boolean } };
type CatalogPlan = { id: string; code: string; active: boolean; currency: string; features: CatalogFeature[] };
type CatalogDb = { pricingPlan: { findUnique(args: unknown): Promise<CatalogPlan | null> } };
let prismaClient: CatalogDb = defaultPrisma as unknown as CatalogDb;

export function __setCommercialCatalogHealthPrismaForTests(client: CatalogDb) { prismaClient = client; }
export function getPrimaryCommercialPlanCode() { return process.env.LOOPDESK_PRIMARY_PLAN_CODE || DEFAULT_PRIMARY_COMMERCIAL_PLAN_CODE; }

export type CommercialCatalogHealth = { ready: boolean; planCode: string; planId: string | null; activeFeatureCodes: string[]; missingFeatureCodes: string[]; errorCode: string | null };

/** Checks platform-owned billing configuration without creating catalog or merchant records. */
export async function verifyPrimaryCommercialCatalog(): Promise<CommercialCatalogHealth> {
  const planCode = getPrimaryCommercialPlanCode();
  const plan = await prismaClient.pricingPlan.findUnique({ where: { code: planCode }, include: { features: { include: { billableFeature: true } } } });
  const activeFeatureCodes = plan?.features.filter((feature) => feature.active && feature.billableFeature.active).map((feature) => feature.billableFeature.code).sort() ?? [];
  const missingFeatureCodes = REQUIRED_BILLING_FEATURE_CODES.filter((code) => !activeFeatureCodes.includes(code));
  // Feature prices inherit the parent PricingPlan currency; that currency must be configured.
  const ready = Boolean(plan?.active) && Boolean(plan?.currency?.trim()) && missingFeatureCodes.length === 0;
  return { ready, planCode, planId: plan?.id ?? null, activeFeatureCodes, missingFeatureCodes, errorCode: ready ? null : COMMERCIAL_CATALOG_NOT_CONFIGURED };
}

export class CommercialCatalogConfigurationError extends Error {
  readonly code = COMMERCIAL_CATALOG_NOT_CONFIGURED;
  readonly details: CommercialCatalogHealth;
  constructor(details: CommercialCatalogHealth) { super(COMMERCIAL_CATALOG_SAFE_MESSAGE); this.name = "CommercialCatalogConfigurationError"; this.details = details; }
}

export async function requirePrimaryCommercialCatalog() {
  const health = await verifyPrimaryCommercialCatalog();
  if (!health.ready) throw new CommercialCatalogConfigurationError(health);
  return health;
}
