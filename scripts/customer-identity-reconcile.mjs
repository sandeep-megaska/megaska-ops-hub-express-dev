#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  applyReconciliationPlan, approveReconciliationPlan, createReconciliationPlan,
  discoverDuplicateCustomerProfiles,
} from "../services/customers/customer-identity-reconciliation.ts";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : true];
}));
const shopId = typeof args["shop-id"] === "string" ? args["shop-id"].trim() : "";
if (!shopId) throw new Error("--shop-id is required; cross-tenant operation is prohibited");
const modes = ["discover", "plan", "approve", "apply"].filter((mode) => args[mode]);
if (modes.length > 1) throw new Error("Choose exactly one mode; DISCOVER, PLAN, and APPLY never chain");
const mode = modes[0] ?? "discover";
const actor = String(args.actor || process.env.IDENTITY_RECONCILIATION_ACTOR || "operator-cli");
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
  transactionOptions: {
    maxWait: 10_000,
    timeout: 60_000,
    isolationLevel: "Serializable",
  },
});

function report(plan) {
  const payload = plan.plan;
  console.log(`Shop: ${plan.shopId}\n\nDuplicate group:\nCanonical: ${plan.canonicalCustomerProfileId}\nSources: ${plan.sourceCustomerProfileIds.join(", ")}\nClassification: ${plan.classification}`);
  console.log(`\nEvidence:\n${payload.matchingEvidence.map((item) => `- ${item}`).join("\n") || "- none"}`);
  console.log(`\nProposed movements:\n${payload.dependentRecordMovements.map((item) => `- ${item.tableName}: ${item.count}`).join("\n") || "- none"}`);
  console.log(`\nPlan: ${plan.id}\nChecksum: ${plan.checksum}\nStatus: ${plan.status}\n\nNo data changed.`);
}

try {
  if (mode === "discover") {
    const groups = await discoverDuplicateCustomerProfiles(prisma, { shopId, customerProfileId: args["customer-profile-id"], phoneHash: args["phone-hash"], shopifyCustomerId: args["shopify-customer-id"], limit: args.limit ? Number(args.limit) : undefined });
    console.log(JSON.stringify({ mode: "DISCOVER", shopId, readOnly: true, groups }, null, 2));
  } else if (mode === "plan") {
    const ids = String(args["profile-ids"] || "").split(",").map((id) => id.trim()).filter(Boolean);
    const plan = await createReconciliationPlan(prisma, { shopId, profileIds: ids, createdBy: actor, targetProfileId: args["target-profile-id"] ? String(args["target-profile-id"]) : undefined, reasonCode: args["reason-code"] ? String(args["reason-code"]) : undefined });
    report(plan);
  } else if (mode === "approve") {
    if (!args["plan-id"] || !args.confirm) throw new Error("--plan-id and --confirm=<checksum> are required to approve");
    const plan = await approveReconciliationPlan(prisma, { shopId, planId: String(args["plan-id"]), checksum: String(args.confirm), actor });
    console.log(JSON.stringify({ mode: "APPROVE", planId: plan.id, status: plan.status }));
  } else {
    if (!args["plan-id"] || !args.confirm) throw new Error("--plan-id and --confirm=<checksum> are required to apply");
    const result = await applyReconciliationPlan(prisma, { shopId, planId: String(args["plan-id"]), checksum: String(args.confirm), actor });
    console.log(JSON.stringify({ mode: "APPLY", ...result }));
  }
} finally { await prisma.$disconnect(); }
