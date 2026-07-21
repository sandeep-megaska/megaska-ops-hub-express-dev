import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const canonical = (value: unknown) => typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const formattingKey = (value: string) => value.replace(/\D/g, "").replace(/^00/, "");

try {
  const rows = await prisma.customerProfile.findMany({ select: { shopId: true, phoneE164: true } });
  for (const shopId of [...new Set(rows.map((row) => row.shopId ?? "<unscoped>"))].sort()) {
    const phones = rows.filter((row) => (row.shopId ?? "<unscoped>") === shopId && row.phoneE164).map((row) => row.phoneE164!);
    const exact = new Map<string, number>();
    const formatted = new Map<string, Set<string>>();
    const suffixes = new Map<string, Set<string>>();
    for (const phone of phones) {
      exact.set(phone, (exact.get(phone) ?? 0) + 1);
      const key = formattingKey(phone);
      formatted.set(key, new Set([...(formatted.get(key) ?? []), phone]));
      const suffix = key.slice(-7);
      if (suffix) suffixes.set(suffix, new Set([...(suffixes.get(suffix) ?? []), phone]));
    }
    const samples = (groups: Iterable<[string, Set<string>]>) => [...groups]
      .filter(([, values]) => values.size > 1)
      .map(([, values]) => [...values].map(fingerprint).sort());
    console.log(JSON.stringify({
      shopId,
      canonicalE164Count: phones.filter(canonical).length,
      nonCanonicalCount: phones.filter((phone) => !canonical(phone)).length,
      duplicateExactE164Count: [...exact.values()].filter((count) => count > 1).length,
      possibleFormattingDuplicateGroups: samples(formatted),
      crossCountrySuffixCollisionGroups: samples(suffixes),
    }));
  }
} finally {
  await prisma.$disconnect();
}
