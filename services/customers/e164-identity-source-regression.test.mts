import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modules = [
  "services/customers/canonical-customer-resolver.ts",
  "services/customers/customer-identity-repository.ts",
  "services/customers/customer-identity-reconciliation.ts",
  "services/shopify/admin.ts",
  "services/shopify/dashboard.ts",
  "app/api/webhooks/orders/create/route.ts",
];

test("identity-sensitive sources contain no suffix or country-stripping match", async () => {
  const forbidden = [/slice\(\s*-10\s*\)/, /endsWith\([^)]*(?:phone|digit|suffix)/i, /replace\(\s*["']\+91["']/];
  for (const file of modules) {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} contains ${pattern}`);
  }
});
