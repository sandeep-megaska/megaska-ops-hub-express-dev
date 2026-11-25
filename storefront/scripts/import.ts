// Import from the command line (same code as /admin):
//   node --env-file=.env.local --experimental-strip-types scripts/import.ts products products_export.csv [--full]
//   node --env-file=.env.local --experimental-strip-types scripts/import.ts collections [file.json]
//   node --env-file=.env.local --experimental-strip-types scripts/import.ts redirects url_redirects.csv
// Cached pages refresh within the hour, or redeploy to refresh at once.
import { readFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importCollectionsJson, importProductsCsv, importRedirectsCsv } from "../lib/import/run.ts";
import { closePool } from "../lib/db.ts";

const [kind, file, flag] = process.argv.slice(2);
const read = (path: string) => readFileSync(path, "utf8");

try {
  let outcome;
  if (kind === "products" && file) {
    outcome = await importProductsCsv(read(file), { mode: flag === "--full" ? "full" : "partial", fileName: basename(file) });
  } else if (kind === "redirects" && file) {
    outcome = await importRedirectsCsv(read(file), basename(file));
  } else if (kind === "collections") {
    const path = file ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data", "megaska-collections.json");
    outcome = await importCollectionsJson(JSON.parse(read(path)), basename(path));
  } else {
    console.error("Usage: import.ts products <file.csv> [--full] | collections [file.json] | redirects <file.csv>");
    process.exit(2);
  }
  if (outcome.ok) {
    console.log("Imported:", outcome.stats);
    for (const w of outcome.warnings) console.warn("warning:", w);
  } else {
    console.error("Import failed:", outcome.error);
    process.exitCode = 1;
  }
} finally {
  await closePool();
}
