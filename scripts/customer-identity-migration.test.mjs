import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../prisma/migrations/20260719000000_normalize_shopify_customer_identity/migration.sql", import.meta.url), "utf8");
const repair = await readFile(new URL("./dev-repair-customer-profile-duplicate.mjs", import.meta.url), "utf8");

test("portable migration contains validation and no deployment-specific identifiers", () => {
  assert.match(migration, /Malformed CustomerProfile/);
  assert.match(migration, /Unresolved canonical Shopify customer duplicates/);
  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(migration, /MegaskaOrder|ReviewRequest|AuditEvent/);
});

test("development repair is explicitly protected and checks every profile foreign key", () => {
  assert.match(repair, /VERCEL_ENV === "production"/);
  assert.match(repair, /ALLOW_CUSTOMER_IDENTITY_REPAIR/);
  assert.match(repair, /information_schema\.table_constraints/);
  assert.match(repair, /auditEvent\.create/);
});
