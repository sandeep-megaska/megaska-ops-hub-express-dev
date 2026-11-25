// First import, or a manual resync, from your machine:
//   node --env-file=.env.local --experimental-strip-types scripts/full-sync.ts
// After it finishes, redeploy (or wait for webhooks) so cached pages refresh.
import { runFullSync } from "../lib/sync/full-sync.ts";
import { closePool } from "../lib/db.ts";

try {
  const stats = await runFullSync({ log: (msg) => console.log(msg) });
  console.log("Done:", stats);
} catch (error) {
  console.error("Full sync failed:", error);
  process.exitCode = 1;
} finally {
  await closePool();
}
