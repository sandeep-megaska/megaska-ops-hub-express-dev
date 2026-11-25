// Apply supabase/migrations/*.sql in order, once each. Usage:
//   DATABASE_URL=... npm run db:migrate
// Use the *direct* or session connection string here (port 5432), not the
// transaction pooler: migrations hold one session for several statements.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL or DATABASE_URL");
  process.exit(1);
}
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`create table if not exists storefront_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await client.query("select name from storefront_migrations")).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`Applying ${file}`);
    await client.query("begin");
    try {
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("insert into storefront_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  console.log("Migrations up to date");
} finally {
  await client.end();
}
