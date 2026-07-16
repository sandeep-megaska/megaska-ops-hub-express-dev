import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const requiredFeatureCodes = ["OTP", "EMAIL"];
const planCode = process.env.LOOPDESK_PRIMARY_PLAN_CODE || "PROFESSIONAL";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, allowExitOnIdle: true });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

try {
  const plan = await prisma.pricingPlan.findUnique({ where: { code: planCode }, include: { features: { include: { billableFeature: true } } } });
  const activeCodes = plan?.features.filter((feature) => feature.active && feature.billableFeature.active).map((feature) => feature.billableFeature.code).sort() ?? [];
  const missing = requiredFeatureCodes.filter((code) => !activeCodes.includes(code));
  if (!plan || !plan.active || !plan.currency.trim() || missing.length) {
    console.error(`Commercial catalog not ready: plan=${planCode}; planFound=${Boolean(plan)}; planActive=${Boolean(plan?.active)}; missingFeatures=${missing.join(",") || "none"}`);
    process.exitCode = 1;
  } else {
    console.log("Commercial catalog ready");
    console.log(`Plan: ${plan.code}`);
    console.log(`Currency: ${plan.currency}`);
    console.log(`Features: ${activeCodes.join(", ")}`);
  }
} finally { await prisma.$disconnect(); await pool.end(); }
