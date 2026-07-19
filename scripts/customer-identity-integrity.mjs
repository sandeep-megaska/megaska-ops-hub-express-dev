#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifyCustomerIdentityIntegrity } from "../services/customers/customer-identity-integrity.ts";

const shopIdArg = process.argv.slice(2).find((arg) => arg.startsWith("--shop-id="));
const shopId = shopIdArg?.slice("--shop-id=".length).trim() ?? "";
if (!shopId) throw new Error("--shop-id is required; cross-tenant verification is prohibited");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const violations = await prisma.$transaction(
    (tx) => verifyCustomerIdentityIntegrity(tx, shopId),
    { isolationLevel: "RepeatableRead", readOnly: true },
  );
  const result = { shopId, checkedAt: new Date().toISOString(), status: violations.length ? "FAILED" : "VERIFIED", violations };
  console.log(JSON.stringify(result, null, 2));
  if (violations.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
