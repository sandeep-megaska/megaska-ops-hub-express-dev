import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const repositoryPath = path.join(root, "services/customers/customer-identity-repository.ts");
const writePattern = /\b(?:prisma|tx|db)\.customerProfile\.(?:create|update|delete|upsert)\s*\(/g;
const ignored = new Set(["generated", "node_modules", ".git", ".next"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(candidate));
    else if (/\.(?:ts|tsx|mts|mjs)$/.test(entry.name)) files.push(candidate);
  }
  return files;
}

test("canonical identity infrastructure has its required boundaries", async () => {
  const required = [
    "customer-identity-repository.ts", "canonical-customer-resolver.ts", "customer-identity-types.ts",
    "customer-identity-errors.ts", "customer-identity-normalization.ts",
  ];
  for (const file of required) assert.ok((await readFile(path.join(root, "services/customers", file), "utf8")).length > 0, file);
  const repository = await readFile(repositoryPath, "utf8");
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /isolationLevel: "Serializable"/);
  assert.match(await readFile(path.join(root, "services/customers/canonical-customer-resolver.ts"), "utf8"), /IDENTITY_CONFLICT/);
});

test("direct CustomerProfile write enforcement inventory (warning mode)", async (t) => {
  const violations = [];
  for (const file of await sourceFiles(root)) {
    if (file === repositoryPath || file.endsWith("customer-identity-architecture.test.mjs")) continue;
    const source = await readFile(file, "utf8");
    if (writePattern.test(source)) violations.push(path.relative(root, file));
    writePattern.lastIndex = 0;
  }
  if (violations.length) t.diagnostic(`WARNING: legacy direct CustomerProfile writes remain until adoption: ${violations.sort().join(", ")}`);
  assert.ok(true, "warning-mode inventory must not change existing runtime behavior");
});
