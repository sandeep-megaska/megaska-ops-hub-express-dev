import { PrismaClient, Prisma } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, allowExitOnIdle: true });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export const billableFeatures = [
  { code: "OTP", name: "OTP" },
  { code: "EMAIL", name: "Email" },
  { code: "SMS", name: "SMS" },
  { code: "WHATSAPP", name: "WhatsApp" },
  { code: "AI", name: "AI" },
  { code: "DELIVERY_LOOKUP", name: "Delivery Lookup" },
  { code: "CHECKOUT", name: "Checkout" },
];

export const pricingPlans = [
  {
    code: "PROFESSIONAL",
    name: "Professional",
    monthlyBasePrice: "4999",
    currency: "INR",
  },
];

export const professionalPlanFeatures = [
  { featureCode: "OTP", includedQuantity: "1000", overageUnitPrice: "0.35" },
  { featureCode: "EMAIL", includedQuantity: "2000", overageUnitPrice: "0.08" },
  { featureCode: "SMS", includedQuantity: "0", overageUnitPrice: "0" },
  { featureCode: "WHATSAPP", includedQuantity: "0", overageUnitPrice: "0" },
  { featureCode: "AI", includedQuantity: "0", overageUnitPrice: "0" },
  { featureCode: "DELIVERY_LOOKUP", includedQuantity: "0", overageUnitPrice: "0" },
  { featureCode: "CHECKOUT", includedQuantity: "0", overageUnitPrice: "0" },
];

export async function seedCommercialCatalog(db = prisma) {
  const featureRows = new Map();

  for (const feature of billableFeatures) {
    const row = await db.billableFeature.upsert({
      where: { code: feature.code },
      update: { name: feature.name, active: true },
      create: { code: feature.code, name: feature.name, active: true },
    });
    featureRows.set(feature.code, row);
  }

  const professionalPlan = await db.pricingPlan.upsert({
    where: { code: "PROFESSIONAL" },
    update: {
      name: "Professional",
      monthlyBasePrice: new Prisma.Decimal("4999"),
      currency: "INR",
      active: true,
    },
    create: {
      code: "PROFESSIONAL",
      name: "Professional",
      monthlyBasePrice: new Prisma.Decimal("4999"),
      currency: "INR",
      active: true,
    },
  });

  for (const planFeature of professionalPlanFeatures) {
    const feature = featureRows.get(planFeature.featureCode);
    if (!feature) throw new Error(`Missing billable feature ${planFeature.featureCode}`);

    await db.pricingPlanFeature.upsert({
      where: {
        pricingPlanId_billableFeatureId: {
          pricingPlanId: professionalPlan.id,
          billableFeatureId: feature.id,
        },
      },
      update: {
        includedQuantity: new Prisma.Decimal(planFeature.includedQuantity),
        overageUnitPrice: new Prisma.Decimal(planFeature.overageUnitPrice),
        active: true,
      },
      create: {
        pricingPlanId: professionalPlan.id,
        billableFeatureId: feature.id,
        includedQuantity: new Prisma.Decimal(planFeature.includedQuantity),
        overageUnitPrice: new Prisma.Decimal(planFeature.overageUnitPrice),
        active: true,
      },
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedCommercialCatalog()
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
}
