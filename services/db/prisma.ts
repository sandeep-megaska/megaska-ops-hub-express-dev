import { PrismaClient } from "../../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const DEFAULT_POOL_MAX = 1;

function resolvePoolMax(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_POOL_MAX);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pool?: Pool;
};

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: resolvePoolMax(process.env.DATABASE_POOL_MAX),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });

globalForPrisma.pool = pool;
globalForPrisma.prisma = prisma;
