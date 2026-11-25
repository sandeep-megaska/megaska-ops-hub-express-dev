// Create a channel API key from the command line (the admin page can too):
//   node --env-file=.env.local --experimental-strip-types scripts/create-api-key.ts Browntape
import { createApiClient, SCOPES } from "../lib/channel/keys.ts";
import { ensureStore } from "../lib/store.ts";
import { closePool } from "../lib/db.ts";

const name = process.argv[2];
if (!name) {
  console.error("Usage: create-api-key.ts <name> [scope,scope]");
  process.exit(2);
}
const scopes = (process.argv[3]?.split(",") ?? [...SCOPES]) as (typeof SCOPES)[number][];
try {
  const { key } = await createApiClient(await ensureStore(), name, scopes);
  console.log(`API key for ${name} (${scopes.join(", ")}). Shown once:\n\n${key}\n`);
} finally {
  await closePool();
}
