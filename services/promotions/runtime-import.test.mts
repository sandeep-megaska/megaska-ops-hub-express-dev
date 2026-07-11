import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sourcePath = new URL("./repository.server.ts", import.meta.url);

test("promotion repository production code uses static Prisma singleton import only", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /import \{ prisma \} from "\.\.\/db\/prisma\.ts";/);
  assert.match(source, /const db = \(\) => prisma as unknown as PromotionDb;/);
  assert.doesNotMatch(source, /createRequire/);
  assert.doesNotMatch(source, /require\(["']\.\.\/db\/prisma\.ts["']\)/);
});

test("default database factory resolves the statically imported Prisma singleton lazily", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /const db = \(\) => prisma as unknown as PromotionDb;/);
  assert.match(source, /database: PromotionDb = db\(\)/);
  assert.doesNotMatch(source, /db\(\)\.promotionRule/);
});

test("generated Prisma client includes the promotionRule delegate after generation", async () => {
  const tempDir = await mkdtemp(join(process.cwd(), ".tmp-promotion-prisma-generate-"));
  try {
    const schemaPath = new URL("../../prisma/schema.prisma", import.meta.url);
    const schema = await readFile(schemaPath, "utf8");
    const tempSchemaPath = join(tempDir, "schema.prisma");
    await writeFile(tempSchemaPath, schema.replace('output   = "../generated/prisma"', 'output   = "./client"'));
    const result = spawnSync("npx", ["prisma", "generate", "--schema", tempSchemaPath], {
      cwd: new URL("../..", import.meta.url),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/db" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const generatedTypes = await readFile(join(tempDir, "client", "index.d.ts"), "utf8");
    assert.match(generatedTypes, /get promotionRule\(\): Prisma\.PromotionRuleDelegate/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
